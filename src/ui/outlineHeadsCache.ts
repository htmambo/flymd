// 大纲标题位置缓存
// 抽离自 main.ts:5217-5280(type + 4 函数)。
// 抽离理由:
//   - 滚动同步用"缓存 + 二分"避免每帧 querySelectorAll + getBoundingClientRect
//   - cache 状态可封闭在模块内,对外只暴露 build/ensure/clear/escape
//   - 之前 main.ts 闭包 _outlineHeadsCache,现在改为模块顶层 let,API 表面不变

export type OutlineMode = 'wysiwyg' | 'preview' | 'source'

export type OutlineHeadsCache = {
  mode: OutlineMode
  scrollEl: HTMLElement
  bodyEl: HTMLElement
  ids: string[]
  tops: number[]
}

export type OutlineContext = {
  mode: OutlineMode
  scrollEl: HTMLElement | null
  bodyEl: HTMLElement | null
  heads: HTMLElement[]
}

let _outlineHeadsCache: OutlineHeadsCache | null = null

export function clearOutlineHeadsCache(): void {
  _outlineHeadsCache = null
}

export function cssEscapeCompat(s: string): string {
  try {
    const ce = (globalThis as any)?.CSS?.escape
    if (typeof ce === 'function') return ce(String(s))
  } catch {}
  // 兜底:只处理最容易把选择器搞炸的字符,足够应付我们生成的 slug。
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildOutlineHeadsCacheFromCtx(ctx: OutlineContext): OutlineHeadsCache | null {
  try {
    if (!ctx.scrollEl || !ctx.bodyEl) return null
    const heads = ctx.heads && ctx.heads.length > 0
      ? ctx.heads
      : (Array.from(ctx.bodyEl.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[])
    if (heads.length < 1) return null
    const ids: string[] = []
    const tops: number[] = []
    for (const h of heads) {
      const id = (h.getAttribute('id') || '').trim()
      if (!id) continue
      // offsetTop 不触发布局回流,适合在滚动同步里使用。
      const t = (h as any).offsetTop
      ids.push(id)
      tops.push(Number.isFinite(t) ? t : 0)
    }
    if (ids.length < 1) return null

    // 兜底:某些布局下 offsetTop 可能全部为 0,禁用缓存,回退到旧逻辑。
    let allZero = true
    for (const t of tops) { if (t > 0) { allZero = false; break } }
    if (allZero) return null

    return { mode: ctx.mode, scrollEl: ctx.scrollEl, bodyEl: ctx.bodyEl, ids, tops }
  } catch {
    return null
  }
}

export function ensureOutlineHeadsCacheFromCtx(ctx: OutlineContext): OutlineHeadsCache | null {
  try {
    if (!ctx.scrollEl || !ctx.bodyEl) return null
    const cached = _outlineHeadsCache
    if (cached && cached.mode === ctx.mode && cached.scrollEl === ctx.scrollEl && cached.bodyEl === ctx.bodyEl) return cached
    const next = buildOutlineHeadsCacheFromCtx(ctx)
    _outlineHeadsCache = next
    return next
  } catch {
    return null
  }
}
