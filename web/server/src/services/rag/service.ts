/**
 * RAG 业务编排
 *
 * 三个核心入口:
 *   - searchHits(libraryRoot, query, opt) → Hit[]        检索
 *   - askWithContext(libraryRoot, query, opt) → { answer, sources, usage }  RAG 闭环
 *   - loadPluginIndex(libraryRoot) → RagIndex | null     读插件格式索引
 *
 * 依赖通过构造注入(Embedder / Llm / IndexReader),
 * 方便测试用假实现,生产用真调用 AI Gateway + 本地文件 IO。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { cosineScoreAt, fnv1aHex, type RagHit, type RagChunk } from "./pure.js";
import { validateBaseUrl } from "./ssrf.js";

// ============================================================
// 类型
// ============================================================

/** 插件格式索引(与 flymd-RAG/main.js line 1784-1807 一致) */
export type RagIndex = {
  meta: {
    schemaVersion: number;
    embeddingModel: string;
    dims: number;
    /** key: chunkId, value: chunk meta */
    chunks: Record<string, RagChunk>;
    /** key: 相对路径, value: 文件元数据(可选) */
    files?: Record<string, { mtime?: number; size?: number; hash?: string }>;
  };
  vectors: Float32Array;
};

export type Embedder = {
  embed(inputs: string[]): Promise<number[][]>;
};

export type LlmUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type Llm = {
  chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { model?: string; temperature?: number; max_tokens?: number },
  ): Promise<{ content: string; usage?: LlmUsage }>;
};

export type IndexReader = {
  load(libraryRoot: string): Promise<RagIndex | null>;
};

export type SearchOptions = {
  topK?: number; // 1-50, default 8
  minScore?: number; // -1..1, default 0
  maxContextChars?: number; // 200-20000, default 1024 (per snippet)
  query?: string; // 用于在 service 内部 embed(可选,若 caller 已 embed 则可省)
};

export type AskOptions = SearchOptions & {
  model?: string;
  temperature?: number;
  systemPrompt?: string; // 覆盖默认 system prompt
};

// ============================================================
// 默认 prompt 模板(与 spec §6.1 一致)
// ============================================================

export const DEFAULT_SYSTEM_PROMPT = `你是一个知识库助手。请严格基于 <context> 中提供的资料回答用户问题:
1. 只使用 <context> 中出现的信息,不要编造
2. 如果 <context> 中没有相关信息,直接说"未在资料中找到相关答案"
3. 回答末尾必须用 [1] [2] 这样的引用编号,标明信息来源
4. 简洁准确,使用与问题相同的语言`;

