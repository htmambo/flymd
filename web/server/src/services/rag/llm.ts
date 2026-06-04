/**
 * 默认 LLM + Embedder 适配器:把 AI gateway 包成 RagService 期待的接口
 *
 * Llm 走 routeChat(继承 cache/usage/retry/alert)
 * Embedder 走 OpenAI 协议 /embeddings(用 provider 自己的 baseUrl + apiKey)
 *
 * 这样 RagService 不需要知道 provider / config / ctx 的细节,
 * 上层 route 只调 ragService.askWithContext,内部自动用 AI gateway。
 */
import { routeChat } from "../ai/router.js";
import { loadProviderConfigs } from "../ai/router.js";
import { OpenAIEmbedder, type Embedder, type Llm, type LlmUsage } from "./index.js";
import type { SettingsService } from "../settings.js";

/** 从 settings 读所有 provider configs(unmask) */
function readConfigs(settings: SettingsService): ReturnType<typeof loadProviderConfigs> {
  const list = settings.list({ unmask: true });
  return loadProviderConfigs(list as Array<{ key: string; value: unknown }>);
}

export type AiGatewayOptions = {
  settings: SettingsService;
  userId?: string | null;
  requestId?: string;
};

/** 默认 Llm:复用 AI Gateway 的 routeChat(继承 cache/usage/retry/alert) */
export class AiGatewayLlm implements Llm {
  constructor(private opts: AiGatewayOptions) {}

  async chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    chatOpts: { model?: string; temperature?: number; max_tokens?: number },
  ): Promise<{ content: string; usage?: LlmUsage }> {
    const model = chatOpts.model || "auto";
    const configs = readConfigs(this.opts.settings);
    const resp = await routeChat(
      {
        model,
        messages,
        temperature: chatOpts.temperature ?? 0.2,
        max_tokens: chatOpts.max_tokens,
        stream: false,
      },
      configs,
      {
        userId: this.opts.userId ?? null,
        requestId: this.opts.requestId || "rag-service",
        mock: false,
      },
    );
    const content = resp.choices?.[0]?.message?.content || "";
    return {
      content,
      usage: resp.usage
        ? {
            prompt_tokens: resp.usage.prompt_tokens,
            completion_tokens: resp.usage.completion_tokens,
            total_tokens: resp.usage.total_tokens,
          }
        : undefined,
    };
  }
}

/** 找第一个有 baseUrl + apiKey 的 provider,用于 embedding */
function pickEmbeddingProvider(settings: SettingsService): { baseUrl: string; apiKey: string; model: string } | null {
  const configs = readConfigs(settings);
  for (const c of configs) {
    if (c.provider === "ollama") {
      // ollama 通常无 apiKey,但有 baseUrl
      if (c.baseUrl) {
        return {
          baseUrl: c.baseUrl.replace(/\/+$/, ""),
          apiKey: c.apiKey || "",
          model: c.defaultModel || "nomic-embed-text",
        };
      }
      continue;
    }
    if (c.baseUrl && c.apiKey) {
      return {
        baseUrl: c.baseUrl.replace(/\/+$/, ""),
        apiKey: c.apiKey,
        model: c.defaultModel || "text-embedding-3-small",
      };
    }
  }
  return null;
}

/** 默认 Embedder:用 AI provider 的 baseUrl + apiKey 调 /embeddings */
export class AiGatewayEmbedder implements Embedder {
  private inner: OpenAIEmbedder | null = null;
  private model = "text-embedding-3-small";
  constructor(private opts: AiGatewayOptions) {
    const picked = pickEmbeddingProvider(opts.settings);
    if (picked) {
      try {
        this.inner = new OpenAIEmbedder({
          baseUrl: picked.baseUrl,
          apiKey: picked.apiKey,
          model: picked.model,
        });
        this.model = picked.model;
      } catch (e) {
        // baseUrl 校验失败(私网)→ 留 null,等请求时报错
        this.inner = null;
      }
    }
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!this.inner) {
      throw new Error(
        "未配置可用 embedding provider(需要 baseUrl + apiKey 且 baseUrl 通过 SSRF 校验)",
      );
    }
    return this.inner.embed(inputs);
  }
}
