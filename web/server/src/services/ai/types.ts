/**
 * AI gateway 共享类型(OpenAI 兼容)
 *
 * 客户端 → router → provider → (转 native body) → 真 API → 响应 → (转 OpenAI 格式) → 客户端
 */

// ========== 客户端 → 服务端 ==========

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; name?: string }
  | { role: "tool"; content: string; tool_call_id: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  // 扩展字段(非 OpenAI 标准,但很多兼容)
  top_k?: number;
  repetition_penalty?: number;
};

export type CompletionRequest = {
  model: string;
  prompt: string | string[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  user?: string;
};

export type EmbeddingRequest = {
  model: string;
  input: string | string[] | number[][];
  user?: string;
};

// ========== 服务端 → 客户端(OpenAI 格式) ==========

export type ChatChoice = {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
};

export type ChatResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  system_fingerprint?: string;
};

export type ChatChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
};

export type CompletionChoice = {
  text: string;
  index: number;
  finish_reason: "stop" | "length" | null;
};

export type CompletionResponse = {
  id: string;
  object: "text_completion";
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type EmbeddingData = {
  object: "embedding";
  embedding: number[];
  index: number;
};

export type EmbeddingResponse = {
  object: "list";
  data: EmbeddingData[];
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
};

// ========== 服务端内部 ==========

export type ProviderName = "openai" | "anthropic" | "ollama" | "generic-openai" | "mock";

export type ProviderConfig = {
  provider: ProviderName;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
  /** 每分钟最大请求数(用于限流) */
  maxRpm?: number;
  /** 兼容字段: temperature 默认值 */
  defaultTemperature?: number;
};

export type RouterContext = {
  userId: string | null;
  /** 用于日志关联 */
  requestId: string;
  /** 是否 mock-mode(无真 API key) */
  mock: boolean;
};
