// WebDAV 同步路径安全
//
// 远端 PROPFIND 返回的 href / 目录项名不可信：服务器（或劫持者）可以返回
// `a%5C..%5C..%5Cevil.md` 这类名字。旧实现按 `/` 切段取最后一段作为文件名，
// 反斜杠在 Windows 上仍是分隔符，于是 `localRoot\a\..\..\evil.md` 会写出库根。
//
// 规则：
// - 单条目名（目录列表里的一项）必须是纯单段：不含 `/`、`\`、NUL、控制字符；
// - 参与本地路径拼接的相对路径统一过 sanitizeSyncRelPath：`\` 视为分隔符，
//   丢弃空段与 `.`，出现 `..` 直接拒绝（不做“折叠到根内”的猜测）；
// - 段内冒号按 Windows ADS 处理，一并拒绝（跨平台同步不保留此类名字）。

const SINGLE_SEGMENT_RE = /^[^/\\\0]+$/

function segmentUnsafe(part: string): boolean {
  if (/[\x00-\x1f]/.test(part)) return true
  if (part.includes(':')) return true
  return false
}

/** 远端目录项名：只允许一段，且不含分隔符 / 控制字符 / 冒号。返回 null 表示必须跳过。 */
export function sanitizeRemoteEntryName(raw: unknown): string | null {
  const name = String(raw ?? '')
  if (!name || name === '.' || name === '..') return null
  if (!SINGLE_SEGMENT_RE.test(name)) return null
  if (segmentUnsafe(name)) return null
  return name
}

/**
 * 同步相对路径归一与校验。返回 null 表示不安全（含 `..`、控制字符、冒号）。
 * 反斜杠按分隔符处理，避免 Windows 上与 `/` 语义不一致。
 */
export function sanitizeSyncRelPath(raw: unknown): string | null {
  const input = String(raw ?? '').trim()
  if (!input) return null
  const out: string[] = []
  for (const part of input.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return null
    if (segmentUnsafe(part)) return null
    out.push(part)
  }
  if (!out.length) return null
  return out.join('/')
}

/**
 * 把同步相对路径拼到本地库根下。rel 不安全时返回 null（调用方必须跳过并记日志）。
 * `sep` 仅用于测试；默认按库根是否含反斜杠推断平台分隔符。
 */
export function resolveLocalSyncPath(
  localRoot: string,
  rel: unknown,
  sep?: string,
): string | null {
  const safe = sanitizeSyncRelPath(rel)
  if (!safe) return null
  const root = String(localRoot ?? '')
  if (!root) return null
  const s = sep ?? (root.includes('\\') ? '\\' : '/')
  return root + s + safe.replace(/\//g, s)
}
