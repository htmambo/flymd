/**
 * 限流服务(per-user,in-memory)
 *
 * 设计:
 *  - 简单滑动窗口:in-memory Map<key, number[]> 记录时间戳
 *  - 启动时挂 setInterval 清理过期(每 60s 一次)
 *  - key 优先用 userId;无 userId 时用 IP(从 Fastify request 取)
 *
 * 限制(默认):100 req/min/user
 * 生产应换 Redis;当前实现单实例够用,重启清零。
 */

const WINDOW_MS = 60_000; // 1 分钟
const DEFAULT_MAX = 100;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number; // 距离窗口重置的毫秒数
};

type Bucket = number[];

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private max: number;

  constructor(opts: { maxPerMinute?: number } = {}) {
    this.max = opts.maxPerMinute || DEFAULT_MAX;
    // 60s 自动清理
    if (typeof setInterval !== "undefined") {
      setInterval(() => this.purge(), 60_000).unref?.();
    }
  }

  /** 检查是否超限(并记录本次) */
  hit(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    // 清理过期
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= this.max) {
      const resetMs = arr[0] + WINDOW_MS - now;
      return { allowed: false, remaining: 0, resetMs: Math.max(0, resetMs) };
    }
    arr.push(now);
    return { allowed: true, remaining: this.max - arr.length, resetMs: WINDOW_MS };
  }

  /** 清理已无活动的 key */
  purge(): number {
    const cutoff = Date.now() - WINDOW_MS;
    let n = 0;
    for (const [k, arr] of this.buckets) {
      while (arr.length && arr[0] < cutoff) arr.shift();
      if (arr.length === 0) {
        this.buckets.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 调试:当前 map 大小 */
  size(): number {
    return this.buckets.size;
  }

  /** 调试 / 测试:重置 */
  reset(): void {
    this.buckets.clear();
  }
}

/** 单例(避免多次启动) */
let _instance: RateLimiter | null = null;
export function getRateLimiter(): RateLimiter {
  if (!_instance) _instance = new RateLimiter();
  return _instance;
}
