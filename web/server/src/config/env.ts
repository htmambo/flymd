/**
 * 服务端环境变量配置
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 根 web/ 目录(本文件在 web/server/src/config/ → 上溯 3 层) */
const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

export const env = {
  host: strEnv("HOST", "127.0.0.1"),
  port: intEnv("PORT", 8787),
  nodeEnv: strEnv("NODE_ENV", "development"),
  /** 管理员初始化账号(可选,启动时如不存在则创建) */
  adminEmail: strEnv("ADMIN_EMAIL", "admin@flymd.local"),
  adminPassword: strEnv("ADMIN_PASSWORD", "admin123"),
  /** 持久化目录 */
  dataDir: strEnv("DATA_DIR", path.join(ROOT_DIR, "data")),
  /** web-client 静态资源目录(生产模式下 serve) */
  webDistPath: strEnv("WEB_DIST_PATH", path.join(ROOT_DIR, "web-client", "dist")),
  /** 是否在 dev 模式跑(Vite dev middleware) */
  enableVite: strEnv("ENABLE_VITE", "true") === "true",
  /** Vite config 路径(dev middleware 加载以获取 alias) */
  webViteConfigPath: strEnv("WEB_VITE_CONFIG_PATH", path.join(ROOT_DIR, "web-client", "vite.config.mts")),
  /** CORS 允许来源(* 表示全开) */
  corsOrigin: strEnv("CORS_ORIGIN", "*"),
  /** 静态资源 token 签名密钥(生产可改) */
  jwtSecret: strEnv("JWT_SECRET", "flymd-dev-secret-please-change-in-prod"),
} as const;

export type Env = typeof env;
