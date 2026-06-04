/**
 * RAG 纯函数模块
 *
 * 重要:本文件的算法必须与浏览器端 `public/plugins/flymd-RAG/main.js` 保持 1:1 对齐
 * (chunkId 格式、cosine 公式、markdown heading 切分等),以保证未来索引可平滑迁移。
 *
 * 主要对应位置:
 *   - cosine: flymd-RAG/main.js line 1825 `cosineScoreAt`
 *   - chunkId: flymd-RAG/main.js line 1767 `buildChunkId`
 *   - splitMarkdownBlocks: flymd-RAG/main.js line 1598
 *   - chunkByLines: flymd-RAG/main.js line 1743
 */

// ============================================================
// 类型
// ============================================================

/** 文档分块(与插件 meta.chunks[id] 兼容) */
export type RagChunk = {
  id: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  text: string;
  heading?: string;
  /** 在 vectors.f32 中的起始 offset(以 float32 元素计) */
  vectorOffset: number;
};

/** 检索命中 */
export type RagHit = {
  id: string;
  score: number;
  filePath: string;
  relative: string;
  heading: string;
  startLine: number;
  endLine: number;
  snippet: string;
};

/** 二级以下 markdown heading 块 */
export type MarkdownBlock = {
  start: number;
  end: number;
  heading: string;
  level: number;
};

/** chunkByLines 选项 */
export type ChunkOptions = {
  maxChars: number;
  overlapChars: number;
  byHeading: boolean;
};

