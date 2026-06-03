/**
 * Fastify 应用工厂
 */
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { DatabaseClient } from "../db/database.js";
import { AuthService } from "../services/auth.js";
import { SettingsService } from "../services/settings.js";
import { UsageService } from "../services/ai/usage.js";
import { CacheService } from "../services/ai/cache.js";
import { NotifyService } from "../services/notify/index.js";
import { setRouterDeps, setNotifyService } from "../services/ai/router.js";
import { authPlugin } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes, registerSettingsUserRoutes } from "./routes/settings.js";
import { registerAiAdminRoutes } from "./routes/ai-admin.js";
import { registerNotifyAdminRoutes } from "./routes/notify-admin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLegacyMockRoutes } from "./routes/legacy-mock.js";

declare module "fastify" {
  interface FastifyInstance {
    database: DatabaseClient;
    authService: AuthService;
    settingsService: SettingsService;
    usageService: UsageService;
    cacheService: CacheService;
    notifyService: NotifyService;
  }
}

function isBackendRequest(url: string): boolean {
  return (
    url.startsWith("/api/") ||
    url === "/health" ||
    url.startsWith("/asr/") ||
    url.startsWith("/ai/") ||
    url.startsWith("/xiaoshuo/") ||
    url.startsWith("/pdf/") ||
    url === "/" ||
    url === "/extensions.html" ||
    url === "/announcements.json" ||
    url === "/plugins/index.json" ||
    url === "/update-extra.json" ||
    url === "/favicon.ico" ||
    url === "/pdf/shop.png" ||
    url === "/Flymdnew.png"
  );
}

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss" },
      },
    },
  });

  // CORS(开发环境)
  await app.register(cors, { origin: env.corsOrigin, credentials: true });

  // DB + 服务
  const database = new DatabaseClient();
  const authService = new AuthService(database);
  const settingsService = new SettingsService(database);
  const usageService = new UsageService(database);
  const cacheService = new CacheService(database);
  const notifyService = new NotifyService(database, settingsService);
  // 注入 router 依赖(usage + cache + notify),让 router 在每次 chat 时自动记录 + 命中缓存 + 错误告警
  setRouterDeps({ usage: usageService, cache: cacheService });
  setNotifyService(notifyService);
  app.decorate("database", database);
  app.decorate("authService", authService);
  app.decorate("settingsService", settingsService);
  app.decorate("usageService", usageService);
  app.decorate("cacheService", cacheService);
  app.decorate("notifyService", notifyService);

  // 启动时清理过期 cache(可忽略失败)
  try {
    const purged = cacheService.purgeExpired();
    app.log.info(`AI 缓存启动清理: ${purged} 条过期记录`);
  } catch (e) {
    app.log.warn({ err: e }, "AI 缓存启动清理失败");
  }
  // 启动时清理超量告警历史
  try {
    const pruned = database.pruneAlerts(1000);
    if (pruned > 0) app.log.info(`告警历史清理: 删除 ${pruned} 条`);
  } catch (e) {
    app.log.warn({ err: e }, "告警历史清理失败");
  }

  // Auth 插件(全局 preHandler 注入 authUser)
  await app.register(authPlugin);

  // 路由
  await app.register(registerHealthRoutes);
  await app.register(registerAuthRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerSettingsUserRoutes);
  await app.register(registerLegacyMockRoutes);
  await app.register(registerAiAdminRoutes);
  await app.register(registerNotifyAdminRoutes);

  // 静态资源 + Vite dev middleware
  if (env.enableVite && env.nodeEnv === "development") {
    await registerViteWebMiddleware(app);
  } else {
    await registerProdWebStatic(app);
  }

  // 全局错误处理
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, "请求处理失败");
    if (reply.sent) return;
    return reply.code(500).send({ error: { message: "服务器内部错误" } });
  });

  return app;
}

// ============================================================
// 静态资源(Vite dev middleware 或 生产 dist)
// ============================================================

async function registerViteWebMiddleware(app: FastifyInstance) {
  const [{ createServer }, vuePlugin, tailwindPlugin] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-vue"),
    import("@tailwindcss/vite"),
  ]);
  // 手动配置(与 web-client/vite.config.ts 保持一致)。
  // 为什么不用 configFile: env.webViteConfigPath:
  //   - vite.config.ts 会在 ESM 项目里被 esbuild 编译成 .js + 用 exports.X 格式
  //     (在 "type":"module" 包下报 exports is not defined)
  //   - vite.config.mts 在 Vite 7 dev esbuild 加载时报 Could not resolve
  // 必须同时手动加 @vitejs/plugin-vue + @tailwindcss/vite,
  // 否则 .vue 文件报 "Install @vitejs/plugin-vue to handle .vue files"
  const webRoot = env.webDistPath.replace(/\/dist$/, "");
  const srcDir = (await import("node:url")).fileURLToPath(
    new URL("./src/", (await import("node:url")).pathToFileURL(webRoot + "/")),
  );
  const vite = await createServer({
    root: webRoot,
    configFile: false,
    plugins: [vuePlugin.default(), tailwindPlugin.default()],
    resolve: {
      alias: { "@": srcDir },
    },
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.log.info("Vite dev middleware 已启用 (开发模式)");

  app.addHook("onRequest", async (request, reply) => {
    const url = request.raw.url || "/";
    if (isBackendRequest(url)) return;
    reply.hijack();
    try {
      await new Promise<void>((resolve, reject) => {
        vite.middlewares(request.raw, reply.raw, (err?: Error) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      app.log.error({ err }, "Vite 中间件错误");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader("content-type", "text/plain; charset=utf-8");
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end("前端开发中间件处理失败");
      }
    }
  });
}

async function registerProdWebStatic(app: FastifyInstance) {
  const dist = env.webDistPath;
  if (!fs.existsSync(dist)) {
    app.log.warn({ dist }, "web-client dist 不存在,跳过静态资源 serve(仅 API 可用)");
    return;
  }
  await app.register(fastifyStatic, { root: dist, prefix: "/", decorateReply: false });
  // SPA fallback:非 API 请求 → /app/index.html
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (isBackendRequest(request.url)) {
      return reply.code(404).send({ error: { message: "Not Found" } });
    }
    const indexPath = path.join(dist, "index.html");
    if (!fs.existsSync(indexPath)) {
      return reply.code(404).send({ error: { message: "index.html not found" } });
    }
    return reply.type("text/html").send(fs.createReadStream(indexPath));
  });
  app.log.info({ dist }, "生产静态资源已注册");
}
