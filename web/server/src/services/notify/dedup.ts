/**
 * 去重 + 限流
 *
 * - 去重:基于 dedupKey + 5min 窗口
 * - 限流:每 channel 每分钟最多 N 条
 *
 * 两者都接受外部注入(DatabaseClient + 内存 Map),便于单测
 */
import type { DatabaseClient } from "../../db/database.js";
import { shortHash } from "../../utils/crypto.js";

const DEFAULT_DEDUP_SECONDS = 5 * 60; // 5 min
const DEFAULT_RPM_PER_CHANNEL = 10; // 10/min/channel

export function makeDedupKey(event: string, message: string, detail?: unknown): string {
  const payload = JSON.stringify(detail || {});
  return shortHash(`${event}|${message}|${payload}`).slice(0, 16);
}

export class NotifyDedup {
  private recent = new Map<string, number>(); // dedupKey → timestamp(ms)

  constructor(private db: DatabaseClient, private opts: { dedupSeconds?: number } = {}) {}

  /** 派生 dedup key */
  key(event: string, message: string, detail?: unknown): string {
    return makeDedupKey(event, message, detail);
  }

  /** 检查并占用一个 dedup 槽位(返回 true 表示是新的) */
  claim(dedupKey: string): { isNew: boolean; suppressedReason?: string } {
    const now = Date.now();
    const window = (this.opts.dedupSeconds || DEFAULT_DEDUP_SECONDS) * 1000;
    // 1) 内存快查
    const last = this.recent.get(dedupKey);
    if (last && now - last < window) {
      return { isNew: false, suppressedReason: "in-memory" };
    }
    // 2) DB 慢查(覆盖重启场景)
    const recent = (this.opts.dedupSeconds || DEFAULT_DEDUP_SECONDS);
    if (this.db.hasRecentAlert(dedupKey, recent)) {
      this.recent.set(dedupKey, now);
      return { isNew: false, suppressedReason: "db" };
    }
    this.recent.set(dedupKey, now);
    return { isNew: true };
  }

  /** 60s 自动清理过期(防止内存泄漏) */
  purge(): number {
    const now = Date.now();
    const window = (this.opts.dedupSeconds || DEFAULT_DEDUP_SECONDS) * 1000;
    let n = 0;
    for (const [k, t] of this.recent) {
      if (now - t > window) {
        this.recent.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 单测 / 调试 */
  size(): number {
    return this.recent.size;
  }
  reset(): void {
    this.recent.clear();
  }
}

export class NotifyRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private max: number = DEFAULT_RPM_PER_CHANNEL) {
    if (typeof setInterval !== "undefined") {
      setInterval(() => this.purge(), 60_000).unref?.();
    }
  }

  /** 占用一个 slot(返回 false 表示超限) */
  hit(channelId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const cutoff = now - 60_000;
    let arr = this.buckets.get(channelId);
    if (!arr) {
      arr = [];
      this.buckets.set(channelId, arr);
    }
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= this.max) {
      return { allowed: false, remaining: 0 };
    }
    arr.push(now);
    return { allowed: true, remaining: this.max - arr.length };
  }

  purge(): number {
    const now = Date.now();
    const cutoff = now - 60_000;
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

  size(): number {
    return this.buckets.size;
  }
  reset(): void {
    this.buckets.clear();
  }
}
