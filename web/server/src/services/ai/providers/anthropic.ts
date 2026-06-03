/**
 * Anthropic provider
 *
 * - Anthropic API 路径 https://api.anthropic.com/v1/messages
 * - 协议与 OpenAI 不同(自己的 schema)
 * - 本 adapter 把 OpenAI ChatRequest 转换 → Anthropic body,再把响应转回 OpenAI
 *
 * 不支持的字段在转换时跳过,日志记录警告。
 */

import type {
  ChatRequest,
  ChatResponse,
  ChatChunk,
  ProviderConfig,
} from "../types.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContent[] };
type AnthropicBody = {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
};

function makeHeaders(cfg: ProviderConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

function openAIToAnthropic(req: ChatRequest): AnthropicBody {
  let systemText: string | undefined;
  const messages: AnthropicMessage[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      systemText = (m as any).content;
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: (m as any).content });
    }
    // tool / function role 暂不处理
  }
  if (!messages.length) {
    throw new Error("anthropic: messages 为空(至少需要一条 user/assistant)");
  }
  return {
    model: req.model,
    messages,
    system: systemText,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature,
    top_p: req.top_p,
    stop_sequences: Array.isArray(req.stop) ? req.stop : req.stop ? [req.stop] : undefined,
    stream: req.stream,
  };
}

function newId(): string {
  return "chatcmpl-" + Math.random().toString(36).slice(2, 14);
}

export async function anthropicChat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  const base = (cfg.baseUrl || ANTHROPIC_API_BASE).replace(/\/+$/, "");
  const body = openAIToAnthropic(req);
  const resp = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: makeHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`anthropic HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data: any = await resp.json();
  const text = Array.isArray(data.content) ? data.content.find((c: any) => c.type === "text")?.text ?? "" : "";
  return {
    id: data.id || newId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: data.model || req.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: data.stop_reason === "max_tokens" ? "length" : "stop",
      },
    ],
    usage: data.usage
      ? {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0,
          total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        }
      : undefined,
  };
}

export async function anthropicChatStream(cfg: ProviderConfig, req: ChatRequest): Promise<AsyncIterable<ChatChunk>> {
  const base = (cfg.baseUrl || ANTHROPIC_API_BASE).replace(/\/+$/, "");
  const body = openAIToAnthropic({ ...req, stream: true });
  const resp = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: makeHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`anthropic HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  const id = newId();
  const created = Math.floor(Date.now() / 1000);
  const model = req.model;
  // 解析 Anthropic SSE:event: message_start/content_block_delta/message_delta
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
          // 找 content_block_delta 的 delta.text
          const events = buffer.split(/\n\n/);
          buffer = events.pop() || "";
          let latestText: string | undefined;
          for (const ev of events) {
            if (ev.includes("event: content_block_delta")) {
              const m = ev.match(/"text"\s*:\s*"([^"]*)"/);
              if (m) latestText = (latestText || "") + m[1].replace(/\\n/g, "\n");
            }
          }
          if (latestText !== undefined) {
            const chunk: ChatChunk = {
              id, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { content: latestText }, finish_reason: null }],
            };
            return { value: chunk, done: false };
          }
          // 没文本 → 拿下一个
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}
