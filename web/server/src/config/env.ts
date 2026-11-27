/**
 * 服务端环境变量配置
 *
 * 安全策略（fail-closed）：
 * - 未显式设置 NODE_ENV 时按 production 处理；只有 NODE_ENV=development（以及
 *   vitest 自动设置的 test）才允许使用开发默认值。
 * - 生产环境缺少 ADMIN_PASSWORD / JWT_SECRET 时直接拒绝启动，避免带着公开的
 *   默认管理员口令与可预测的签名密钥上线。
 * - 已有部署升级时，把 JWT_SECRET 显式设置为原先使用的值即可保持既有口令哈希
 *   与 API Key 密文可解密（它们都由该密钥派生）。
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

// 未设置时按 production 处理（fail closed）。vitest 会自动设置 test。
const nodeEnv = strEnv("NODE_ENV", "production");
// 只有明确的开发/测试环境才允许弱默认值；staging 等其它取值一律按生产处理。
const isProduction = !["development", "test"].includes(nodeEnv);

function secretEnv(name: string, devDefault: string): string {
  const raw = process.env[name];
  if (raw && raw.length > 0) return raw;
  if (isProduction) {
    throw new Error(
      `${name} 必须在生产环境显式配置（NODE_ENV=production 时不允许使用开发默认值）`,
    );
  }
  return devDefault;
}

// 先取 JWT_SECRET：它同时是旧口令哈希与旧 API Key 密文的兼容密钥。
const jwtSecret = secretEnv("JWT_SECRET", "flymd-dev-secret-please-change-in-prod");

export const env = {
  host: strEnv("HOST", "127.0.0.1"),
  port: intEnv("PORT", 8787),
  nodeEnv,
  /** 管理员初始化账号(可选,启动时如不存在则创建) */
  adminEmail: strEnv("ADMIN_EMAIL", "admin@flymd.local"),
  /**
   * 生产环境**不提供**默认管理员口令：未设置时不创建 admin 账号（用
   * `npm run reset-password` 走恢复流程）。开发环境保留一个明显的弱默认值。
   */
  adminPassword: isProduction ? strEnv("ADMIN_PASSWORD", "") : strEnv("ADMIN_PASSWORD", "flymd-dev-admin"),
  /** 持久化目录 */
  dataDir: strEnv("DATA_DIR", path.join(ROOT_DIR, "data")),
  /** web-client 静态资源目录(生产模式下 serve) */
  webDistPath: strEnv("WEB_DIST_PATH", path.join(ROOT_DIR, "web-client", "dist")),
  /** 是否在 dev 模式跑(Vite dev middleware) */
  enableVite: strEnv("ENABLE_VITE", "true") === "true",
  /** Vite config 路径(dev middleware 加载以获取 alias) */
  webViteConfigPath: strEnv("WEB_VITE_CONFIG_PATH", path.join(ROOT_DIR, "web-client", "vite.config.mts")),
  /** CORS 允许来源(* 表示全开；此时 app.ts 会关闭 credentials) */
  corsOrigin: strEnv("CORS_ORIGIN", "*"),
  /** 旧口令哈希 / 静态资源 token 签名密钥 */
  jwtSecret,
  /**
   * 口令专用密钥。默认沿用 JWT_SECRET，保证旧哈希可验证；
   * 新部署建议单独设置并保持稳定（修改会导致旧口令全部失效）。
   */
  passwordPepper: strEnv("PASSWORD_PEPPER", jwtSecret),
  /**
   * API Key 密文的 AES 派生密钥。默认沿用 JWT_SECRET 以兼容旧密文；
   * 新部署建议单独设置。
   */
  dataEncryptionKey: strEnv("DATA_ENCRYPTION_KEY", jwtSecret),
} as const;

export type Env = typeof env;
