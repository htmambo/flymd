// 超大文档判定（perf 批次 I）
//
// 背景：所见模式启用链里的 `Editor.create`（milkdown 解析 + ProseMirror 文档构建）
// 是**同步**主线程操作。真机实测（553KB / 35,197 行 / 3,352 代码围栏）：
//   Editor.create 11,890ms / 13,062ms / 23,988ms
// 同一调用在 958 字节的小文件上仅 4–8ms —— 成本随文档规模线性增长。
// 对超大文档自动启用所见模式，等于在"应用已就绪"之后又冻结界面十几秒。
//
// 阈值来自用户真实笔记分布（1,814 个 md）：median 1,838B / P90 8,725B /
// P99 38,248B / max 1,241,868B；>200KB 仅 4 个（0.2%）。因此 200KB / 10,000 行
// 只会命中真实离群值，不影响日常笔记。
//
// 实现约束（本模块在"打开文档"与"启动"两条路径上都会被调用）：
//   字节数与行数由**同一次扫描**得出，避免对 1MB 级文档重复遍历 2~4 遍。

/**
 * 自动启用所见模式的体积上限（200 KiB = 204,800 UTF-8 字节）。
 * 语义是"允许自动启用的**最大**体积"——恰好等于该值时**不允许**自动启用，
 * 因此判定用 `>=`（而不是 `>`）。
 */
export const WYSIWYG_AUTO_ENABLE_MAX_BYTES = 200 * 1024

/**
 * 自动启用所见模式的行数上限。
 * 语义同上：恰好等于该值时不允许自动启用，判定用 `>=`。
 */
export const WYSIWYG_AUTO_ENABLE_MAX_LINES = 10000

export interface DocumentSize {
  bytes: number
  lines: number
}

interface ScanResult extends DocumentSize {
  /** 是否已突破任一阈值（仅在传入 limits 时有意义） */
  oversized: boolean
}

interface ScanLimits {
  maxBytes: number
  maxLines: number
}

/**
 * 单遍扫描：同时统计 UTF-8 字节数与行数。
 *
 * 传入 `limits` 时，一旦字节数或行数突破任一阈值即提前返回
 * （`isOversizedDocument` 用它把最坏情况从"扫完整篇"压到"扫到阈值即止"）。
 *
 * 行边界：`\n` 结束一行；**孤立** `\r`（后面不跟 `\n`，经典 Mac 行尾）也结束一行。
 * `\r\n` 由 `\n` 计数，`\r` 不重复计数。
 */
function scanText(text: string, limits?: ScanLimits): ScanResult {
  if (!text) return { bytes: 0, lines: 0, oversized: false }
  let bytes = 0
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)

    // —— 行数 ——
    if (c === 10) {
      lines++
    } else if (c === 13) {
      if (i + 1 >= text.length || text.charCodeAt(i + 1) !== 10) lines++
    }

    // —— UTF-8 字节数 ——
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      // 高代理 + 低代理 = 一个码点 = 4 字节
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++ }
      else bytes += 3
    } else bytes += 3

    if (limits && (bytes >= limits.maxBytes || lines >= limits.maxLines)) {
      return { bytes, lines, oversized: true }
    }
  }
  return { bytes, lines, oversized: false }
}

/**
 * UTF-8 字节长度（精确、零分配）。
 *
 * 为什么不用 `TextEncoder`：它要为整篇文档分配一份等长 Uint8Array，
 * 而本模块在启动路径上对 1MB 级文档调用。
 *
 * 实测（Node v24.15，1MB 文本，30 次取均值）：
 *   纯 ASCII 1MB：本实现 4.10ms / TextEncoder 1.18ms / Blob.size 1.62ms
 *   中文 1.03MB：本实现 1.53ms / TextEncoder 1.75ms / Blob.size 2.17ms
 *   emoji 1.03MB：本实现 1.97ms / TextEncoder 3.16ms / Blob.size 3.42ms
 * 纯 ASCII 下原生编码更快；但笔记以非 ASCII 为主时本实现更快，
 * 且**可以提前退出**（扫到阈值即止），原生编码必须编码完整篇——
 * 这正是 `isOversizedDocument` 选择逐字符计数的原因。
 */
export function utf8ByteLength(text: string): number {
  return scanText(text).bytes
}

/** 行数（换行符计数 + 1；空串返回 0；孤立 `\r` 也计为换行） */
export function countLines(text: string): number {
  return scanText(text).lines
}

export function describeDocumentSize(text: string): DocumentSize {
  const r = scanText(text)
  return { bytes: r.bytes, lines: r.lines }
}

/** 是否属于"超大文档"（自动启用所见模式会冻结界面十几秒的量级） */
export function isOversizedDocument(text: string): boolean {
  return scanText(text, {
    maxBytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES,
    maxLines: WYSIWYG_AUTO_ENABLE_MAX_LINES,
  }).oversized
}

/**
 * 基于已算出的体积描述判断是否超大。
 * 调用方若同时需要展示尺寸，用它避免把同一篇文本扫描两遍。
 */
export function isOversizedDocumentSize(size: DocumentSize): boolean {
  return size.bytes >= WYSIWYG_AUTO_ENABLE_MAX_BYTES || size.lines >= WYSIWYG_AUTO_ENABLE_MAX_LINES
}

/**
 * 面向用户的体积描述（如 "540 KB"）。
 * 分级按 1024 进制计算（实为 KiB/MiB），但沿用用户习惯的 "KB/MB" 表述。
 * KB 分级在 1023.5 KB 处收口，避免出现 "1024 KB" 这种跳到下一级的显示。
 */
export function formatDocumentSize(bytes: number): string {
  const b = Math.max(0, Math.floor(bytes || 0))
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1023.5) return `${Math.round(kb)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 未保存文档（无路径）的去重前缀 */
export const OVERSIZED_NOTICE_UNSAVED_PREFIX = 'anon:'

/**
 * 超大文档提示的去重（同一文档在一次会话内只提示一次）。
 *
 * - 有路径：以路径为键。
 * - 无路径（未保存文档）：以路径前缀 + 调用方给的"内容指纹"（字节数:行数）为键。
 *   只用路径会把**多个**未保存文档挤成同一个键，导致后一份超大文档静默跳过
 *   所见模式且没有提示；只用空串更糟——同一份未保存文档会反复弹提示。
 */
export function createOversizedNoticeDedup(): {
  /**
   * 消费一次通知机会并返回是否应当通知。
   * **有副作用**：返回 true 的同时把该键记下，同一键再次调用返回 false。
   */
  consume(path: string, hint?: string): boolean
  reset(): void
} {
  const seen = new Set<string>()
  return {
    consume(path: string, hint = ''): boolean {
      const key = path ? path : OVERSIZED_NOTICE_UNSAVED_PREFIX + hint
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
    reset(): void {
      seen.clear()
    },
  }
}
