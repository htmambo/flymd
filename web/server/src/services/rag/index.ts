/**
 * RAG 模块 — 公开 API 集中导出
 *
 * 内部模块:
 *   ./pure       — 纯函数(cosine / chunker / chunkId)
 *   ./ssrf       — baseUrl 校验
 *   ./service    — 业务编排(RagService + 默认 deps)
 *
 * 本文件:
 *   - 集中 re-export,方便 `import { ... } from "services/rag"`
 *   - 工厂 `createRagService` 用于 app 接线时一次性注入
 */

export * from "./pure.js";
export {
  validateBaseUrl,
  isPrivateOrLoopbackIPv4,
  isPrivateOrLoopbackIPv6,
  isHardBlockedIPv4,
  isHardBlockedIPv6,
  DEFAULT_ALLOWLIST,
  type ValidateOptions,
  type ValidateResult,
} from "./ssrf.js";
export {
  RagService,
  FileIndexReader,
  OpenAIEmbedder,
  formatContext,
  buildAskPrompt,
  DEFAULT_SYSTEM_PROMPT,
  getLibraryId,
  getIndexDir,
  type RagIndex,
  type Embedder,
  type Llm,
  type LlmUsage,
  type IndexReader,
  type SearchOptions,
  type AskOptions,
  type RagServiceDeps,
} from "./service.js";

import { RagService, FileIndexReader, type RagServiceDeps } from "./service.js";

/**
 * 工厂:用 FileIndexReader + 调用方提供的 embedder/llm 构造 RagService
 *
 * @param deps.embedder - 必填,如何把 string[] → number[][]
 * @param deps.llm - 必填,如何完成 chat
 * @param deps.indexReader - 可选,默认 FileIndexReader
 */
export function createRagService(
  deps: Omit<RagServiceDeps, "indexReader"> & { indexReader?: FileIndexReader },
): RagService {
  return new RagService({
    indexReader: deps.indexReader || new FileIndexReader(),
    embedder: deps.embedder,
    llm: deps.llm,
  });
}
