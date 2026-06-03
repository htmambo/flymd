/**
 * 通用 OpenAI 兼容 provider
 *
 * 用于:
 *  - OneAPI / API2D / OpenAI-Azure 等国内/聚合代理
 *  - 自部署 vLLM / Ollama / LM Studio / LocalAI 等
 *  - 任何 /v1/chat/completions 端点
 *
 * 与 openai.ts 的区别:openai.ts 用 openai SDK,本 provider 用裸 fetch,
 * 因为有些"OpenAI 兼容"端点在 SDK 严格校验下会失败。
 */

import type {
  ChatRequest,
  ChatResponse,
  ChatChunk,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig,
} from "../types.js";

function makeUrl(cfg: ProviderConfig, path: string): string {
  const base = (cfg.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  // baseUrl 通常含 /v1 → 直接拼;否则补 /v1
  return base.endsWith("/v1") ? `${base}${path}` : `${base}/v1${path}`;
}

function newId(): string {
  return "chatcmpl-" + Math.random().toString(36).slice(2, 14);
}

function stripUndefined(o: any): any {
  const out: any = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export async function genericOpenAIChat(
  cfg: ProviderConfig,
  req: ChatRequest,
  extraBody: Record<string, unknown> = {},
): Promise<ChatResponse> {
  const body = stripUndefined({
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stop: req.stop,
    max_tokens: req.max_tokens,
    presence_penalty: req.presence_penalty,
    frequency_penalty: req.frequency_penalty,
    user: req.user,
    stream: false,
    ...extraBody,
  });
  const resp = await fetch(makeUrl(cfg, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  return (await resp.json()) as ChatResponse;
}

export async function genericOpenAIChatStream(
  cfg: ProviderConfig,
  req: ChatRequest,
  extraBody: Record<string, unknown> = {},
): Promise<AsyncIterable<ChatChunk>> {
  const body = stripUndefined({
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stop: req.stop,
    max_tokens: req.max_tokens,
    presence_penalty: req.presence_penalty,
    frequency_penalty: req.frequency_penalty,
    user: req.user,
    stream: true,
    ...extraBody,
  });
  const resp = await fetch(makeUrl(cfg, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  const id = newId();
  const created = Math.floor(Date.now() / 1000);
  const model = req.model;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const { value, done } = await reader.read();
          if (done) return { value: undefined as any, done: true };
          buffer += decoder.decode(value, { stream: true });
          // 找完整 SSE 事件
          const events = buffer.split(/\n\n/);
          buffer = events.pop() || "";
          for (const ev of events) {
            const m = ev.match(/^data:\s*(.+)$/m);
            if (!m) continue;
            if (m[1].trim() === "[DONE]") continue;
            try {
              const obj = JSON.parse(m[1]);
              if (obj.choices?.[0]?.delta?.content !== undefined) {
                return {
                  value: {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    choices: [{
                      index: 0,
                      delta: { content: obj.choices[0].delta.content },
                      finish_reason: obj.choices[0].finish_reason || null,
                    }],
                  } as ChatChunk,
                  done: false,
                };
              }
            } catch {}
          }
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}

export async function genericOpenAICompletion(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResponse> {
  const body = stripUndefined({
    model: req.model,
    prompt: req.prompt,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stop: req.stop,
    max_tokens: req.max_tokens,
    user: req.user,
    stream: false,
  });
  const resp = await fetch(makeUrl(cfg, "/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  return (await resp.json()) as CompletionResponse;
}

export async function genericOpenAIEmbedding(cfg: ProviderConfig, req: EmbeddingRequest): Promise<EmbeddingResponse> {
  const resp = await fetch(makeUrl(cfg, "/embeddings"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(stripUndefined({ model: req.model, input: req.input, user: req.user })),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  return (await resp.json()) as EmbeddingResponse;
}
