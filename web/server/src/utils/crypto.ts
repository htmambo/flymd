/**
 * 密码 / token 工具
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";

/** SHA-256 哈希(用 secret 加盐,防彩虹表) */
export function hashPassword(plain: string): string {
  return crypto
    .createHash("sha256")
    .update(`${env.jwtSecret}::${String(plain)}`)
    .digest("hex");
}

/** 校验密码 */
export function verifyPassword(plain: string, hash: string): boolean {
  try {
    const a = Buffer.from(hashPassword(plain), "hex");
    const b = Buffer.from(String(hash || ""), "hex");
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

/** 派生 32 bytes AES key(从 env.jwtSecret SHA-256) */
function getCipherKey(): Buffer {
  return crypto.createHash("sha256").update(String(env.jwtSecret)).digest();
}

/** 加密 API key(返回 base64 字符串: nonce[12] + ciphertext + tag[16]) */
export function encryptApiKey(plain: string): string {
  if (!plain) return ""
  try {
    const key = getCipherKey()
    const nonce = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce)
    const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([nonce, ct, tag]).toString("base64")
  } catch {
    return ""
  }
}

/** 解密 API key */
export function decryptApiKey(b64: string): string {
  if (!b64) return ""
  try {
    const buf = Buffer.from(String(b64), "base64")
    if (buf.length < 12 + 16) return ""
    const nonce = buf.subarray(0, 12)
    const tag = buf.subarray(buf.length - 16)
    const ct = buf.subarray(12, buf.length - 16)
    const decipher = crypto.createDecipheriv("aes-256-gcm", getCipherKey(), nonce)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString("utf8")
  } catch {
    return ""
  }
}

/** 短哈希(用于 cache key):SHA-256(input) 前 16 bytes hex(32 字符) */
export function shortHash(input: string): string {
  return crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 32)
}
