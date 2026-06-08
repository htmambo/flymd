// 预览锚点解析工具:heading id 生成 + hash 链接定位。
// 抽离自 main.ts:6 个内聚函数(均围绕 preview anchor 解析)。
//
// 包含:
//   - normalizePreviewAnchorText:URI 解码兜底
//   - makePreviewHeadingId:从 heading 文本生成稳定的 DOM id
//   - ensurePreviewHeadingIds:为缺失 id 的 h1-h6 补 id(冲突时加序号)
//   - isPreviewHashLink:#hash 格式检测
//   - findPreviewAnchorTarget:在 .preview-body 中找 anchor 目标,fallback 走 heading text 匹配
//   - scrollPreviewAnchorIntoView:滚动到 anchor 目标

import { cssEscapeCompat } from '../ui/outlineHeadsCache'

export function normalizePreviewAnchorText(input: string): string {
  try { return decodeURIComponent(String(input || '')) } catch { return String(input || '') }
}

export function makePreviewHeadingId(text: string, index: number): string {
  const base = normalizePreviewAnchorText(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥\s-]/gi, '')
    .replace(/\s+/g, '-')
    .slice(0, 64)
  return base || `toc-${index}`
}

export function ensurePreviewHeadingIds(root: ParentNode): void {
  try {
    const used = new Set<string>()
    const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
    heads.forEach((h, idx) => {
      let id = String(h.getAttribute('id') || '').trim()
      if (!id) id = makePreviewHeadingId(h.textContent || '', idx)
      const base = id
      let n = 1
      while (used.has(id)) id = `${base}-${n++}`
      used.add(id)
      if (h.getAttribute('id') !== id) h.setAttribute('id', id)
    })
  } catch {}
}

export function isPreviewHashLink(href: string): boolean {
  return /^#[^#\s]+/.test(String(href || '').trim())
}

export function findPreviewAnchorTarget(hashHref: string, previewEl: HTMLElement | null): HTMLElement | null {
  try {
    const raw = String(hashHref || '').trim()
    if (!isPreviewHashLink(raw)) return null
    const id = normalizePreviewAnchorText(raw.slice(1)).trim()
    if (!id) return null
    const body = document.querySelector('.preview .preview-body') as HTMLElement | null
    const root = body || previewEl || document
    let target = root.querySelector(`#${cssEscapeCompat(id)}`) as HTMLElement | null
    if (target) return target

    const wanted = makePreviewHeadingId(id, 0)
    const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
    target = heads.find((h, idx) => {
      const text = (h.textContent || '').trim()
      return text === id || makePreviewHeadingId(text, idx) === wanted
    }) || null
    if (target && !target.id) target.id = wanted
    return target
  } catch {
    return null
  }
}

export function scrollPreviewAnchorIntoView(hashHref: string, previewEl: HTMLElement | null): boolean {
  const target = findPreviewAnchorTarget(hashHref, previewEl)
  if (!target) return false
  try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { target.scrollIntoView() }
  return true
}