// ============================================================
// FNV-1a 32-bit 哈希(必须与插件 line 116 保持一致)
// ============================================================

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit 哈希,返回 8 位 hex 字符串(与插件 fnv1aHex 一致) */
export function fnv1aHex(str: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ============================================================
// cosine 相似度(必须与插件 line 1825 保持一致)
// ============================================================

/**
 * 计算 query 与 vectors[offset..offset+dims] 之间的 cosine 相似度
 *
 * @param vectors - 拼接后的 Float32Array(包含所有 chunk 的向量)
 * @param offset - 当前 chunk 在 vectors 中的起始下标(以 float32 元素计)
 * @param query - 查询向量(已计算的 Float32Array)
 * @param dims - 向量维度
 * @param queryNorm - 已计算的 query 范数(√Σq²)
 */
export function cosineScoreAt(
  vectors: Float32Array,
  offset: number,
  query: Float32Array,
  dims: number,
  queryNorm: number,
): number {
  let dot = 0;
  let vv = 0;
  const base = offset | 0;
  for (let i = 0; i < dims; i++) {
    const v = vectors[base + i];
    dot += v * query[i];
    vv += v * v;
  }
  const denom = Math.sqrt(vv) * queryNorm;
  if (!denom) return 0;
  return dot / denom;
}

// ============================================================
// chunkId 构建(必须与插件 line 1767 保持一致)
// ============================================================

/**
 * 构造 chunk 唯一 ID
 *
 * 格式:`${rel}:${startLine}-${endLine}:${fnv1a(text)}`
 *
 * 注意:插件使用 `Math.max(1, startLine|0)`,但这里我们保持语义:行号从 1 开始
 */
export function buildChunkId(
  relativePath: string,
  startLine: number,
  endLine: number,
  text: string,
): string {
  const rel = String(relativePath || "").replace(/[\\]+/g, "/");
  const a = Math.max(1, startLine | 0);
  const b = Math.max(a, endLine | 0);
  const h = fnv1aHex(String(text || ""));
  return `${rel}:${a}-${b}:${h}`;
}

// ============================================================
// Markdown 标题解析 + 切块(必须与插件 line 1583-1738 保持一致)
// ============================================================

/** 判断是否是 code fence 切换行(``` 或 ~~~) */
function isFenceToggleLine(line: string): boolean {
  return /^\s{0,3}(```|~~~)/.test(String(line || ""));
}

/** 解析 ATX 标题行:`#` ~ `######` */
function parseAtxHeadingLine(line: string): { level: number; text: string } | null {
  const m = String(line || "").match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
  if (!m) return null;
  const level = (m[1] || "").length | 0;
  let text = String(m[2] || "").trim();
  // 兼容 "## Title ###" 这种尾部收尾
  text = text.replace(/\s+#+\s*$/, "").trim();
  if (!text) return null;
  return { level, text };
}

/**
 * 按 markdown 标题切分文档块(忽略 code fence 内的标题)
 *
 * 行为与插件 line 1598 一致:
 *   - 扫描所有 ATX heading,过滤掉 fence 内部的
 *   - 找出第一个 level >= minLevel 的 heading
 *   - 在 heading 边界切分(每个块包含 heading 之前到下一个 heading 之前)
 *   - 如果没有任何 heading → 整个文档当作一个块
 */
export function splitMarkdownBlocks(lines: string[], minLevel: number = 2): MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  const len = Array.isArray(lines) ? lines.length : 0;
  if (!len) return out;

  const heads: Array<{ i: number; level: number; text: string }> = [];
  let inFence = false;
  for (let i = 0; i < len; i++) {
    const ln = String(lines[i] || "");
    if (isFenceToggleLine(ln)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = parseAtxHeadingLine(ln);
    if (!h) continue;
    if (h.level >= (minLevel | 0)) {
      heads.push({ i, level: h.level, text: h.text });
    }
  }

  if (!heads.length) {
    out.push({ start: 0, end: len - 1, heading: "", level: 0 });
    return out;
  }

  let start = 0;
  let heading = "";
  let level = 0;
  for (const h of heads) {
    if (h.i > start) {
      out.push({ start, end: h.i - 1, heading, level });
    }
    start = h.i;
    heading = String(h.text || "");
    level = h.level | 0;
  }
  out.push({ start, end: len - 1, heading, level });
  return out;
}

/** 把 [start, end] 行范围拼成单字符串 */
function linesRangeText(lines: string[], startIdx: number, endIdx: number): string {
  const out: string[] = [];
  const a = Math.max(0, startIdx | 0);
  const b = Math.max(a, endIdx | 0);
  for (let i = a; i <= b; i++) {
    out.push(String(lines[i] || ""));
  }
  return out.join("\n");
}

/**
 * 把一个 [start, end] 范围按 maxChars 切成长度受限的子块
 *
 * 行为与插件 line 1640 `chunkLineRange` 一致(简单按行累计,超 maxChars 就切)
 */
function chunkLineRange(
  lines: string[],
  startIdx: number,
  endIdx: number,
  maxChars: number,
  overlap: number,
): Array<{ startIdx: number; endIdx: number; text: string }> {
  const chunks: Array<{ startIdx: number; endIdx: number; text: string }> = [];
  const a = Math.max(0, startIdx | 0);
  const b = Math.max(a, endIdx | 0);
  if (a > b) return chunks;

  let curStart = a;
  let curLen = 0;
  for (let i = a; i <= b; i++) {
    const lineText = String(lines[i] || "");
    const lineLen = lineText.length + (i > a ? 1 : 0); // +1 for newline
    if (curLen + lineLen > maxChars && i > curStart) {
      const text = linesRangeText(lines, curStart, i - 1);
      if (text) chunks.push({ startIdx: curStart, endIdx: i - 1, text });
      // 简化:overlapChars = 0 时,直接从 i 重新开始
      if (overlap > 0) {
        // 计算 overlap 起点(粗略按行数)
        const overlapLines = Math.max(0, Math.floor(overlap / 80));
        curStart = Math.max(a, i - overlapLines);
        curLen = linesRangeText(lines, curStart, i - 1).length;
      } else {
        curStart = i;
        curLen = 0;
      }
    }
    curLen += lineLen;
  }
  const tail = linesRangeText(lines, curStart, b);
  if (tail) chunks.push({ startIdx: curStart, endIdx: b, text: tail });
  return chunks;
}

/**
 * 把 [start, end] 行范围按 markdown heading 切分(如果 byHeading),
 * 切出的每个块再用 chunkLineRange 按 maxChars 二次切分
 *
 * 行为与插件 line 1699 `chunkMarkdownRange` + line 1743 `chunkByLines` 一致
 */
function chunkMarkdownRange(
  lines: string[],
  startIdx: number,
  endIdx: number,
  maxChars: number,
  overlap: number,
): Array<{ startIdx: number; endIdx: number; text: string }> {
  const chunks: Array<{ startIdx: number; endIdx: number; text: string }> = [];
  const subLines = lines.slice(startIdx, endIdx + 1);
  if (!subLines.length) return chunks;

  const blocks = splitMarkdownBlocks(subLines, 2);
  for (const blk of blocks) {
    const ps = startIdx + blk.start;
    const pe = startIdx + blk.end;
    if (!chunks.length && ps === startIdx) {
      // 第一块与原范围同起点 → 整块追加
      const text = linesRangeText(lines, ps, pe);
      if (text) chunks.push({ startIdx: ps, endIdx: pe, text });
    } else {
      // 按 maxChars 二次切
      const parts = chunkLineRange(lines, ps, pe, maxChars, overlap);
      for (const it of parts) {
        if (it.text) chunks.push(it);
      }
    }
  }
  return chunks;
}

/**
 * 入口:把整文档按 heading 切块,再按 maxChars 切小
 *
 * @param lines - 文件行数组
 * @param opt - { maxChars, overlapChars, byHeading }
 * @returns chunks,每个含 { startIdx, endIdx, text }
 */
export function chunkByLines(
  lines: string[],
  opt: ChunkOptions,
): Array<{ startIdx: number; endIdx: number; text: string }> {
  const out: Array<{ startIdx: number; endIdx: number; text: string }> = [];
  // 注意:不要强制抬高 max(原版有 Math.max(200,...) 错误地把 10 当 200 处理)
  // 最小给个 1,避免 0/负数让循环死
  const max = Math.max(1, opt.maxChars | 0);
  const overlap = Math.max(0, opt.overlapChars | 0);
  const byHeading = !!opt.byHeading;

  const len = Array.isArray(lines) ? lines.length : 0;
  if (!len) return out;

  if (byHeading) {
    const blocks = splitMarkdownBlocks(lines, 2);
    for (const b of blocks) {
      const parts = chunkMarkdownRange(lines, b.start, b.end, max, overlap);
      for (const it of parts) {
        if (it && it.text) out.push(it);
      }
    }
  } else {
    const parts = chunkLineRange(lines, 0, len - 1, max, overlap);
    for (const it of parts) {
      if (it && it.text) out.push(it);
    }
  }
  return out;
}