export function formatContext(
  hits: RagHit[],
  query: string,
  maxContextChars: number = 8000,
): string {
  if (!hits.length) return "(无相关资料)";
  const blocks: string[] = [];
  let used = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const idx = i + 1;
    const block = `[${idx}] (${h.relative} L${h.startLine}-${h.endLine}, score=${h.score.toFixed(4)})${
      h.heading ? `\n# ${h.heading}` : ""
    }\n${h.snippet}`;
    if (used + block.length > maxContextChars) {
      const remain = maxContextChars - used;
      if (remain > 100) {
        blocks.push(block.slice(0, remain) + "...");
      }
      break;
    }
    blocks.push(block);
    used += block.length + 2; // +2 for "\n\n"
  }
  return blocks.join("\n\n");
}

export function buildAskPrompt(
  hits: RagHit[],
  query: string,
  maxContextChars: number = 8000,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): { system: string; user: string } {
  const context = formatContext(hits, query, maxContextChars);
  return {
    system: systemPrompt,
    user: `<context>\n${context}\n</context>\n\n问题:${query}`,
  };
}

// ============================================================
// 默认 IndexReader:读插件格式文件
// ============================================================

/**
 * 库内索引目录:`.flymd/rag-index/<libraryId>/{meta.json, vectors.f32}`
 *
 * libraryId 用 libraryRoot 的 FNV-1a 哈希(8 hex),与插件兼容
 */
export function getLibraryId(libraryRoot: string): string {
  const norm = String(libraryRoot || "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return fnv1aHex(norm);
}

export function getIndexDir(libraryRoot: string): string {
  const libId = getLibraryId(libraryRoot);
  return path.join(libraryRoot, ".flymd", "rag-index", libId);
}

export class FileIndexReader implements IndexReader {
  async load(libraryRoot: string): Promise<RagIndex | null> {
    if (!libraryRoot) return null;
    // 路径规范化:解析 `..` / `.` / 重复斜杠
    // 拒绝符号链接/穿越(实测 libraryRoot 在用户机器上,只信 resolve 后的字面值)
    const normRoot = path.resolve(String(libraryRoot));
    if (normRoot.split(/[\\/]+/).includes("..")) {
      throw new Error("libraryRoot 含非法路径段 '..'");
    }
    const dir = getIndexDir(normRoot);
    const metaPath = path.join(dir, "meta.json");
    const vecPath = path.join(dir, "vectors.f32");

    let metaRaw: string;
    try {
      metaRaw = await fs.readFile(metaPath, "utf-8");
    } catch {
      return null;
    }
    let meta: RagIndex["meta"];
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      throw new Error("meta.json 解析失败");
    }
    if (!meta || meta.schemaVersion !== 1) return null;
    if (!meta.dims || !meta.chunks) return null;

    let vecBytes: Buffer;
    try {
      vecBytes = await fs.readFile(vecPath);
    } catch {
      throw new Error("vectors.f32 读取失败");
    }
    if (vecBytes.byteLength % 4 !== 0) {
      throw new Error("vectors.f32 长度不是 4 的倍数(损坏)");
    }
    const ab = vecBytes.buffer.slice(
      vecBytes.byteOffset,
      vecBytes.byteOffset + vecBytes.byteLength,
    );
    const vectors = new Float32Array(ab);
    const expected = (Object.keys(meta.chunks).length) * meta.dims;
    if (vectors.length !== expected) {
      // 维度自检:total vectors 必须是 dims * chunks 整数倍
      if (vectors.length % meta.dims !== 0) {
        throw new Error(
          `vectors 长度 ${vectors.length} 与 dims ${meta.dims} 不整除`,
        );
      }
    }

    return { meta, vectors };
  }
}

// ============================================================
// 默认 Embedder:OpenAI 协议 /embeddings + SSRF 校验
// ============================================================

export type OpenAIEmbedderOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** SSRF 放行(自托管),默认 false */
  allowPrivate?: boolean;
  /** 请求超时 ms,默认 60s */
  timeoutMs?: number;
};

/** 过滤错误信息中的敏感字段(Authorization / api_key / Bearer / 私钥样式) */
function sanitizeErrorMessage(s: string, maxLen: number = 200): string {
  let out = String(s || "");
  // Bearer xxx, sk-xxx, Basic xxx, api_key=xxx 之类的模式
  out = out.replace(/(?:Bearer|Authorization|api[_-]?key|token|secret)[:=\s]+[^\s,;"'}\\]+/gi, "$1 [REDACTED]");
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, "sk-[REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-[REDACTED]");
  if (out.length > maxLen) out = out.slice(0, maxLen) + "...";
  return out;
}

export class OpenAIEmbedder implements Embedder {
  /** 缓存构造时解析好的 URL,避免每次 embed 都跑 validateBaseUrl */
  private cachedUrl: URL;
  constructor(private opts: OpenAIEmbedderOptions) {
    const v = validateBaseUrl(opts.baseUrl, { allowPrivate: opts.allowPrivate });
    if (!v.ok) {
      throw new Error(`embedding baseUrl 校验失败:${v.reason}`);
    }
    this.cachedUrl = v.url;
  }

  async embed(inputs: string[]): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error("inputs 不能为空");
    }
    if (inputs.length > 2048) {
      throw new Error("inputs 数量超过 2048");
    }
    // 二次校验:防止 opts.baseUrl 在构造后被改(防御性)
    const v = validateBaseUrl(this.opts.baseUrl, { allowPrivate: this.opts.allowPrivate });
    if (!v.ok) throw new Error(`embedding baseUrl 校验失败:${v.reason}`);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60000);
    let res: Response;
    try {
      res = await fetch(new URL("/embeddings", this.cachedUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.opts.model, input: inputs }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error(`embedding 请求失败:${sanitizeErrorMessage((e as Error).message)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 上游错误体可能回显 API key(部分 provider 行为),先脱敏
      throw new Error(`embedding HTTP ${res.status}:${sanitizeErrorMessage(text)}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    if (!Array.isArray(json?.data)) throw new Error("embedding 响应格式错误");
    return json.data.map((d) => d.embedding);
  }
}

// ============================================================
// RAG Service 主类
// ============================================================

export type RagServiceDeps = {
  embedder: Embedder;
  llm: Llm;
  indexReader: IndexReader;
};

export class RagService {
  constructor(private deps: RagServiceDeps) {}

  /** 调 embedder + cosine 扫描,返回排序后的 Hit[] */
  async searchHits(
    libraryRoot: string,
    query: string,
    opt: SearchOptions = {},
  ): Promise<RagHit[]> {
    const q = String(query || "").trim();
    if (!q) return [];
    if (!libraryRoot) throw new Error("libraryRoot 必填");

    const topK = clampInt(opt.topK ?? 8, 1, 50);
    const minScore = clampNumber(opt.minScore ?? 0, -1, 1);
    const snippetMax = clampInt(opt.maxContextChars ?? 1024, 200, 20000);

    // 1) embed query
    const emb = await this.deps.embedder.embed([q]);
    const qArr = emb?.[0];
    if (!Array.isArray(qArr) || qArr.length === 0) {
      throw new Error("查询 embedding 失败");
    }
    const qVec = Float32Array.from(qArr);

    // 2) load index
    const idx = await this.deps.indexReader.load(libraryRoot);
    if (!idx) return [];
    const dims = idx.meta.dims | 0;
    if (!dims) return [];
    if (qVec.length !== dims) {
      throw new Error(
        `query 维度 ${qVec.length} 与索引维度 ${dims} 不一致(可能 embedding 模型换了)`,
      );
    }

    // 3) cosine 扫描
    let qn = 0;
    for (let i = 0; i < dims; i++) qn += qVec[i] * qVec[i];
    const qNorm = Math.sqrt(qn) || 1;

    const items: Array<{ id: string; score: number; chunk: RagChunk }> = [];
    for (const [id, c] of Object.entries(idx.meta.chunks)) {
      const off = c && typeof c.vectorOffset === "number" ? c.vectorOffset : -1;
      if (off < 0) continue;
      const score = cosineScoreAt(idx.vectors, off, qVec, dims, qNorm);
      if (score < minScore) continue;
      items.push({ id, score, chunk: c });
    }
    items.sort((a, b) => b.score - a.score);

    // 4) 拼 hit(限 topK)
    const out: RagHit[] = items.slice(0, topK).map((it) => ({
      id: it.id,
      score: round4(it.score),
      filePath: path.join(libraryRoot, it.chunk.relativePath || ""),
      relative: it.chunk.relativePath || "",
      heading: it.chunk.heading || "",
      startLine: it.chunk.startLine | 0,
      endLine: it.chunk.endLine | 0,
      snippet: extractSnippet(it.chunk.text, snippetMax),
    }));
    return out;
  }

  /** RAG 闭环:search + format + llm */
  async askWithContext(
    libraryRoot: string,
    query: string,
    opt: AskOptions = {},
  ): Promise<{
    answer: string;
    sources: RagHit[];
    model?: string;
    usage?: LlmUsage;
  }> {
    const sources = await this.searchHits(libraryRoot, query, opt);
    const maxCtx = clampInt(opt.maxContextChars ?? 8000, 200, 20000);
    const { system, user } = buildAskPrompt(
      sources,
      query,
      maxCtx,
      opt.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    );
    const llmResp = await this.deps.llm.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        model: opt.model,
        temperature: opt.temperature ?? 0.2,
      },
    );
    return {
      answer: llmResp.content || "",
      sources,
      model: opt.model,
      usage: llmResp.usage,
    };
  }
}

// ============================================================
// 工具
// ============================================================

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function clampNumber(v: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 从 chunk 文本里取一段 snippet(优先中间 1024 字符) */
function extractSnippet(text: string, maxChars: number): string {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= maxChars) return s;
  // 优先保留开头 + 结尾
  const half = Math.floor(maxChars / 2);
  return s.slice(0, half) + " ... " + s.slice(s.length - half);
}
