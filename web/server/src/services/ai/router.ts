/**
 * AI gateway router
 *
 * 职责:
 *  1. 根据 model 名 + settings 选 provider
 *  2. 读 settings 里的 provider config(apiKey / baseUrl / enabled)
 *  3. 调对应 provider 的 chat / completion / embedding
 *  4. 错误归一化(401/403/429/5xx/超时)
 *  5. 用量日志(api_call_logs 表,留给后续 iteration)
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
    const protocol = String(fields.protocol || "openai-native") as ProviderName;
    // 验证 protocol 合法
    if (!["openai", "anthropic", "ollama", "generic-openai"].includes(protocol)) continue;
    if ((fields.enabled as any) === false) continue;
    const apiKey = String(fields.apiKey || "");
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
// 入口:chat / completion / embedding
// ============================================================

export async function routeChat(req: ChatRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<ChatResponse> {
  if (MOCK_FORCE || ctx.mock) {
    return mockChat(req);
  }
  const cfg = pickProvider(req.model, configs);
  if (!cfg) return mockChat(req); // 降级
  try {
    switch (cfg.provider) {
      case "openai": return await openai.openaiChat(cfg, req);
      case "anthropic": return await anthropic.anthropicChat(cfg, req);
      case "ollama": return await ollama.ollamaChat(cfg, req);
      case "generic-openai": return await generic.genericOpenAIChat(cfg, req);
      default: return mockChat(req);
    }
  } catch (e) {
    throw normalizeError(e);
  }
}

export async function routeChatStream(req: ChatRequest, configs: ProviderConfig[], ctx: RouterContext): Promise<AsyncIterable<ChatChunk>> {
  if (MOCK_FORCE || ctx.mock) {
    return mockChatStream(req);
  }
  const cfg = pickProvider(req.model, configs);
  if (!cfg) return mockChatStream(req);
  try {
    switch (cfg.provider) {
      case "openai": return await openai.openaiChatStream(cfg, req);
      case "anthropic": return await anthropic.anthropicChatStream(cfg, req);
      case "ollama": return await ollama.ollamaChatStream(cfg, req);
      case "generic-openai": return await generic.genericOpenAIChatStream(cfg, req);
      default: return mockChatStream(req);
    }
  } catch (e) {
    throw normalizeError(e);
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
