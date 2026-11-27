import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { env } from "../config/env.js"
import {
  hashPassword,
  verifyPassword,
  encryptApiKey,
  decryptApiKey,
} from "./crypto.js"

function legacyHash(plain: string): string {
  return crypto
    .createHash("sha256")
    .update(`${env.passwordPepper}::${plain}`)
    .digest("hex")
}

describe("hashPassword / verifyPassword", () => {
  it("scrypt 往返：正确口令通过，错误口令拒绝", () => {
    const h = hashPassword("correct horse battery")
    expect(h.startsWith("scrypt$")).toBe(true)
    expect(verifyPassword("correct horse battery", h)).toBe(true)
    expect(verifyPassword("wrong password", h)).toBe(false)
  })

  it("同一口令每次哈希不同（随机盐）", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"))
  })

  it("兼容旧 SHA-256(pepper::password) 格式", () => {
    expect(verifyPassword("legacy-pass", legacyHash("legacy-pass"))).toBe(true)
    expect(verifyPassword("other", legacyHash("legacy-pass"))).toBe(false)
  })

  it("拒绝参数越界或格式损坏的 scrypt 记录", () => {
    const bad = [
      // N / r / p 超上限
      ["scrypt", "2097152", "8", "1", "00", "00"].join("$"),
      ["scrypt", "16384", "99", "1", "00", "00"].join("$"),
      ["scrypt", "16384", "8", "9", "00", "00"].join("$"),
      // 空盐 / 空哈希
      ["scrypt", "16384", "8", "1", "", "00"].join("$"),
      ["scrypt", "16384", "8", "1", "00", ""].join("$"),
      // 非 scrypt 形态
      "not-a-hash",
      "",
    ]
    for (const record of bad) {
      expect(verifyPassword("x", record)).toBe(false)
    }
  })
})

describe("encryptApiKey / decryptApiKey", () => {
  it("AES-GCM 往返", () => {
    const plain = "sk-example-123456"
    const enc = encryptApiKey(plain)
    expect(enc).not.toBe("")
    expect(enc).not.toContain(plain)
    expect(decryptApiKey(enc)).toBe(plain)
  })

  it("篡改密文返回空串而不是抛错", () => {
    const enc = encryptApiKey("sk-example")
    const buf = Buffer.from(enc, "base64")
    buf[buf.length - 1] ^= 0xff
    expect(decryptApiKey(buf.toString("base64"))).toBe("")
  })
})
