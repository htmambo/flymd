/**
 * 进程内固定窗口限流器（无第三方依赖）。
 *
 * 设计要点：
 * - 键数量有上限，超过时先清过期桶、仍超限则整体清空，避免攻击者用随机
 *   email/IP 撑爆内存（限流器自身不能成为 DoS 面）。
 * - 返回 retryAfterMs，路由层据此设置 Retry-After。
 * - 仅用于单进程部署；多实例需要换成 Redis 等共享存储。
 */
export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number }

export interface RateLimiterOptions {
  windowMs: number
  max: number
  /** 键数量上限，默认 5000 */
  maxKeys?: number
}

export interface RateLimiter {
  hit(key: string, now?: number): RateLimitResult
  reset(key: string): void
  size(): number
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const windowMs = Math.max(1000, opts.windowMs)
  const max = Math.max(1, opts.max)
  const maxKeys = Math.max(100, opts.maxKeys ?? 5000)
  const buckets = new Map<string, { count: number; resetAt: number }>()

  function prune(now: number): void {
    if (buckets.size <= maxKeys) return
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
    // 仍有大量未过期键（攻击者用随机键刷）：整体清空，宁可短暂放过也不 OOM
    if (buckets.size > maxKeys) buckets.clear()
  }

  return {
    hit(key: string, now = Date.now()): RateLimitResult {
      prune(now)
      let bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs }
        buckets.set(key, bucket)
      }
      bucket.count += 1
      if (bucket.count > max) {
        return { ok: false, retryAfterMs: Math.max(0, bucket.resetAt - now) }
      }
      return { ok: true, remaining: Math.max(0, max - bucket.count) }
    },
    reset(key: string): void {
      buckets.delete(key)
    },
    size(): number {
      return buckets.size
    },
  }
}
