/**
 * 密码 / token 工具
 *
 * 口令哈希已从「SHA-256(JWT_SECRET::password)」升级为 scrypt（随机盐 + 可调参数）。
 * verifyPassword 仍兼容旧的 SHA-256 格式，登录不需要强制重置；
 * main.ts 的 ensureAdmin 会在检测到旧格式且密码仍为环境变量值时自动升级。
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function scryptSync(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keylen: number,
): Buffer {
  return crypto.scryptSync(String(password), salt, keylen, { N: n, r, p, maxmem: SCRYPT_MAXMEM });
}

/** scrypt 哈希，格式：scrypt$N$r$p$saltHex$hashHex */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 旧格式：SHA-256(pepper::password)，仅用于兼容验证 */
function legacyHash(plain: string): string {
  return crypto
    .createHash("sha256")
    .update(`${env.passwordPepper}::${String(plain)}`)
    .digest("hex");
}

/** 校验密码（支持 scrypt 与旧 SHA-256 两种格式） */
export function verifyPassword(plain: string, hash: string): boolean {
  const h = String(hash || "");
  try {
    if (h.startsWith("scrypt$")) {
      const parts = h.split("$");
      if (parts.length !== 6) return false;
      const n = Number.parseInt(parts[1]!, 10);
      const r = Number.parseInt(parts[2]!, 10);
      const p = Number.parseInt(parts[3]!, 10);
      // 参数来自数据库：做上限约束，避免被篡改的记录造成 CPU/内存 DoS
      if (!Number.isFinite(n) || n < 2 || n > 1 << 20) return false;
      if (!Number.isFinite(r) || r < 1 || r > 16) return false;
      if (!Number.isFinite(p) || p < 1 || p > 4) return false;
      const salt = Buffer.from(parts[4]!, "hex");
      const expected = Buffer.from(parts[5]!, "hex");
      if (salt.length === 0 || expected.length === 0) return false;
      const got = scryptSync(plain, salt, n, r, p, expected.length);
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    }
    const a = Buffer.from(legacyHash(plain), "hex");
    const b = Buffer.from(h, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 生成随机 token */
export function newToken(prefix = "tok"): string {
  return `${prefix}_${crypto.randomBytes(18).toString("hex")}`;
}

/** token 的 SHA-256(用于 session 表存 hash 而非原文) */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** 计算 token 过期时间(默认 30 天) */
export function tokenExpiresAt(days = 30): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

// ============================================================
// AES-256-GCM 加解密(API key / 敏感字段)
// ============================================================

/** 派生 32 bytes AES key（独立的 dataEncryptionKey，默认回退到 JWT_SECRET） */
function getCipherKey(): Buffer {
  return crypto.createHash("sha256").update(String(env.dataEncryptionKey)).digest();
}

/** 加密 API key(返回 base64 字符串: nonce[12] + ciphertext + tag[16]) */
export function encryptApiKey(plain: string): string {
  if (!plain) return "";
  try {
    const key = getCipherKey();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, ct, tag]).toString("base64");
  } catch {
    return "";
  }
}

/** 解密 API key */
export function decryptApiKey(b64: string): string {
  if (!b64) return "";
  try {
    const buf = Buffer.from(String(b64), "base64");
    if (buf.length < 12 + 16) return "";
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getCipherKey(), nonce);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return "";
  }
}

/** 短哈希(用于 cache key):SHA-256(input) 前 16 bytes hex(32 字符) */
export function shortHash(input: string): string {
  return crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 32);
}
