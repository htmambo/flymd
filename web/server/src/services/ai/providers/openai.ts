/**
 * OpenAI provider
 *
 * - 调 https://api.openai.com/v1/chat/completions
 * - 流式调 https://api.openai.com/v1/chat/completions (stream=true) 用 SSE
 * - 也支持 Azure OpenAI(改 baseUrl)
 */

import OpenAI from "openai";
import type { ChatRequest, ChatResponse, ChatChunk, CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, ProviderConfig } from "../types.js";

function makeClient(cfg: ProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl || "https://api.openai.com/v1",
    timeout: 60_000,
    maxRetries: 0, // 我们自己做重试
  });
}

export async function openaiChat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  const client = makeClient(cfg);
  const params: any = {
    model: req.model,
    messages: req.messages as any,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stop: req.stop,
    max_tokens: req.max_tokens,
    presence_penalty: req.presence_penalty,
    frequency_penalty: req.frequency_penalty,
    user: req.user,
  };
  // 去掉 undefined
  for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
  const resp = await client.chat.completions.create(params);
  return resp as unknown as ChatResponse;
}

export async function openaiChatStream(cfg: ProviderConfig, req: ChatRequest): Promise<AsyncIterable<ChatChunk>> {
  const client = makeClient(cfg);
  const stream = await client.chat.completions.create({
    model: req.model,
    messages: req.messages as any,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stop: req.stop,
    max_tokens: req.max_tokens,
    presence_penalty: req.presence_penalty,
    frequency_penalty: req.frequency_penalty,
    user: req.user,
    stream: true,
  } as any);
  return stream as unknown as AsyncIterable<ChatChunk>;
}

export async function openaiCompletion(cfg: ProviderConfig, req: CompletionRequest): Promise<CompletionResponse> {
  const client = makeClient(cfg);
  const resp = await client.completions.create({
    model: req.model,
    prompt: req.prompt as any,
    temperature: req.temperature,
    top_p: req.top_p,
    n: req.n,
    stream: false,
    stop: req.stop,
    max_tokens: req.max_tokens,
    user: req.user,
  } as any);
  return resp as unknown as CompletionResponse;
}

export async function openaiEmbedding(cfg: ProviderConfig, req: EmbeddingRequest): Promise<EmbeddingResponse> {
  const client = makeClient(cfg);
  const resp = await client.embeddings.create({
    model: req.model,
    input: req.input as any,
    user: req.user,
  } as any);
  return resp as unknown as EmbeddingResponse;
}
