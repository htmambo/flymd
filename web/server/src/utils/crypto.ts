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
