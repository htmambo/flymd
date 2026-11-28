// 预览外链判定：只有明确的 web / 邮件 / 电话链接才交给系统处理。
//
// 背景：预览里的外链此前带 target="_blank"，点击会让 Tauri WebView 新开一个
// 远程页面窗口。现在由预览点击处理器拦截，统一用 opener 的 openUrl 交给系统浏览器。
// 相对路径、页内锚点、未知 scheme 一律返回 null，由调用方阻止 WebView 内导航。

const EXTERNAL_PREFIX = /^(https?:|mailto:|tel:)/i

/**
 * 规范化可交给系统打开的外部链接：
 * - `//host/path`（协议相对）→ `https://host/path`；
 * - http/https/mailto/tel 原样返回；
 * - 页内锚点、相对路径、其它 scheme → null。
 */
export function normalizeExternalWebUrl(raw: string): string | null {
  const href = String(raw || '').trim()
  if (!href) return null
  if (href.startsWith('#')) return null
  if (href.startsWith('//')) return `https:${href}`
  if (EXTERNAL_PREFIX.test(href)) return href
  return null
}

export function isExternalWebUrl(raw: string): boolean {
  return normalizeExternalWebUrl(raw) !== null
}

/**
 * 是否是不应交给 WebView 导航的绝对地址（含协议相对与任意 scheme）。
 * 用于在“不是本地文档/锚点”的分支里统一 preventDefault，避免 ftp:/自定义 scheme
 * 借 target="_blank" 在 Tauri WebView 内打开远程内容。
 */
export function isAbsoluteNonLocalHref(raw: string): boolean {
  const href = String(raw || '').trim()
  if (!href || href.startsWith('#')) return false
  return href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)
}
