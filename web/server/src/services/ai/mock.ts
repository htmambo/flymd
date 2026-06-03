/**
 * Mock provider — 完全不依赖真 API,所有响应固定
 *
 * 用途:
 *  1. dev 模式无 API key 时
 *  2. MOCK_PROVIDER=1 env 强制开启(用于自动化测试)
 *  3. provider config 缺失 / 禁用时 fallback
 *
 * 设计原则:**走完整 router 路径**,只是最后一步不调真 API,
 * 这样 mock 模式下也能验证 router / settings / 错误处理。
 */

import type {
  ChatRequest,
  ChatResponse,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ChatChunk,
} from "./types.js";

function makeId(): string {
  return "mock-" + Math.random().toString(36).slice(2, 12);
}

export function mockChat(req: ChatRequest): ChatResponse {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser && "content" in lastUser ? String(lastUser.content || "") : "";
  const reply = `[mock ${req.model}] 收到 ${userText.length} 字消息: "${userText.slice(0, 120)}"\n\n本机 mock,不调用真实 AI。`;
  return {
    id: makeId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: req.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: reply },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function mockChatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser && "content" in lastUser ? String(lastUser.content || "") : "";
  const reply = mockChat(req).choices[0].message.content;
  const id = makeId();
  const created = Math.floor(Date.now() / 1000);

  const chunks: string[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const s = Math.floor((reply.length * i) / n);
    const e = Math.floor((reply.length * (i + 1)) / n);
    chunks.push(reply.slice(s, e));
  }
  if (userText) chunks.unshift("");

  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) {
            return { value: undefined as any, done: true };
          }
          const isFirst = i === 0;
          const chunk: ChatChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: req.model,
            choices: [
              {
                index: 0,
                delta: isFirst ? { role: "assistant" } : {},
                content: chunks[i],
              } as any,
            ],
          };
          i++;
          return { value: chunk, done: false };
        },
      };
    },
  };
}

export function mockCompletion(req: CompletionRequest): CompletionResponse {
  const prompt = Array.isArray(req.prompt) ? req.prompt[0] : req.prompt;
  return {
    id: makeId(),
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model: req.model,
    choices: [
      {
        text: `[mock ${req.model}] ${String(prompt).slice(0, 200)}`,
        index: 0,
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function mockEmbedding(req: EmbeddingRequest): EmbeddingResponse {
  const input = Array.isArray(req.input) ? req.input : [String(req.input)];
  return {
    object: "list",
    data: input.map((t, i) => ({
      object: "embedding",
      embedding: Array.from({ length: 8 }, (_, j) => Math.sin((i + 1) * (j + 1) * 0.13)),
      index: i,
    })),
    model: req.model,
    usage: { prompt_tokens: 0, total_tokens: 0 },
  };
}
