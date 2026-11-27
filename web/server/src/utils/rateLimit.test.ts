import { describe, it, expect } from "vitest"
import { createRateLimiter } from "./rateLimit.js"

describe("createRateLimiter", () => {
  it("允许窗口内前 N 次，第 N+1 次拒绝并给出重试时间", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 3 })
    expect(rl.hit("a", 0).ok).toBe(true)
    expect(rl.hit("a", 1).ok).toBe(true)
    expect(rl.hit("a", 2).ok).toBe(true)
    const denied = rl.hit("a", 3)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.retryAfterMs).toBe(997)
  })

  it("窗口过期后重新计数", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 })
    expect(rl.hit("a", 0).ok).toBe(true)
    expect(rl.hit("a", 500).ok).toBe(false)
    expect(rl.hit("a", 1001).ok).toBe(true)
  })

  it("reset 清除单个键", () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 })
    expect(rl.hit("a", 0).ok).toBe(true)
    expect(rl.hit("a", 1).ok).toBe(false)
    rl.reset("a")
    expect(rl.hit("a", 2).ok).toBe(true)
  })

  it("键数量有上限，不会无限增长", () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 100 })
    for (let i = 0; i < 500; i++) rl.hit(`k-${i}`, 0)
    expect(rl.size()).toBeLessThanOrEqual(100)
  })
})
