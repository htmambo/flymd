// src/exporters/pdf.ts
// 使用 html2canvas + jsPDF 将指定 DOM 元素导出为 PDF 字节

import { resolveLocalImageAbsPathFromSrc } from '../utils/localImageSrcResolve'
import { guessSyncedDocImageAbsPath } from '../utils/localImagePath'

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForFonts(doc: Document, timeoutMs = 8000): Promise<void> {
  try {
    const ready = (doc as any).fonts?.ready
    if (!ready || typeof ready.then !== 'function') return
    await Promise.race([ready, waitMs(timeoutMs)])
  } catch {}
}

// 导出性能参数：默认“尽快完成”，不要被坏图床拖 20s+。
const EXPORT_WAIT_ORIG_IMAGES_MS = 1200
const EXPORT_WAIT_CLONE_IMAGES_MS = 2500
const EXPORT_FETCH_REMOTE_IMAGE_MS = 6000
const EXPORT_READ_LOCAL_IMAGE_MS = 6000

async function waitForImagesIn(root: ParentNode, timeoutMs = 20000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll?.('img') || []) as HTMLImageElement[]
  if (!imgs.length) return

  const tasks = imgs.map(async (img) => {
    try {
      if (img.complete && img.naturalWidth > 0) {
        if (typeof (img as any).decode === 'function') {
          try { await (img as any).decode() } catch {}
        }
        return
      }
    } catch {}

    await new Promise<void>((resolve) => {
      const done = () => resolve()
      try {
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      } catch {
        resolve()
      }
    })

    try {
      if (typeof (img as any).decode === 'function') {
        try { await (img as any).decode() } catch {}
      }
    } catch {}
  })

  await Promise.race([Promise.all(tasks), waitMs(timeoutMs)])
}

async function getHttpClient(): Promise<{ fetch: any; kind: 'tauri' | 'browser' } | null> {
  // 优先使用 tauri plugin-http（可绕过浏览器 CORS），否则回退到 window.fetch（仍会受 CORS 限制）
  try {
    const mod: any = await import('@tauri-apps/plugin-http')
    if (typeof mod?.fetch === 'function') return { fetch: mod.fetch, kind: 'tauri' }
  } catch {}
  try {
    if (typeof fetch === 'function') return { fetch: (input: string, init: any) => fetch(input, init), kind: 'browser' }
  } catch {}
  return null
}

function inferMimeByUrl(url: string): string {
  const m = (url || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/)
  switch (m?.[1]) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'avif': return 'image/avif'
    case 'svg': return 'image/svg+xml'
    case 'ico': return 'image/x-icon'
    default: return 'application/octet-stream'
  }
}

async function fetchRemoteAsObjectUrl(url: string, timeoutMs = 20000): Promise<string> {
  const client = await getHttpClient()
  if (!client?.fetch) return ''

  let timedOut = false
  const p = (async () => {
    try {
      const resp = await client.fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'image/*;q=0.9,*/*;q=0.1' },
      })
      const ok = resp && (resp.ok === true || (typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300))
      if (!ok) return ''
      const ab: ArrayBuffer = await resp.arrayBuffer()
      let mime = ''
      try {
        const ct = resp.headers?.get?.('content-type') || resp.headers?.get?.('Content-Type')
        if (ct) mime = String(ct).split(';')[0].trim()
      } catch {}
      if (!/^image\//i.test(mime)) mime = inferMimeByUrl(url)
      const blob = new Blob([ab], { type: mime || 'application/octet-stream' })
      const objUrl = URL.createObjectURL(blob)
      // 竞态已超时：避免泄漏，立即 revoke
      if (timedOut) { try { URL.revokeObjectURL(objUrl) } catch {} ; return '' }
      return objUrl
    } catch {
      // 兜底走 Tauri 代理：结果同样受 timedOut 守卫
      if (client.kind === 'tauri') {
        const fallback = await fetchUrlAsObjectUrl(url, timeoutMs)
        if (timedOut && fallback) { try { URL.revokeObjectURL(fallback) } catch {} ; return '' }
        return fallback
      }
      return ''
    }
  })()

  try {
    return await Promise.race([
      p,
      waitMs(timeoutMs).then(() => { timedOut = true; return '' }),
    ])
  } catch {
    return ''
  }
}

