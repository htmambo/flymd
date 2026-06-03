/**
 * Ollama provider
 *
 * Ollama 默认在 http://localhost:11434
 * 提供 /v1/chat/completions 等 OpenAI 兼容端点
 * 所以 adapter 与 generic-openai 类似,只是 baseUrl 不同
 *
 * 特殊:支持 top_k / repetition_penalty 等 Ollama 扩展参数
 */

import { genericOpenAIChat, genericOpenAIChatStream, genericOpenAICompletion, genericOpenAIEmbedding } from "./generic-openai.js";
import type { ChatRequest, ChatResponse, ChatChunk, CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, ProviderConfig } from "../types.js";

const OLLAMA_DEFAULT_BASE = "http://localhost:11434";

export function ollamaDefaultBaseUrl(): string {
  return OLLAMA_DEFAULT_BASE;
}

export async function ollamaChat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  // Ollama 扩展参数:top_k / repetition_penalty
  const r = req as any;
  const extra: Record<string, unknown> = {};
  if (r.top_k !== undefined) extra.top_k = r.top_k;
  if (r.repetition_penalty !== undefined) extra.repetition_penalty = r.repetition_penalty;
  return genericOpenAIChat(cfg, req, extra);
}

export async function ollamaChatStream(cfg: ProviderConfig, req: ChatRequest): Promise<AsyncIterable<ChatChunk>> {
  const r = req as any;
  const extra: Record<string, unknown> = {};
  if (r.top_k !== undefined) extra.top_k = r.top_k;
  if (r.repetition_penalty !== undefined) extra.repetition_penalty = r.repetition_penalty;
  return genericOpenAIChatStream(cfg, req, extra);
}

export async function ollamaCompletion(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResponse> {
  return genericOpenAICompletion(cfg, req);
}

export async function ollamaEmbedding(cfg: ProviderConfig, req: EmbeddingRequest): Promise<EmbeddingResponse> {
  return genericOpenAIEmbedding(cfg, req);
}
