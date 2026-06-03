/**
 * AI 响应缓存服务
 *
 * - key 派生:短哈希(model + temperature + top_p + messages + 拼接 prompt)
 * - 存到 ai_response_cache 表(TTL 1h,可在 settings 覆盖)
 * - 只对**非流式**响应启用(流式 chunk 不能 cache)
 * - 启动时 registerDatabase 时关联 db,使用前必须 inject
 */
import type { DatabaseClient } from "../../db/database.js";
import { shortHash } from "../../utils/crypto.js";
import type { ChatRequest, ChatResponse } from "./types.js";

const DEFAULT_TTL_SECONDS = 60 * 60; // 1h

export type CacheEntry = {
  responseJson: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

/** 派生 cache key:sha256(model|temp|top_p|messages),取前 32 hex */
export function makeCacheKey(req: ChatRequest): string {
  const m = String(req.model || "");
  const t = String(req.temperature ?? "");
  const p = String(req.top_p ?? "");
  const msgs = JSON.stringify(req.messages || []);
  return shortHash(`chat|${m}|${t}|${p}|${msgs}`);
}

export class CacheService {
  private ttlSeconds: number;
  constructor(private db: DatabaseClient, opts: { ttlSeconds?: number } = {}) {
    this.ttlSeconds = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  }

  /** 读 cache(命中返回;未命中 / 过期返 null) */
  get(key: string): CacheEntry | null {
    return this.db.getCachedResponse(key);
  }

  /** 写 cache */
  set(key: string, req: ChatRequest, resp: ChatResponse): void {
    const usage = resp.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    try {
      this.db.setCachedResponse(key, {
        model: resp.model || req.model,
        promptHash: key,
        responseJson: JSON.stringify(resp),
        promptTokens,
        completionTokens,
        ttlSeconds: this.ttlSeconds,
      });
    } catch (e) {
      // 写 cache 失败不影响主流程
      console.error("[CacheService.set] failed:", e);
    }
  }

  /** 清理过期 entry(返回清理数) */
  purgeExpired(): number {
    return this.db.purgeExpiredCache();
  }
}
