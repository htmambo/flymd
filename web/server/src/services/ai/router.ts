/**
 * AI gateway router
 *
 * 职责:
 *  1. 根据 model 名 + settings 选 provider
 *  2. 读 settings 里的 provider config(apiKey / baseUrl / enabled)
 *  3. 调对应 provider 的 chat / completion / embedding
 *  4. 错误归一化(401/403/429/5xx/超时)
 *  5. 用量日志(记录到 api_call_logs)
 *  6. 响应缓存(命中 cache 直接返回,否则落库)
 *  7. 429 / 5xx 自动重试(非流式)
 *
 * mock-mode 设计:
 *  - env MOCK_PROVIDER=1 → 全部走 mock
 *  - 没真 key → 走 mock(降级)
 *  - provider 找不到 / 禁用 → 走 mock
 */

import type {
  ChatRequest, ChatResponse, ChatChunk,
  CompletionRequest, CompletionResponse,
  EmbeddingRequest, EmbeddingResponse,
  ProviderName, ProviderConfig, RouterContext,
} from "./types.js";
import { mockChat, mockChatStream, mockCompletion, mockEmbedding } from "./mock.js";
import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";
import * as ollama from "./providers/ollama.js";
import * as generic from "./providers/generic-openai.js";
import { makeCacheKey } from "./cache.js";
import type { UsageService } from "./usage.js";
import { decryptApiKey } from "../../utils/crypto.js";
import type { AlertPayload } from "../notify/types.js";
import type { NotifyService } from "../notify/index.js";

// ============================================================
// Provider 选择
// ============================================================

const MOCK_FORCE = process.env.MOCK_PROVIDER === "1" || process.env.MOCK_PROVIDER === "true";

/** 根据 model 名推断 provider(如果 settings 没显式指定) */
export function inferProviderByModel(model: string): ProviderName {
  const m = (model || "").toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.startsWith("text-embedding")) return "openai";
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("ollama:") || m.startsWith("qwen") || m.startsWith("llama") || m.startsWith("mistral") || m.startsWith("deepseek")) return "ollama";
  return "generic-openai";
}