async function readLocalAsObjectUrl(absPath: string, timeoutMs = 20000): Promise<string> {
  let timedOut = false
  const p = (async () => {
    try {
      const mod: any = await import('@tauri-apps/plugin-fs')
      const readFile = mod?.readFile
      if (typeof readFile !== 'function') return ''
      const bytes = await readFile(absPath as any)
      const mime = inferMimeByUrl(absPath)
      const blob = new Blob([bytes], { type: /^image\//i.test(mime) ? mime : 'application/octet-stream' })
      const objUrl = URL.createObjectURL(blob)
      if (timedOut) { try { URL.revokeObjectURL(objUrl) } catch {} ; return '' }
      return objUrl
    } catch {
      return ''
    }
  })()
  return await Promise.race([
    p,
    waitMs(timeoutMs).then(() => { timedOut = true; return '' }),
  ])
}

async function fetchUrlAsObjectUrl(url: string, timeoutMs = 20000): Promise<string> {
  let timedOut = false
  const p = (async () => {
    try {
      const resp = await fetch(url)
      if (!resp?.ok) return ''
      const blob = await resp.blob()
      const objUrl = URL.createObjectURL(blob)
      if (timedOut) { try { URL.revokeObjectURL(objUrl) } catch {} ; return '' }
      return objUrl
    } catch {
      return ''
    }
  })()
  return await Promise.race([
    p,
    waitMs(timeoutMs).then(() => { timedOut = true; return '' }),
  ])
}

function setImageSource(img: HTMLImageElement, url: string) {
  try { img.removeAttribute('srcset') } catch {}
  try { img.removeAttribute('sizes') } catch {}
  try { img.setAttribute('src', url) } catch { try { (img as any).src = url } catch {} }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const safeLimit = Math.max(1, Math.min(limit || 1, items.length || 1))
  let idx = 0
  const workers = Array.from({ length: safeLimit }, async () => {
    for (;;) {
      const i = idx++
      if (i >= items.length) return
      try { await fn(items[i]) } catch {}
    }
  })
  await Promise.all(workers)
}

async function inlineImagesForPdf(root: ParentNode, opt?: {
  sourceFilePath?: string | null
  remoteTimeoutMs?: number
  localTimeoutMs?: number
  onLog?: (msg: string, data?: any) => void
}): Promise<{ objectUrls: string[]; total: number; inlined: number; failed: number }> {
  // html2canvas 对 file/asset/无 CORS 远程图都不稳定；导出前统一替换成当前页面可读的 blob: URL。
  const imgs = Array.from(root.querySelectorAll?.('img') || []) as HTMLImageElement[]
  if (!imgs.length) return { objectUrls: [], total: 0, inlined: 0, failed: 0 }

  const objectUrls: string[] = []
  const cache = new Map<string, string>()
  let inlined = 0
  let failed = 0
  const sourceFilePath = String(opt?.sourceFilePath || '').trim()
  const remoteTimeoutMs = Math.max(0, Number(opt?.remoteTimeoutMs ?? EXPORT_FETCH_REMOTE_IMAGE_MS) || 0)
  const localTimeoutMs = Math.max(0, Number(opt?.localTimeoutMs ?? EXPORT_READ_LOCAL_IMAGE_MS) || 0)

  const targets = imgs.map((img) => {
    const dataAbs = String(img.getAttribute('data-abs-path') || '').trim()
    const dataRaw = String(img.getAttribute('data-raw-src') || '').trim()
    const attrSrc = String(img.getAttribute('src') || '').trim()
    const currentSrc = String((img as any).currentSrc || '').trim()
    const src = dataAbs || dataRaw || attrSrc || currentSrc || String((img as any).src || '').trim()
    return { img, src, attrSrc, dataAbs }
  }).filter(({ src }) => !!src && !/^data:image\//i.test(src))

  await runWithConcurrency(targets, 4, async ({ img, src, attrSrc, dataAbs }) => {
    const key = dataAbs ? `local:${dataAbs}` : src
    const cached = cache.get(key)
    if (cached != null) {
      if (cached) {
        setImageSource(img, cached)
        inlined++
      } else {
        failed++
      }
      return
    }

    let u = ''

    try {
      const localAbs = dataAbs || resolveLocalImageAbsPathFromSrc(src, sourceFilePath) || resolveLocalImageAbsPathFromSrc(attrSrc, sourceFilePath)
      if (localAbs) {
        u = await readLocalAsObjectUrl(localAbs, localTimeoutMs)
        if (!u && sourceFilePath) {
          const remapped = guessSyncedDocImageAbsPath(sourceFilePath, localAbs)
          if (remapped && remapped !== localAbs) u = await readLocalAsObjectUrl(remapped, localTimeoutMs)
        }
      }
    } catch {}

    if (!u && /^https?:\/\//i.test(src)) u = await fetchRemoteAsObjectUrl(src, remoteTimeoutMs)
    if (!u && /^(blob:|asset:)/i.test(src)) u = await fetchUrlAsObjectUrl(src, localTimeoutMs)

    cache.set(key, u || '')
    if (!u) {
      failed++
      return
    }

    setImageSource(img, u)
    objectUrls.push(u)
    inlined++
  })

  try {
    if (targets.length && opt?.onLog) opt.onLog('图片预处理完成', { total: targets.length, inlined, failed })
  } catch {}
  return { objectUrls, total: targets.length, inlined, failed }
}

function normalizeSvgSize(svgEl: SVGElement, targetWidth: number) {
  try {
    const vb = svgEl.getAttribute('viewBox')
    let w = 0, h = 0
    if (vb) {
      const p = vb.split(/\s+/).map(Number)
      if (p.length === 4) { w = p[2]; h = p[3] }
    }
    const hasWH = Number(svgEl.getAttribute('width')) || Number(svgEl.getAttribute('height'))
    if ((!w || !h) && hasWH) {
      w = Number(svgEl.getAttribute('width')) || 800
      h = Number(svgEl.getAttribute('height')) || 600
    }
    if (!w || !h) { w = 800; h = 600 }
    const ratio = targetWidth / w
    const targetHeight = Math.max(1, Math.round(h * ratio))
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svgEl.setAttribute('width', String(targetWidth))
    svgEl.setAttribute('height', String(targetHeight))
    try { (svgEl.style as any).maxWidth = '100%'; (svgEl.style as any).height = 'auto' } catch {}
  } catch {}
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? Math.trunc(n) : 0
  if (v < min) return min
  if (v > max) return max
  return v
}

function pickBreakYByWhitespace(canvas: HTMLCanvasElement, yStart: number, yTarget: number, searchPx = 28): number {
  // 目的：把分页切到“行间空白”处，避免 PDF 里出现“半行被切掉/上下页不连贯”。
  // 这不是完美排版，但比固定像素硬切强太多，而且实现足够简单。
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any)
    if (!ctx) return yTarget

    const height = canvas.height | 0
    const width = canvas.width | 0
    const tgt = clampInt(yTarget, 0, height)
    // 分页切点必须落在“当前页高度”以内：超过目标高度会导致图片超出纸张被裁掉。
    const minY = clampInt(tgt - searchPx, 0, height)
    const maxY = clampInt(tgt, 0, height)
    // 太靠近页首没意义：那基本是在“切断刚开始的内容”
    const safeMinY = Math.max(minY, (yStart | 0) + 160)
    if (maxY <= safeMinY) return tgt

    const bandH = (maxY - safeMinY + 1) | 0
    // ctx: RenderingContext 是 CanvasRenderingContext2D | ImageBitmapRenderingContext 的联合
    // 此处基于 2d canvas 上下文 getImageData，因此用类型断言收窄
    const img = (ctx as CanvasRenderingContext2D).getImageData(0, safeMinY, width, bandH).data
    const stepX = Math.max(8, Math.floor(width / 420)) // 采样约 300~500 点，速度与稳定性都够

    let bestRow = -1
    let bestScore = -1
    for (let row = 0; row < bandH; row++) {
      const rowOff = row * width * 4
      let white = 0
      let total = 0
      for (let x = 0; x < width; x += stepX) {
        const i = rowOff + x * 4
        const a = img[i + 3] | 0
        if (a === 0) { white++; total++; continue }
        const r = img[i] | 0, g = img[i + 1] | 0, b = img[i + 2] | 0
        if (r >= 250 && g >= 250 && b >= 250) white++
        total++
      }
      const score = white / Math.max(1, total)
      if (score > bestScore) {
        bestScore = score
        bestRow = row
        // 几乎全白，直接收工
        if (score >= 0.995) break
      }
    }

    // 找不到靠谱的空白行就别硬凑了，回退到目标位置
    if (bestRow < 0 || bestScore < 0.92) return tgt
    const bestY = safeMinY + bestRow
    // 避免切出来的页太短（会导致页数暴涨）
    if ((bestY - (yStart | 0)) < 240) return tgt
    return bestY
  } catch {
    return yTarget
  }
}

type AvoidRange = { top: number; bottom: number }

function mergeRanges(ranges: AvoidRange[], mergeGapPx = 2): AvoidRange[] {
  const rs = (ranges || []).filter((r) => Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom > r.top)
  rs.sort((a, b) => a.top - b.top)
  const out: AvoidRange[] = []
  for (const r of rs) {
    const last = out.length ? out[out.length - 1] : null
    if (!last || r.top > last.bottom + mergeGapPx) out.push({ top: r.top, bottom: r.bottom })
    else last.bottom = Math.max(last.bottom, r.bottom)
  }
  return out
}

function uniqSorted(values: number[], eps = 0.5): number[] {
  const arr = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const out: number[] = []
  for (const v of arr) {
    const last = out.length ? out[out.length - 1] : null
    if (last == null || Math.abs(v - last) > eps) out.push(v)
  }
  return out
}

function collectBreakCandidatesCss(root: HTMLElement): number[] {
  // 生成“可断页候选点”：优先用布局信息（行框/块框边界），别用像素猜。
  // 这能从根上消灭“分页切到半行字”的特殊情况。
  try {
    const rootRect = root.getBoundingClientRect()
    const content = (root.querySelector('.preview-body') as HTMLElement | null) || root
    const candidates: number[] = [0]

    const push = (y: number) => {
      if (!Number.isFinite(y)) return
      if (y <= 0) return
      candidates.push(y)
    }

    const blocks = Array.from(content.querySelectorAll<HTMLElement>(
      'p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,table,figure,hr,ul,ol,section,div',
    ))

    for (const el of blocks) {
      try {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const r = el.getBoundingClientRect()
        if (!(r.width > 0 && r.height > 0)) continue
        push(r.top - rootRect.top)
        push(r.bottom - rootRect.top)

        const tag = el.tagName.toLowerCase()
        const wantLines = tag === 'p' || tag === 'li' || tag === 'blockquote'
        if (!wantLines) continue

        const range = document.createRange()
        range.selectNodeContents(el)
        const rects = Array.from(range.getClientRects())
        for (const rr of rects) {
          try {
            if (!(rr.width > 0 && rr.height > 0)) continue
            push(rr.bottom - rootRect.top)
          } catch {}
        }
      } catch {}
    }

    // 总高度（兜底）：避免最后一页被截掉
    try {
      const h = Math.max(content.scrollHeight || 0, root.scrollHeight || 0, (rootRect.height || 0))
      push(h)
    } catch {}

    return uniqSorted(candidates, 0.75)
  } catch {
    return []
  }
}

function pickEndByCandidates(y: number, desiredEnd: number, candidates: number[], avoid: AvoidRange[]): number {
  // 在 candidates 中找一个 <= desiredEnd 的最大值（并尽量不落在不可切割区间内）。
  const maxY = clampInt(desiredEnd - 2, 0, 1 << 30)
  const minSlice = 240

  let lo = 0
  let hi = (candidates.length - 1) | 0
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = candidates[mid]
    if (v <= maxY) { idx = mid; lo = mid + 1 } else hi = mid - 1
  }

  for (let i = idx; i >= 0; i--) {
    const c = clampInt(candidates[i], 0, 1 << 30)
    if (c <= y + minSlice) break
    let end = adjustBreakAvoidingRanges(c, y, avoid)
    end = clampInt(end, y + 1, desiredEnd)
    if (end <= y + minSlice) continue
    return end
  }
  return 0
}

function collectAvoidRangesCss(root: HTMLElement): AvoidRange[] {
  // 基于 DOM 布局的“不可切割区间”：图片/表格/代码块等应当整体落在同一页里。
  // 这是用数据结构消灭特殊情况：别靠像素“猜空白”，直接知道哪里不能切。
  try {
    const rootRect = root.getBoundingClientRect()
    const sel = 'img,figure,table,pre,blockquote,hr,svg,canvas'
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(sel))
    const ranges: AvoidRange[] = []
    for (const n of nodes) {
      try {
        // KaTeX 的 SVG 本质是行内字形，不要把它当成“整块图片”处理
        if (n.tagName.toLowerCase() === 'svg' && n.closest('.katex')) continue
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const r = n.getBoundingClientRect()
        if (!(r.width > 0 && r.height > 0)) continue
        // 预览样式里图片默认带 box-shadow（阴影不算在 getBoundingClientRect 里），
        // 刚好卡在分页边界时会出现“只剩一条边/被切一丢丢”的视觉问题；这里给图片额外留安全边。
        const tag = n.tagName.toLowerCase()
        const pad = tag === 'img' ? 18 : 6
        const top = (r.top - rootRect.top) - pad
        const bottom = (r.bottom - rootRect.top) + pad
        // 过滤掉极小元素（比如 UI 图标）
        if (bottom - top < 24) continue
        ranges.push({ top, bottom })
      } catch {}
    }
    return mergeRanges(ranges, 4)
  } catch {
    return []
  }
}

