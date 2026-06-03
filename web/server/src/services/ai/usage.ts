/**
 * AI 用量日志服务
 *
 * 封装 DatabaseClient.logApiCall + aiUsageSummary,对外暴露高层 API。
 * 上层(router / 路由)无需关心 SQLite 细节。
 */
import type { DatabaseClient } from "../../db/database.js";

export type UsageEntry = {
  userId: string | null;
  provider: string;
  protocol: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "ok" | "error";
  errorType?: string;
  errorMsg?: string;
  cacheHit: boolean;
  requestId?: string;
};

export type UsageSummary = {
  totalCalls: number;
  errorCount: number;
  avgLatencyMs: number;
  cacheHits: number;
  totalTokens: number;
  byUser: Array<{ userId: string; calls: number; tokens: number }>;
  byProvider: Array<{ provider: string; calls: number }>;
};

export class UsageService {
  constructor(private db: DatabaseClient) {}

  /** 记录一次 AI 调用(失败不抛,仅 log) */
  record(entry: UsageEntry): void {
    this.db.logApiCall(entry);
  }

  /** 聚合查询(可选 since 时间戳,毫秒) */
  summary(since: number = 0): UsageSummary {
    return this.db.aiUsageSummary(since);
  }
}