/** 从 settings 表里读所有 ai.providers.*.xxx,组装成 ProviderConfig[] */
export function loadProviderConfigs(settings: Array<{ key: string; value: unknown }>): ProviderConfig[] {
  const cfgMap = new Map<string, Record<string, unknown>>();
  // 1) 提取 ai.providers.<id>.* 字段
  for (const s of settings) {
    const m = /^ai\.providers\.([\w\-]+)\.([a-z]+)$/i.exec(s.key);
    if (!m) continue;
    const provider = m[1];
    const field = m[2];
    if (!cfgMap.has(provider)) cfgMap.set(provider, {});
    (cfgMap.get(provider) as any)[field] = s.value;
  }
  // 2) 读 ai.priority 数组(决定顺序)
  const priorityEntry = settings.find((s) => s.key === "ai.priority");
  const priorityIds: string[] = Array.isArray(priorityEntry?.value)
    ? (priorityEntry!.value as unknown[]).map(String)
    : [];
  // 3) 构造并按 priority 排序
  const out: ProviderConfig[] = [];
  for (const [id, fields] of cfgMap) {
    const protocol = String(fields.protocol || "openai") as ProviderName;
    // 验证 protocol 合法
    if (!["openai", "anthropic", "ollama", "generic-openai"].includes(protocol)) continue;
    if ((fields.enabled as any) === false) continue;
    let apiKey = String(fields.apiKey || "");
    // 加密存储检测:如果 apiKey 是密文(以 enc:v1: 前缀),自动解密
    if (apiKey.startsWith("enc:v1:")) {
      try {
        apiKey = decryptApiKey(apiKey.slice("enc:v1:".length)) || apiKey;
      } catch {
        // 解密失败保留原值(走错误路径)
      }
    }
    if (!apiKey && protocol !== "ollama") continue;
    out.push({
      provider: protocol,
      apiKey,
      baseUrl: fields.baseUrl as string | undefined,
      defaultModel: fields.defaultModel as string | undefined,
      enabled: true,
      // 多 provider 实例:用 name 字段标识
      ...({ name: id, id } as any),
    });
  }
  // 按 priority 排序
  if (priorityIds.length) {
    out.sort((a: any, b: any) => {
      const ai = priorityIds.indexOf(a.id);
      const bi = priorityIds.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  return out;
}

/** 根据 model + configs 选最匹配的 provider */
export function pickProvider(model: string, configs: ProviderConfig[]): ProviderConfig | null {
  if (!configs.length) return null;
  const inferred = inferProviderByModel(model);
  // 1) 先找匹配的(provider 协议 = inferred)
  const match = configs.find((c) => c.provider === inferred);
  if (match) return match;
  // 2) 没有匹配,返回第一个(已按 priority 排好)
  return configs[0];
}

// ============================================================
// 可选依赖:cache + usage(由外部注入)
// ============================================================

type RouterDeps = {
  usage?: UsageService;
  cache?: {
    get(key: string): { responseJson: string; model: string; promptTokens: number; completionTokens: number } | null;
    set(key: string, req: ChatRequest, resp: ChatResponse): void;
  };
};

let _deps: RouterDeps = {};
export function setRouterDeps(deps: RouterDeps): void {
  _deps = deps;
}

let _notify: NotifyService | null = null;
export function setNotifyService(n: NotifyService): void {
  _notify = n;
}

/** 触发告警(失败不抛) */
function fireAlert(payload: AlertPayload): void {
  if (!_notify) return;
  // 不 await — 后台跑,不阻塞主流程
  _notify.alert(payload).catch((e: unknown) => {
    // 单点 log
    try { console.error("[notify] alert dispatch failed:", (e as Error)?.message || e); } catch {}
  });
}

// ============================================================
// 入口:chat / completion / embedding
// ============================================================

/** 非流式路径:带 cache + usage + 3 次重试(429/5xx) */
export async function routeChat(req: ChatRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<ChatResponse> {
  const started = Date.now();
  const model = String(req.model || "");
  // 1) cache 查询(只对非流式、非 mock 路径生效)
  const cacheKey = _deps.cache ? makeCacheKey(req) : null;
  if (cacheKey && _deps.cache) {
    const cached = _deps.cache.get(cacheKey);
    if (cached) {
      try {
        const resp = JSON.parse(cached.responseJson) as ChatResponse;
        _deps.usage?.record({
          userId: ctx.userId,
          provider: "cache",
          protocol: "cache-hit",
          model,
          promptTokens: cached.promptTokens,
          completionTokens: cached.completionTokens,
          totalTokens: cached.promptTokens + cached.completionTokens,
          latencyMs: Date.now() - started,
          status: "ok",
          cacheHit: true,
          requestId: ctx.requestId,
        });
        return resp;
      } catch {
        // cache 损坏,继续走正常路径
      }
    }
  }

  if (MOCK_FORCE || ctx.mock) {
    const resp = mockChat(req);
    if (cacheKey && _deps.cache) _deps.cache.set(cacheKey, req, resp);
    _deps.usage?.record({
      userId: ctx.userId,
      provider: "mock",
      protocol: "mock",
      model,
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      totalTokens: resp.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - started,
      status: "ok",
      cacheHit: false,
      requestId: ctx.requestId,
    });
    return resp;
  }

  const cfg = pickProvider(req.model, configs);
  if (!cfg) {
    const resp = mockChat(req); // 降级
    if (cacheKey && _deps.cache) _deps.cache.set(cacheKey, req, resp);
    _deps.usage?.record({
      userId: ctx.userId,
      provider: "mock",
      protocol: "fallback",
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - started,
      status: "ok",
      cacheHit: false,
      requestId: ctx.requestId,
    });
    return resp;
  }

  // 2) 调真 provider,带 3 次重试
  const delays = [0, 1000, 2000, 4000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const resp = await callProviderChat(cfg, req);
      // 写 cache
      if (cacheKey && _deps.cache) _deps.cache.set(cacheKey, req, resp);
      // 写 usage
      _deps.usage?.record({
        userId: ctx.userId,
        provider: cfg.provider,
        protocol: String((cfg as any).id || cfg.provider),
        model,
        promptTokens: resp.usage?.prompt_tokens ?? 0,
        completionTokens: resp.usage?.completion_tokens ?? 0,
        totalTokens: resp.usage?.total_tokens ?? 0,
        latencyMs: Date.now() - started,
        status: "ok",
        cacheHit: false,
        requestId: ctx.requestId,
      });
      return resp;
    } catch (e) {
      lastErr = e;
      const norm = normalizeError(e);
      if (!norm.retryable || attempt === delays.length - 1) break;
      // 否则进入下一轮重试
    }
  }
  // 用尽重试,记录 error
  const norm = normalizeError(lastErr);
  _deps.usage?.record({
    userId: ctx.userId,
    provider: cfg.provider,
    protocol: String((cfg as any).id || cfg.provider),
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: Date.now() - started,
    status: "error",
    errorType: norm.type,
    errorMsg: norm.message,
    cacheHit: false,
    requestId: ctx.requestId,
  });
  // 触发告警(只对真 provider 错误的 retryable 触发,auth 错误也告警但用不同 event)
  const severity = norm.type === "auth" ? "critical" : norm.type === "rate_limit" ? "warn" : "error";
  fireAlert({
    event: "ai_error",
    severity,
    message: `[${cfg.provider}] ${norm.type}: ${norm.message.slice(0, 200)}`,
    detail: {
      model, userId: ctx.userId, requestId: ctx.requestId,
      provider: cfg.provider, errorType: norm.type, status: norm.status,
    },
  });
  throw norm;
}

async function callProviderChat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  switch (cfg.provider) {
    case "openai": return await openai.openaiChat(cfg, req);
    case "anthropic": return await anthropic.anthropicChat(cfg, req);
    case "ollama": return await ollama.ollamaChat(cfg, req);
    case "generic-openai": return await generic.genericOpenAIChat(cfg, req);
    default: return mockChat(req);
  }
}

/** 流式路径:cache 不适用(只对整响应生效) */
export async function routeChatStream(req: ChatRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<AsyncIterable<ChatChunk>> {
  const started = Date.now();
  const model = String(req.model || "");
  let providerName = "mock";
  let protocolName = "mock";

  if (!(MOCK_FORCE || ctx.mock)) {
    const cfg = pickProvider(req.model, configs);
    if (cfg) {
      providerName = cfg.provider;
      protocolName = String((cfg as any).id || cfg.provider);
    }
  }

  // 包一层 async iterable,在结束时记 usage
  let iter: AsyncIterable<ChatChunk>;
  if (MOCK_FORCE || ctx.mock) {
    iter = mockChatStream(req);
    providerName = "mock";
    protocolName = "mock";
  } else {
    const cfg = pickProvider(req.model, configs);
    if (!cfg) {
      iter = mockChatStream(req);
      providerName = "mock";
      protocolName = "fallback";
    } else {
      try {
        switch (cfg.provider) {
          case "openai": iter = await openai.openaiChatStream(cfg, req); break;
          case "anthropic": iter = await anthropic.anthropicChatStream(cfg, req); break;
          case "ollama": iter = await ollama.ollamaChatStream(cfg, req); break;
          case "generic-openai": iter = await generic.genericOpenAIChatStream(cfg, req); break;
          default: iter = mockChatStream(req);
        }
      } catch (e) {
        const norm = normalizeError(e);
        _deps.usage?.record({
          userId: ctx.userId, provider: providerName, protocol: protocolName, model,
          promptTokens: 0, completionTokens: 0, totalTokens: 0,
          latencyMs: Date.now() - started, status: "error",
          errorType: norm.type, errorMsg: norm.message, cacheHit: false, requestId: ctx.requestId,
        });
        throw norm;
      }
    }
  }

  return wrapStreamUsage(iter, {
    userId: ctx.userId,
    provider: providerName,
    protocol: protocolName,
    model,
    requestId: ctx.requestId,
    startedAt: started,
  });
}

/** 在流 iter 末尾记录 usage(若 stream 抛错也记) */
async function* wrapStreamUsage(
  src: AsyncIterable<ChatChunk>,
  meta: {
    userId: string | null;
    provider: string;
    protocol: string;
    model: string;
    requestId: string;
    startedAt: number;
  },
): AsyncIterable<ChatChunk> {
  let fullContent = "";
  try {
    for await (const chunk of src) {
      const c = chunk.choices?.[0]?.delta?.content;
      if (typeof c === "string") fullContent += c;
      yield chunk;
    }
    _deps.usage?.record({
      userId: meta.userId,
      provider: meta.provider,
      protocol: meta.protocol,
      model: meta.model,
      promptTokens: 0,
      completionTokens: Math.ceil(fullContent.length / 4), // 粗估
      totalTokens: Math.ceil(fullContent.length / 4),
      latencyMs: Date.now() - meta.startedAt,
      status: "ok",
      cacheHit: false,
      requestId: meta.requestId,
    });
  } catch (e) {
    const norm = normalizeError(e);
    _deps.usage?.record({
      userId: meta.userId,
      provider: meta.provider,
      protocol: meta.protocol,
      model: meta.model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - meta.startedAt,
      status: "error",
      errorType: norm.type,
      errorMsg: norm.message,
      cacheHit: false,
      requestId: meta.requestId,
    });
    throw norm;
  }
}

export async function routeCompletion(req: CompletionRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<CompletionResponse> {
  if (MOCK_FORCE || ctx.mock) return mockCompletion(req);
  const cfg = pickProvider(req.model, configs);
  if (!cfg) return mockCompletion(req);
  try {
    switch (cfg.provider) {
      case "openai": return await openai.openaiCompletion(cfg, req);
      case "ollama": return await ollama.ollamaCompletion(cfg, req);
      case "generic-openai": return await generic.genericOpenAICompletion(cfg, req);
      case "anthropic":
        // Anthropic 没有 /v1/completions,降级到 chat(用 prompt 包成 user message)
        const chatResp = await anthropic.anthropicChat(cfg, {
          model: req.model,
          messages: [{ role: "user", content: typeof req.prompt === "string" ? req.prompt : req.prompt.join("\n") }],
          temperature: req.temperature, top_p: req.top_p, n: req.n, stop: req.stop, max_tokens: req.max_tokens, user: req.user, stream: false,
        });
        // 把 chat response 包装成 completion response
        return {
          id: chatResp.id,
          object: "text_completion" as const,
          created: chatResp.created,
          model: chatResp.model,
          choices: chatResp.choices.map((c) => ({
            text: c.message.content,
            index: c.index,
            finish_reason: (c.finish_reason === "tool_calls" || c.finish_reason === "content_filter") ? "stop" : c.finish_reason,
          })),
          usage: chatResp.usage,
        };
      default: return mockCompletion(req);
    }
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function routeEmbedding(req: EmbeddingRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<EmbeddingResponse> {
  if (MOCK_FORCE || ctx.mock) return mockEmbedding(req);
  const cfg = pickProvider(req.model, configs);
  if (!cfg) return mockEmbedding(req);
  try {
    switch (cfg.provider) {
      case "openai": return await openai.openaiEmbedding(cfg, req);
      case "ollama": return await ollama.ollamaEmbedding(cfg, req);
      case "generic-openai": return await generic.genericOpenAIEmbedding(cfg, req);
      case "anthropic":
        throw new Error("anthropic 不支持 embeddings");
      default: return mockEmbedding(req);
    }
  } catch (e) {
    throw normalizeError(e);
  }
}

// ============================================================
// 错误归一化
// ============================================================

export type NormalizedError = {
  type: "auth" | "rate_limit" | "bad_request" | "timeout" | "upstream" | "internal";
  status: number;
  message: string;
  retryable: boolean;
};

export function normalizeError(e: unknown): NormalizedError {
  if (!(e instanceof Error)) {
    return { type: "internal", status: 500, message: String(e), retryable: false };
  }
  const msg = e.message;
  // fetch 抛的 TypeError(网络) → 走 upstream
  if (msg.startsWith("HTTP ")) {
    const m = msg.match(/^HTTP (\d+):\s*(.*)/s);
    if (m) {
      const status = parseInt(m[1], 10);
      const body = m[2].slice(0, 500);
      if (status === 401 || status === 403) {
        return { type: "auth", status, message: `provider auth failed: ${body}`, retryable: false };
      }
      if (status === 429) {
        return { type: "rate_limit", status, message: `rate limited: ${body}`, retryable: true };
      }
      if (status >= 500) {
        return { type: "upstream", status, message: `upstream error: ${body}`, retryable: true };
      }
      if (status === 408 || status === 504) {
        return { type: "timeout", status, message: `timeout: ${body}`, retryable: true };
      }
      return { type: "bad_request", status, message: `provider error: ${body}`, retryable: false };
    }
  }
  // Node fetch 失败 / AbortError 等
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
    return { type: "upstream", status: 502, message: `upstream unreachable: ${msg}`, retryable: true };
  }
  if (msg.includes("timeout") || msg.includes("aborted") || msg.includes("AbortError")) {
    return { type: "timeout", status: 504, message: `timeout: ${msg}`, retryable: true };
  }
  return { type: "internal", status: 500, message: msg, retryable: false };
}
