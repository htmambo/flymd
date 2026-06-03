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
import { authPlugin } from "./plugins/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes, registerSettingsUserRoutes } from "./routes/settings.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLegacyMockRoutes } from "./routes/legacy-mock.js";

declare module "fastify" {
  interface FastifyInstance {
    database: DatabaseClient;
    authService: AuthService;
    settingsService: SettingsService;
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
  app.decorate("database", database);
  app.decorate("authService", authService);
  app.decorate("settingsService", settingsService);

  // Auth 插件(全局 preHandler 注入 authUser)
  await app.register(authPlugin);

  // 路由
  await app.register(registerHealthRoutes);
  await app.register(registerAuthRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerSettingsUserRoutes);
  await app.register(registerLegacyMockRoutes);

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
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: env.webDistPath.replace(/\/dist$/, ""),
    configFile: false,
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