function adjustBreakAvoidingRanges(breakY: number, yStart: number, ranges: AvoidRange[]): number {
  // 若切点落在“不可切割区间”内部，则把切点挪到该区间开始之前（把整个块推到下一页）。
  // 这比“切到一张图的天空部分”看起来像空白然后把图切两半要靠谱得多。
  const y = clampInt(breakY, 0, 1 << 30)
  for (const r of ranges) {
    const top = clampInt(r.top, 0, 1 << 30)
    const bottom = clampInt(r.bottom, 0, 1 << 30)
    if (y > top && y < bottom) {
      const before = top - 2
      if (before > yStart + 1) return before
      return y
    }
  }
  return y
}

export async function exportPdf(el: HTMLElement, opt?: any): Promise<Uint8Array> {
  // 进度与日志：由调用方（main.ts）决定是否展示遮罩窗口。
  const startedAt = Date.now()
  const onProgress = (opt && typeof opt.onProgress === 'function') ? opt.onProgress : null
  const onLog = (opt && typeof opt.onLog === 'function') ? opt.onLog : null
  const cancelSource = opt && opt.cancelSource ? opt.cancelSource : null
  const safeLog = (msg: string, data?: any) => {
    try { if (onLog) onLog(msg, data) } catch {}
    try { console.log('[PDF导出]', msg, data || '') } catch {}
  }
  const safeProgress = (p: any) => {
    if (!onProgress) return
    try { onProgress({ ...(p || {}), elapsedMs: Math.max(0, Date.now() - startedAt) }) } catch {}
  }
  const throwIfCancelled = () => {
    try {
      if (cancelSource && cancelSource.cancelled) {
        const e: any = new Error('已取消导出')
        e._flymdCancelled = true
        throw e
      }
    } catch (e: any) {
      throw e
    }
  }

  // PDF 背景固定为白色：用户要求无论应用主题，PDF 始终是亮色白底。
  // 不再沿用 body 的 --bg，避免 dark mode 应用导出后 PDF 仍是深色。
  const resolvedBg = '#ffffff'

  // 在 exportRoot 上 inline 与 body.light-mode 等价的浅色 CSS 变量。
  // 这样 exportRoot 子树会按"等价浅色主题"渲染，无需修改 document.body。
  const LIGHT_THEME_VARS: Record<string, string> = {
    '--bg': '#ffffff',
    '--fg': '#1f2328',
    '--muted': '#6b7280',
    '--border': '#e5e7eb',
    '--preview-bg': '#fafafa',
    '--border-strong': '#d1d5db',
    '--panel-bg': '#f9fafb',
    '--wysiwyg-bg': '#f3f4f6',
    '--wysiwyg-status-bg': '#e5e7eb',
    '--code-bg': '#f3f4f6',
    '--table-border': '#cbd5e1',
    '--table-header-bg': '#f1f5f9',
    '--table-header-fg': '#1e293b',
    '--table-row-hover': '#f8fafc',
    '--code-border': '#e5e7eb',
    '--code-fg': '#1f2328',
    '--code-muted': '#6b7280',
    '--c-key': '#1d4ed8',
    '--c-str': '#059669',
    '--c-num': '#059669',
    '--c-fn': '#db2777',
    '--c-com': '#9ca3af',
  }
  const applyLightThemeVars = (root: HTMLElement): void => {
    try {
      for (const k in LIGHT_THEME_VARS) {
        try { root.style.setProperty(k, LIGHT_THEME_VARS[k]) } catch {}
      }
    } catch {}
  }

  safeProgress({ stage: 'prepare', message: '准备导出…' })
  // 先等“原页面”图片与字体稳定下来，否则 html2canvas 计算布局时会把未加载完的图片当成 0 高度，
  // 最终表现为：PDF 里图片缺失/只截了一半（典型就是图床慢的时候更容易触发）。
  try {
    const doc = el.ownerDocument || document
    await waitForFonts(doc)
    // 原预览里的图片加载失败/超时很常见（尤其是图床/CORS/离线），导出不应该在这里卡死。
    await waitForImagesIn(el, Math.max(0, Number(opt?.waitOrigImagesMs ?? EXPORT_WAIT_ORIG_IMAGES_MS) || 0))
    // 再等一帧，让布局把最终尺寸吃进去
    await nextFrame()
  } catch {}
  throwIfCancelled()

  const options = {
    margin: 10, // 单位：mm
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: resolvedBg, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    ...opt,
  }

  // 用 .preview 作为父作用域，复用现有 Markdown 样式（否则很多规则不会命中，表现为“格式丢了”）
  const exportRoot = document.createElement('div')
  exportRoot.className = 'preview flymd-export-preview'
  exportRoot.style.background = resolvedBg
  exportRoot.style.position = 'static'
  exportRoot.style.overflow = 'visible'
  exportRoot.style.padding = '0'

  // 强制浅色导出（关键：不动 document.body，避免 UI 闪烁 + 避免覆盖导出期间用户手动切换的主题）。
  // 直接在 exportRoot 上 inline 与 body.light-mode 等价的 CSS 变量，
  // 让 exportRoot 内部所有依赖 --bg/--fg/--table-* 等变量的规则都解析为浅色。
  // Mermaid SVG 内部颜色由 flymdReRenderMermaidIn 走强制 light 渲染（见下方），不受 CSS 变量影响。
  applyLightThemeVars(exportRoot)

  const clone = el.cloneNode(true) as HTMLElement

  // 强制展开所有 callout + 隐藏交互按钮：PDF 不支持点击交互，折叠态会丢内容，按钮也无意义。
  // 改在 clone 上而非原 el 上，避免 live UI 闪烁。
  try {
    const callouts = clone.querySelectorAll('.callout')
    callouts.forEach((el2) => {
      try {
        el2.classList.remove('folded')
        try { el2.removeAttribute('data-folded') } catch {}
        const content = el2.querySelector('.callout-content') as HTMLElement | null
        if (content) { try { content.style.display = '' } catch {} }
        const svg = el2.querySelector('.callout-fold-icon svg') as SVGElement | null
        if (svg) { try { svg.style.transform = '' } catch {} }
        // 隐藏折叠/复制按钮：PDF 中点击无意义，且占视觉空间
        const fold = el2.querySelector('.callout-fold-icon') as HTMLElement | null
        if (fold) { try { fold.style.display = 'none' } catch {} }
        const copy = el2.querySelector('.callout-copy-icon') as HTMLElement | null
        if (copy) { try { copy.style.display = 'none' } catch {} }
      } catch {}
    })
  } catch {}

  // 重新渲染 Mermaid：使用新主题（light），避免 dark mode 导出的 PDF 仍是黑底/白字。
  // 依赖 main.ts 暴露的 flymdReRenderMermaidIn：会清缓存、强制 mermaid.initialize(light)、逐节点重新渲染。
  try {
    const rerender = (window as any).flymdReRenderMermaidIn as ((c: HTMLElement) => Promise<void>) | undefined
    if (typeof rerender === 'function') {
      await rerender(clone)
    }
  } catch {}

  // 把原图片的最终尺寸/选中的资源同步到克隆节点，消除“布局依赖图片加载”的特殊情况
  try {
    const origImgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[]
    const cloneImgs = Array.from(clone.querySelectorAll('img')) as HTMLImageElement[]
    const n = Math.min(origImgs.length, cloneImgs.length)
    for (let i = 0; i < n; i++) {
      try {
        const o = origImgs[i]
        const c = cloneImgs[i]
        const src = String((o as any).currentSrc || o.src || '').trim()
        if (src) c.src = src
        const nw = Number(o.naturalWidth || 0)
        const nh = Number(o.naturalHeight || 0)
        if (nw > 0 && nh > 0) {
          c.setAttribute('width', String(nw))
          c.setAttribute('height', String(nh))
        }
      } catch {}
    }
  } catch {}

  // 关键：让 preview-body 在容器内自适应，不要撑破 html2pdf 的 A4 宽度容器
  try {
    // 调用方可能传入为了测量而隐藏/定位过的临时节点；克隆后必须按普通文档流导出。
    clone.style.position = 'static'
    clone.style.inset = 'auto'
    clone.style.left = 'auto'
    clone.style.top = 'auto'
    clone.style.right = 'auto'
    clone.style.bottom = 'auto'
    clone.style.width = '100%'
    clone.style.maxWidth = '100%'
    clone.style.boxSizing = 'border-box'
    clone.style.overflow = 'visible'
    clone.style.opacity = '1'
    clone.style.visibility = 'visible'
    clone.style.pointerEvents = 'auto'
    clone.style.zIndex = 'auto'
    clone.style.transform = 'none'
  } catch {}

  // 基础样式：保证图片不溢出 + KaTeX 关键样式
  const style = document.createElement('style')
  style.textContent = `
    /* 导出 PDF：禁用动画/过渡，避免 html2canvas 捕捉到中间态导致错位/截断 */
    .flymd-export-preview, .flymd-export-preview * { animation: none !important; transition: none !important; }

    /* 关键：统一为 border-box，彻底杜绝 padding 把宽度撑爆导致左右被裁 */
    .flymd-export-preview, .flymd-export-preview * { box-sizing: border-box !important; }
    .flymd-export-preview .preview-body { width: 100% !important; max-width: 100% !important; }
    .flymd-export-preview .preview-body { margin: 0 !important; padding: 10mm 10mm 12mm 10mm; }

    /* 导出 PDF：给列表 marker 留稳定槽位，避免 html2canvas 把符号压到正文上 */
    .flymd-export-preview ul,
    .flymd-export-preview ol {
      list-style-position: outside !important;
      margin-left: 0 !important;
      padding-left: 2.2em !important;
    }
    .flymd-export-preview li {
      padding-left: 0.35em !important;
    }
    .flymd-export-preview ul.task-list,
    .flymd-export-preview ol.task-list {
      list-style: none !important;
      padding-left: 1.2em !important;
    }
    .flymd-export-preview li.task-list-item {
      list-style: none !important;
      padding-left: 0 !important;
    }

    /* 不导出交互标记（这些东西会影响布局与分页） */
    .flymd-export-preview .code-copy,
    .flymd-export-preview .code-lang,
    .flymd-export-preview .caret-dot {
      display: none !important;
    }

    /* 沿用项目自身主题：不覆盖 --bg/--fg/--code-bg 等 CSS 变量，
       不强制 background/color，让 .flymd-export-preview 自然继承 body 当前主题。
       这避免了 Mermaid 等 SVG 内部 currentColor / var(--text) 被强制值覆盖后
       与自身填充色相近导致文字不可见的问题。
       代码块语法高亮的 --c-* 引用由项目 CSS 提供（不同 .md-* 主题各自定义）。 */

    /* 导出容器：让 .preview 从“应用布局”退化为“普通文档流” */
    .flymd-export-preview.preview {
      position: static !important;
      top: auto !important; left: auto !important; right: auto !important; bottom: auto !important;
      overflow: visible !important;
      opacity: 1 !important;
      visibility: visible !important;
      padding: 0 !important;
      box-shadow: none !important;
    }

    .flymd-export-preview .preview {
      position: static !important;
      top: auto !important; left: auto !important; right: auto !important; bottom: auto !important;
      overflow: visible !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      z-index: auto !important;
      transform: none !important;
    }

    .flymd-export-preview .preview-body img,
    .flymd-export-preview img { max-width: 100% !important; height: auto !important; }
    .flymd-export-preview figure { max-width: 100% !important; }

    /* 导出时禁用图片阴影：阴影在分页边界会被“切一条”，看起来像图片被切割 */
    .flymd-export-preview img { box-shadow: none !important; }

    /* 断页保护：尽量别在块级元素内部断页（避免出现“半行在上一页、半行在下一页”） */
    .flymd-export-preview p,
    .flymd-export-preview blockquote,
    .flymd-export-preview pre,
    .flymd-export-preview table,
    .flymd-export-preview figure,
    .flymd-export-preview ul,
    .flymd-export-preview ol,
    .flymd-export-preview li,
    .flymd-export-preview hr,
    .flymd-export-preview img,
    .flymd-export-preview svg,
    .flymd-export-preview canvas {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .flymd-export-preview h1,
    .flymd-export-preview h2,
    .flymd-export-preview h3,
    .flymd-export-preview h4,
    .flymd-export-preview h5,
    .flymd-export-preview h6 { break-after: avoid-page; page-break-after: avoid; }

    /* KaTeX 关键样式（必需，确保 PDF 中根号等符号正确显示） */
    .flymd-export-preview .katex { font-size: 1em; text-indent: 0; text-rendering: auto; }
    .flymd-export-preview .katex svg { display: inline-block; position: relative; width: 100%; height: 100%; }
    .flymd-export-preview .katex svg path { fill: currentColor; }
    .flymd-export-preview .katex .hide-tail { overflow: hidden; }
    .flymd-export-preview .md-math-inline .katex { display: inline-block; }
    .flymd-export-preview .md-math-block .katex { display: block; text-align: center; }
  `
  exportRoot.appendChild(style)
  exportRoot.appendChild(clone)

  // 冻结 SVG 为屏幕显示尺寸（逐一读取原节点的像素尺寸）
  // 但完全跳过 KaTeX 的 SVG，因为它们需要特殊的 viewBox 处理
  try {
    const origSvgs = Array.from((el as HTMLElement).querySelectorAll('svg')) as SVGElement[]
    const cloneSvgs = Array.from(clone.querySelectorAll('svg')) as SVGElement[]
    const n = Math.min(origSvgs.length, cloneSvgs.length)
    for (let i = 0; i < n; i++) {
      try {
        // 跳过 KaTeX 的 SVG
        if (cloneSvgs[i].closest('.katex')) {
          // KaTeX SVG：读取实际屏幕像素尺寸并设置
          const r = (origSvgs[i] as any).getBoundingClientRect?.() || { width: 0, height: 0 }
          const w = Math.max(1, Math.round((r.width as number) || 0))
          const h = Math.max(1, Math.round((r.height as number) || 0))
          // 保留 viewBox 但设置实际像素尺寸
          cloneSvgs[i].setAttribute('width', String(w))
          cloneSvgs[i].setAttribute('height', String(h))
          cloneSvgs[i].style.width = w + 'px'
          cloneSvgs[i].style.height = h + 'px'
          continue
        }

        // 非 KaTeX SVG（mermaid、图表等）：使用原有逻辑
        const r = (origSvgs[i] as any).getBoundingClientRect?.() || { width: 0, height: 0 }
        const w = Math.max(1, Math.round((r.width as number) || 0))
        const h = Math.max(1, Math.round((r.height as number) || 0))
        cloneSvgs[i].setAttribute('preserveAspectRatio', 'xMidYMid meet')
        if (w) cloneSvgs[i].setAttribute('width', String(w))
        if (h) cloneSvgs[i].setAttribute('height', String(h))
        try { (cloneSvgs[i].style as any).width = w + 'px'; (cloneSvgs[i].style as any).height = 'auto' } catch {}
      } catch {}
    }
  } catch {}

  // 图片内联与等待改到“挂载到文档之后”执行（见下方 mount 之后）：
  // detached 节点的 <img> 不会发起加载，必须在元素进入文档后再替换为 blob: 并等待，
  // 否则 html2canvas 会截到尚未加载完成的空白图。
  const blobUrls: string[] = []
  let mount: HTMLDivElement | null = null
  let viewport: HTMLDivElement | null = null
  try {
    throwIfCancelled()

    let html2canvas: any = null
    let jsPDF: any = null
    try {
      const m: any = await import('html2canvas')
      html2canvas = (m && (m.default || m)) || m
    } catch {}
    try {
      const m: any = await import('jspdf')
      jsPDF = m?.jsPDF || m?.default?.jsPDF || m?.default || m
    } catch {}

    // 兜底：如果依赖加载失败，回退到 html2pdf（保持功能可用）
    if (typeof html2canvas !== 'function' || typeof jsPDF !== 'function') {
      safeLog('html2canvas/jspdf 加载失败，回退到 html2pdf', { html2canvas: typeof html2canvas, jsPDF: typeof jsPDF })
      safeProgress({ stage: 'render', message: '正在回退导出引擎…' })
      const mod: any = await import('html2pdf.js/dist/html2pdf.bundle.min.js')
      const html2pdf: any = (mod && (mod.default || mod)) || mod
      const ab: ArrayBuffer = await html2pdf().set(options).from(exportRoot).toPdf().output('arraybuffer')
      return new Uint8Array(ab)
    }

    const marginMm = Math.max(0, Number((options as any)?.margin ?? 10) || 0)
    const pdf = new jsPDF({
      // 这里强制使用 mm：导出 DOM/CSS 也用 mm，单位不一致只会制造无意义的复杂性。
      unit: 'mm',
      format: (options as any)?.jsPDF?.format || 'a4',
      orientation: (options as any)?.jsPDF?.orientation || 'portrait',
      compress: true,
    })
    const pageW = Number(pdf.internal?.pageSize?.getWidth?.() || 0) || 210
    const pageH = Number(pdf.internal?.pageSize?.getHeight?.() || 0) || 297
    const innerW = Math.max(1, pageW - marginMm * 2)
    const innerH = Math.max(1, pageH - marginMm * 2)

    // 让导出 DOM 的排版宽度锁定为“纸张可打印宽度”，避免因为窗口宽度不同导致的分页差异。
    exportRoot.style.width = innerW + 'mm'
    exportRoot.style.maxWidth = innerW + 'mm'

    // 挂载到 DOM：让 html2canvas 拿到稳定的 layout（不挂载时偶尔会出现高度为 0 或字体测量偏差）。
    safeProgress({ stage: 'layout', message: '正在准备排版…' })
    mount = document.createElement('div')
    mount.className = 'flymd-pdf-export-mount'
    mount.style.position = 'fixed'
    mount.style.left = '-100000px'
    mount.style.top = '0'
    mount.style.width = innerW + 'mm'
    mount.style.maxWidth = innerW + 'mm'
    mount.style.background = resolvedBg
    mount.style.overflow = 'visible'
    mount.style.pointerEvents = 'none'
    mount.style.zIndex = '-1'
    // 强制 exportRoot 走浅色主题：覆盖 body.dark-mode 各类选择器的 hardcoded !important 颜色。
    // 用 mount 内联的 <style>，mount 在 finally 中被 remove，所以 style 不会污染应用主题。
    // 选择器必须带 body.dark-mode 前缀——dark-mode 规则特异性 (0,2,2) / (0,3,1) 高于裸的 .preview (0,1,0)，
    // !important 仍可胜出。导出时 body 可能处于 dark-mode，应用是 dark 也不影响 PDF 走浅色。
    const forceLight = document.createElement('style')
    forceLight.textContent = `
      body.dark-mode .preview.flymd-export-preview,
      body.dark-mode .preview.flymd-export-preview .preview-body,
      body.light-mode .preview.flymd-export-preview,
      body.light-mode .preview.flymd-export-preview .preview-body {
        background: #ffffff !important;
        color: #1f2328 !important;
      }
      body.dark-mode .preview.flymd-export-preview a,
      body.dark-mode .preview.flymd-export-preview a:hover,
      body.light-mode .preview.flymd-export-preview a,
      body.light-mode .preview.flymd-export-preview a:hover {
        color: #2563eb !important;
      }
      body.dark-mode .preview.flymd-export-preview :not(pre) > code,
      body.light-mode .preview.flymd-export-preview :not(pre) > code {
        background: #f3f4f6 !important;
        color: #1f2328 !important;
      }
      body.dark-mode .preview.flymd-export-preview pre,
      body.light-mode .preview.flymd-export-preview pre {
        background: #f3f4f6 !important;
        color: #1f2328 !important;
        border-color: #e5e7eb !important;
      }
      /* 代码块语法高亮：让 hljs token 走 exportRoot inline 的 --c-* 变量（与 body.light-mode 配色一致）。
         选择器必须带 body.dark-mode 前缀，否则 dark-mode 规则 (0,3,1) 会胜出。
         var(--c-*) 让 token 颜色由 exportRoot 上 inline 的浅色调色板决定，保留项目自身高亮对比。 */
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-keyword,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-selector-tag,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-built_in,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-keyword,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-selector-tag,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-built_in { color: var(--c-key) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-title,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-section,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-function,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-title,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-section,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-function { color: var(--c-fn) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-string,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-attr,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-template-variable,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-string,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-attr,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-template-variable { color: var(--c-str) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-number,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-literal,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-bullet,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-number,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-literal,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-bullet { color: var(--c-num) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-comment,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-quote,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-comment,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-quote { color: var(--c-com) !important; font-style: italic !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-variable,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-params,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-property,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-variable,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-params,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-property { color: var(--fg) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-class,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-type,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-class,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-type { color: var(--c-fn) !important; }
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-operator,
      body.dark-mode .preview.flymd-export-preview code.hljs .hljs-punctuation,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-operator,
      body.light-mode .preview.flymd-export-preview code.hljs .hljs-punctuation { color: var(--fg) !important; }
      body.dark-mode .preview.flymd-export-preview blockquote,
      body.light-mode .preview.flymd-export-preview blockquote {
        border-left-color: #e5e7eb !important;
        color: #4b5563 !important;
      }
      body.dark-mode .preview.flymd-export-preview table,
      body.light-mode .preview.flymd-export-preview table {
        border-color: #cbd5e1 !important;
        box-shadow: none !important;
      }
      body.dark-mode .preview.flymd-export-preview table tbody tr:nth-child(even) td,
      body.light-mode .preview.flymd-export-preview table tbody tr:nth-child(even) td {
        background: #f8fafc !important;
      }
      body.dark-mode .preview.flymd-export-preview table tbody tr:hover td,
      body.light-mode .preview.flymd-export-preview table tbody tr:hover td {
        background: #f1f5f9 !important;
      }
      body.dark-mode .preview.flymd-export-preview hr,
      body.light-mode .preview.flymd-export-preview hr {
        border-color: #e5e7eb !important;
      }
      /* Callout 兜底展开 + 隐藏交互按钮：PDF 不支持点击交互。
         正常路径在 pdfContextExport / pdf.ts 主路径已 JS 强制展开并隐藏按钮；这里 CSS 兜底双保险。 */
      body.dark-mode .preview.flymd-export-preview .callout-content,
      body.light-mode .preview.flymd-export-preview .callout-content {
        display: block !important;
      }
      body.dark-mode .preview.flymd-export-preview .callout-fold-icon,
      body.dark-mode .preview.flymd-export-preview .callout-copy-icon,
      body.light-mode .preview.flymd-export-preview .callout-fold-icon,
      body.light-mode .preview.flymd-export-preview .callout-copy-icon {
        display: none !important;
      }
    `
    mount.appendChild(forceLight)
    // viewport：用于“分页渲染”时裁切可视区域，避免一次性生成超长大画布导致黑页。
    viewport = document.createElement('div')
    viewport.className = 'flymd-pdf-export-viewport'
    viewport.style.position = 'relative'
    viewport.style.width = innerW + 'mm'
    viewport.style.maxWidth = innerW + 'mm'
    viewport.style.background = resolvedBg
    viewport.style.overflow = 'visible'
    viewport.appendChild(exportRoot)
    mount.appendChild(viewport)
    document.body.appendChild(mount)

    try {
      safeProgress({ stage: 'prepare', message: '正在处理图片与字体…' })
      await waitForFonts(document)
      // 元素已挂载到文档：此时把本地/远程/asset 图片替换为 blob: 同源资源，<img> 才会真正发起加载。
      try {
        const imagePrep = await inlineImagesForPdf(exportRoot, {
          sourceFilePath: opt?.sourceFilePath || opt?.filePath || null,
          remoteTimeoutMs: Math.max(0, Number(opt?.fetchRemoteImageMs ?? EXPORT_FETCH_REMOTE_IMAGE_MS) || 0),
          localTimeoutMs: Math.max(0, Number(opt?.readLocalImageMs ?? EXPORT_READ_LOCAL_IMAGE_MS) || 0),
          onLog: safeLog,
        })
        blobUrls.push(...imagePrep.objectUrls)
        if (imagePrep.total > 0) {
          safeProgress({ stage: 'prepare', message: `图片处理完成：${imagePrep.inlined}/${imagePrep.total}` })
        }
      } catch {}
      // 等待图片解码（含 blob: 加载）；给大图/慢盘更充裕余量，避免截到未加载态。
      await waitForImagesIn(exportRoot, Math.max(8000, Number(opt?.waitCloneImagesMs ?? EXPORT_WAIT_CLONE_IMAGES_MS) || 0))
      await nextFrame()
    } catch {}
    throwIfCancelled()

    // 性能兜底：长文档用较低 scale，避免“导出很慢/内存爆炸”；短文档保持清晰度。
    try {
      const baseScale = Number((options as any)?.html2canvas?.scale ?? 2) || 2
      const r = exportRoot.getBoundingClientRect?.()
      const h = Number(r?.height || 0) || 0
      let cap = baseScale
      if (h > 22000) cap = Math.min(cap, 1.25)
      else if (h > 12000) cap = Math.min(cap, 1.5)
      ;(options as any).html2canvas = { ...(options as any).html2canvas, scale: cap }
    } catch {}

    const avoidCss = collectAvoidRangesCss(exportRoot)
    const breakCandidatesCss = collectBreakCandidatesCss(exportRoot)
    const rootRectForMap = (() => {
      try { return exportRoot.getBoundingClientRect() } catch { return null }
    })()

    const quality = Math.max(0.5, Math.min(1, Number((options as any)?.image?.quality ?? 0.98) || 0.98))

    // 自动选择渲染策略：
    // - 短文档：一次性渲成大图，再切片（更快）
    // - 长文档：按页渲染（消灭“超长 canvas 黑页”）
    const usePagedRender = (() => {
      if (opt?.paged === true) return true
      if (opt?.paged === false) return false
      try {
        const wCss = Number(rootRectForMap?.width || 0) || 0
        const hCss = Number(rootRectForMap?.height || 0) || 0
        const scale = Number((options as any)?.html2canvas?.scale ?? 1) || 1
        // 经验阈值：Chrome/WebView2 在超大画布上会直接出黑图/空图（通常不抛错），
        // 这里宁可多做几次按页渲染，也不要再赌“一把梭哈整篇”。
        const maxCanvasSidePx = Math.max(4096, Number(opt?.maxCanvasSidePx ?? 15000) || 15000)
        if (wCss * scale > maxCanvasSidePx) return true
        if (hCss * scale > maxCanvasSidePx) return true
      } catch {}
      return false
    })()

    if (usePagedRender && viewport) {
      // 分页渲染：每一页只渲染一个“裁切视口”，彻底避免创建超长大画布。
      safeProgress({ stage: 'paginate', message: '正在计算分页…' })
      const wCss = Math.max(1, Number(rootRectForMap?.width || 0) || 0)
      const hCssTotal = (() => {
        try {
          const r = exportRoot.getBoundingClientRect?.()
          const h1 = Number(r?.height || 0) || 0
          const h2 = Number((exportRoot as any).scrollHeight || 0) || 0
          return Math.max(h1, h2)
        } catch {
          return Math.max(1, Number(rootRectForMap?.height || 0) || 0)
        }
      })()
      const pxPerMmCss = wCss / innerW
      const pageHeightCss = Math.max(1, innerH * pxPerMmCss)

      // 更激进的缩放兜底：长文档按页渲染也会很慢，scale 太高只会让用户等到崩溃。
      try {
        const baseScale = Number((options as any)?.html2canvas?.scale ?? 2) || 2
        const estPages = Math.max(1, Math.ceil(hCssTotal / pageHeightCss))
        let cap = baseScale
        if (estPages > 120) cap = Math.min(cap, 0.9)
        else if (estPages > 80) cap = Math.min(cap, 1.0)
        else if (estPages > 50) cap = Math.min(cap, 1.15)
        else if (estPages > 30) cap = Math.min(cap, 1.25)
        ;(options as any).html2canvas = { ...(options as any).html2canvas, scale: cap }
        safeLog('分页渲染参数', { estPages, scale: cap, hCssTotal: Math.round(hCssTotal), pageHeightCss: Math.round(pageHeightCss) })
      } catch {}

      // 预计算断页信息（CSS 像素坐标）：不要在循环里反复跑 getClientRects。
      const avoidRangesCss = mergeRanges(avoidCss, 6)
      const breakCandidates = (() => {
        try {
          const arr = (breakCandidatesCss || []).filter((v) => v > 0 && v < hCssTotal)
          arr.push(hCssTotal)
          return uniqSorted(arr, 1)
        } catch {
          return [hCssTotal]
        }
      })()

      viewport.style.overflow = 'hidden'
      try { exportRoot.style.willChange = 'transform' } catch {}

      // 预计算页边界：先把分页点算出来，这样能拿到“总页数”，避免用户觉得卡死。
      const pageEnds: number[] = []
      try {
        let y = 0
        let guard = 0
        while (y < hCssTotal - 1) {
          guard++
          if (guard > 20000) break
          const desiredEnd = Math.min(hCssTotal, y + pageHeightCss)
          let end = 0
          if (desiredEnd >= hCssTotal) end = hCssTotal
          else end = pickEndByCandidates(y, desiredEnd, breakCandidates, avoidRangesCss)
          if (!end) end = desiredEnd
          end = adjustBreakAvoidingRanges(end, y, avoidRangesCss)
          end = clampInt(end, y + 1, desiredEnd)
          pageEnds.push(end)
          if (end >= hCssTotal) break
          y = Math.max(y + 1, end)
        }
      } catch {}

      const totalPages = Math.max(1, pageEnds.length || 0)
      safeProgress({ stage: 'render', message: '开始渲染页面…', done: 0, total: totalPages })

      let first = true
      let yStart = 0
      for (let i = 0; i < pageEnds.length; i++) {
        throwIfCancelled()
        const end = pageEnds[i]
        const sliceH = Math.max(1, end - yStart)
        viewport.style.height = sliceH + 'px'
        exportRoot.style.transform = `translateY(${-yStart}px)`
        try { await nextFrame() } catch {}

        safeProgress({
          stage: 'render',
          message: `正在渲染第 ${i + 1}/${totalPages} 页…`,
          done: i,
          total: totalPages,
        })

        const pageStartedAt = Date.now()
        const pageCanvas: HTMLCanvasElement = await html2canvas(viewport, {
          ...(options as any)?.html2canvas,
          backgroundColor: (options as any)?.html2canvas?.backgroundColor || resolvedBg,
          scrollX: 0,
          scrollY: 0,
          logging: false,
        })
        const pageCostMs = Date.now() - pageStartedAt
        if (pageCostMs > 4500) {
          safeLog('单页渲染耗时偏长', { page: i + 1, total: totalPages, ms: pageCostMs })
        }

        const imgData = pageCanvas.toDataURL('image/jpeg', quality)
        const pxPerMm = pageCanvas.width / innerW
        const drawH = pageCanvas.height / Math.max(1e-6, pxPerMm)
        if (!first) pdf.addPage()
        first = false
        pdf.addImage(imgData, 'JPEG', marginMm, marginMm, innerW, drawH, undefined, 'FAST')

        safeProgress({ stage: 'render', done: i + 1, total: totalPages })
        yStart = end
        if (end >= hCssTotal) break
      }
      try { exportRoot.style.transform = '' } catch {}
    } else {
      // 旧路径：一次性渲整篇再切片。短文档更快，但长文档可能触发“黑页”。
      safeProgress({ stage: 'render', message: '正在渲染整篇文档…' })
      const fullStartedAt = Date.now()
      const canvas: HTMLCanvasElement = await html2canvas(exportRoot, {
        ...(options as any)?.html2canvas,
        backgroundColor: (options as any)?.html2canvas?.backgroundColor || resolvedBg,
        scrollX: 0,
        scrollY: 0,
        logging: false,
      })
      const fullCostMs = Date.now() - fullStartedAt
      if (fullCostMs > 4500) safeLog('整篇渲染耗时', { ms: fullCostMs, height: canvas.height, width: canvas.width })

      const pxPerMm = canvas.width / innerW
      const pageHeightPx = Math.max(1, Math.floor(innerH * pxPerMm))
      const estTotal = Math.max(1, Math.ceil(canvas.height / Math.max(1, pageHeightPx)))
      safeProgress({ stage: 'render', message: '正在生成 PDF 页面…', done: 0, total: estTotal })

      const avoidRanges = (() => {
        try {
          const wCss = Number(rootRectForMap?.width || 0) || 0
          const cssToCanvas = canvas.width / Math.max(1, wCss)
          return mergeRanges(avoidCss.map((r) => ({ top: r.top * cssToCanvas, bottom: r.bottom * cssToCanvas })), 6)
        } catch {
          return [] as AvoidRange[]
        }
      })()

      const breakCandidatesPx = (() => {
        try {
          const wCss = Number(rootRectForMap?.width || 0) || 0
          const cssToCanvas = canvas.width / Math.max(1, wCss)
          const arr = (breakCandidatesCss || []).map((v) => v * cssToCanvas).filter((v) => v > 0 && v < canvas.height)
          arr.push(canvas.height)
          return uniqSorted(arr, 1)
        } catch {
          return [canvas.height]
        }
      })()

      // 每页切分：优先把切点对齐到“行间空白”，并避开图片/表格等不可切割块。
      // 不要做“页间重叠”：那只会把上一页的半行文字带到下一页顶部，看起来像“分页乱码”。
      const overlapPx = 0
      let y = 0
      let first = true
      let donePages = 0
      while (y < canvas.height) {
        throwIfCancelled()
        const targetEnd = Math.min(canvas.height, y + pageHeightPx)
        let end = 0
        if (targetEnd >= canvas.height) end = canvas.height
        else end = pickEndByCandidates(y, targetEnd, breakCandidatesPx, avoidRanges)

        if (!end) end = pickBreakYByWhitespace(canvas, y, targetEnd, 28)
        end = adjustBreakAvoidingRanges(end, y, avoidRanges)
        end = clampInt(end, y + 1, targetEnd)
        const sliceH = Math.max(1, end - y)

        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvas.width
        pageCanvas.height = sliceH
        const pctx = pageCanvas.getContext('2d')
        if (!pctx) throw new Error('无法创建 canvas 上下文')
        pctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

        const imgData = pageCanvas.toDataURL('image/jpeg', quality)
        const drawH = sliceH / pxPerMm
        if (!first) pdf.addPage()
        first = false
        pdf.addImage(imgData, 'JPEG', marginMm, marginMm, innerW, drawH, undefined, 'FAST')
        donePages++
        safeProgress({ stage: 'render', done: donePages, total: estTotal })

        if (end >= canvas.height) break
        // 保证单调前进：不重叠时直接从切点继续。
        y = Math.max(y + 1, end - overlapPx)
      }
    }

    safeProgress({ stage: 'finalize', message: '正在写入 PDF…' })
    const ab: ArrayBuffer = pdf.output('arraybuffer')
    safeProgress({ stage: 'done', message: 'PDF 已生成' })
    return new Uint8Array(ab)
  } finally {
    try {
      if (mount) mount.remove()
      else if (exportRoot.parentNode) exportRoot.parentNode.removeChild(exportRoot)
    } catch {}
    // 释放 blob URL，避免长文档导出后内存涨不回来
    for (const u of blobUrls) {
      try { URL.revokeObjectURL(u) } catch {}
    }
    // 不再需要恢复 document.body 主题类——本次导出全程未修改 document.body。
    // 用户在导出期间切换主题也不会被吞。
  }
}
