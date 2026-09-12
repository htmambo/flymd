// fileTree 路径 key 归一与匹配：与 Rust scan_dirs_doc_presence 约定的缓存 key 格式对齐。
//
// 关键契约：
// - 与 Rust 端 `replace('\\', '/')` 一致
// - 驱动器根（"c:" / "C:/"）保留尾冒号 → 归一为 "c:"
// - 空串守卫：归一后为空返回原 dir，调用方应跳过缓存走递归路径
// - 大小写不敏感平台上额外 toLowerCase（不区分大小写 FS：Windows、macOS 默认 APFS）
// - pathPrefixMatch：段级前缀匹配，防 "C:/lib" 误匹配 "C:/library"
// - isCaseInsensitiveFS：memoize，避免 50k 次正则

export function isCaseInsensitiveFS(): boolean {
  return _ciFsCache ?? computeCiFs()
}
let _ciFsCache: boolean | null = null
function computeCiFs(): boolean {
  try {
    const p = (typeof navigator !== 'undefined' && (navigator as any)?.platform) || ''
    if (/win/i.test(p)) { _ciFsCache = true; return true }
    if (/mac/i.test(p) || /darwin/i.test(p)) { _ciFsCache = true; return true }
    const ua = (typeof navigator !== 'undefined' && (navigator as any)?.userAgent) || ''
    if (/Windows/i.test(ua) || /Macintosh|Mac OS/i.test(ua)) { _ciFsCache = true; return true }
  } catch {}
  _ciFsCache = false
  return false
}

// 重置 memoize（仅供测试使用）
export function __resetCiFsCache(): void { _ciFsCache = null }

/** 折叠连续 / 与反斜杠→正斜杠。 */
function normSep(s: string): string {
  return s.replace(/\\/g, '/')
}

/**
 * 把任意路径表达归一为缓存 key：
 * - \\ → /
 * - 连续 // 不折叠（保留前缀 / 以区分绝对/相对）
 * - 非驱动器根路径去掉尾随 /
 * - 大小写不敏感平台 toLowerCase
 * - 空串守卫返回原 dir
 */
export function normDirKey(raw: string, ciFs: boolean = isCaseInsensitiveFS()): string {
  let s = normSep(raw)
  if (s.length > 1 && !/:$/.test(s)) s = s.replace(/\/+$/, '')
  if (!s) return raw
  return ciFs ? s.toLowerCase() : s
}

/**
 * 段级前缀匹配：a === b，或 a 是 b 的子路径且分隔符对齐。
 * 反例：C:/lib 不应被识别为 C:/library 的祖先（startsWith 会误判）。
 */
export function pathPrefixMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length > b.length) return a.startsWith(b) && (a.charCodeAt(b.length) === 47 /* '/' */)
  return false
}
