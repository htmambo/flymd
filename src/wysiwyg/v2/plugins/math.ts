// Milkdown Math 插件：修复 KaTeX 渲染时显示源代码的问题
import { $view } from '@milkdown/utils'
import { mathInlineSchema, mathBlockSchema } from '@milkdown/plugin-math'
import type { Node } from '@milkdown/prose/model'
import type { EditorView, NodeView } from '@milkdown/prose/view'
import { normalizeKatexLatexForInline } from '../../../utils/katexNormalize'
import { isInputPendingCompat } from '../../../utils/platform'
import { attachOverlayError } from '../overlayError'

// 所见模式的大文档性能关键点：不要在主线程里同步渲染一堆 KaTeX。
// 这里采用“空闲时渲染 + 有输入就让路 + 小公式缓存”的策略，避免右键/按钮点击被卡住。
let _katexReady: Promise<any> | null = null
const _katexHtmlCache = new Map<string, string>()
const KATEX_HTML_CACHE_MAX = 1500
const KATEX_HTML_CACHE_MAX_LATEX_LEN = 512
let _mathIO: IntersectionObserver | null = null
const _mathIOHandlers = new WeakMap<Element, () => void>()

function requestIdleCompat(cb: (deadline?: any) => void, timeout = 200) {
  try {
    const ric: any = (globalThis as any).requestIdleCallback
    if (typeof ric === 'function') return ric(cb, { timeout })
  } catch {}
  return setTimeout(() => cb(undefined), 16) as any
}

async function ensureKatexReady(): Promise<any> {
  if (_katexReady) return _katexReady
  _katexReady = (async () => {
    // KaTeX 与 mhchem 只需要加载一次；动态导入是为了不影响无公式文档的启动速度。
    const [katex] = await Promise.all([
      import('katex'),
      import('katex/contrib/mhchem'),
      import('katex/dist/katex.min.css'),
    ])
    return katex
  })()
  return _katexReady
}

function renderKatexToHtmlCached(katexMod: any, latex: string, displayMode: boolean): string {
  const src = latex || ''
  const canCache = src.length > 0 && src.length <= KATEX_HTML_CACHE_MAX_LATEX_LEN
  const key = canCache ? `${displayMode ? 'B' : 'I'}:${src}` : ''
  if (canCache) {
    const hit = _katexHtmlCache.get(key)
    if (hit != null) return hit
  }
  const html = katexMod.default.renderToString(src, {
    throwOnError: false,
    displayMode,
    strict: 'ignore',
  })
  if (canCache) {
    if (_katexHtmlCache.size >= KATEX_HTML_CACHE_MAX) _katexHtmlCache.clear()
    _katexHtmlCache.set(key, html)
  }
  return html
}

function observeMathOnce(el: Element, onVisible: () => void) {
  try {
    const IO: any = (globalThis as any).IntersectionObserver
    if (typeof IO !== 'function') { onVisible(); return }
    // 闭包内 _mathIO?.unobserve(...) 会让 TS 把外部 _mathIO 加宽回
    // IntersectionObserver | null，导致下一行 _mathIO.observe(el) 报错。
    // 用局部 observer 承接实例，对 _mathIO 的赋值也保留。
    let observer: IntersectionObserver | null = _mathIO
    if (!observer) {
      observer = new IO((entries: any[]) => {
        for (const ent of entries || []) {
          try {
            if (!ent || !ent.isIntersecting) continue
            const target = ent.target as Element
            const fn = _mathIOHandlers.get(target)
            if (!fn) { try { _mathIO?.unobserve(target) } catch {} ; continue }
            _mathIOHandlers.delete(target)
            try { _mathIO?.unobserve(target) } catch {}
            fn()
          } catch {}
        }
      }, { root: null, rootMargin: '800px 0px', threshold: 0 })
      _mathIO = observer
    }
    _mathIOHandlers.set(el, onVisible)
    // 闭包未修改 observer，if 分支保证此处非空
    observer!.observe(el)
  } catch {
    onVisible()
  }
}

// PR-2 A1: 公式节点编辑按钮(铅笔图标)
// 默认隐藏,hover 父元素时显示,点击调用 window.__mdeditorEnterLatexSourceEdit
// 通过 window 桥接避免 NodeView 静态依赖编辑器实例(同 mermaid 模式)
// PR-2 A4: 节点内嵌错误条 — 复用 overlayError.handle,默认隐藏,渲染失败时显示
// 给 host 附加一个 OverlayErrorHandle,WeakMap 缓存,避免重复附加
const _inlineErrHandles = new WeakMap<HTMLElement, ReturnType<typeof attachOverlayError>>()
function ensureInlineErrorOnHandle(host: HTMLElement): ReturnType<typeof attachOverlayError> {
  let h = _inlineErrHandles.get(host)
  if (!h) {
    h = attachOverlayError(host as unknown as HTMLDivElement)
    try {
      h.el.classList.add('ov-error-bar-embedded')
      h.el.style.position = 'absolute'
      h.el.style.top = '-22px'
      h.el.style.left = '0'
      h.el.style.right = '0'
      h.el.style.zIndex = '6'
      h.el.style.marginBottom = '0'
    } catch {}
    _inlineErrHandles.set(host, h)
  }
  return h
}

function showInlineErrorOn(host: HTMLElement, e: unknown): void {
  try { ensureInlineErrorOnHandle(host).setError(e) } catch {}
}

function clearInlineErrorOn(host: HTMLElement): void {
  try { ensureInlineErrorOnHandle(host).clear() } catch {}
}
function createMathEditButton(parent: HTMLElement, type: 'math_inline' | 'math_block'): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'math-edit-btn'
  btn.dataset.type = type
  btn.setAttribute('aria-label', '编辑公式源码')
  btn.setAttribute('title', '编辑公式源码')
  // 内联 SVG 铅笔图标
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 1.5l3 3-8.5 8.5H3v-3l8.5-8.5z"/><path d="M10 3l3 3"/></svg>'
  btn.addEventListener('mousedown', (e) => {
    // 阻止 PM 选中丢失
    e.preventDefault()
    e.stopPropagation()
  })
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const fn = (window as any).__mdeditorEnterLatexSourceEdit
      if (typeof fn === 'function') fn(parent)
    } catch (err) {
      try { console.error('[math edit btn]', err) } catch {}
    }
  })
  return btn
}

// Math Inline NodeView
class MathInlineNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null
  private katexContainer: HTMLElement
  private node: Node
  private renderSeq = 0
  private editBtn: HTMLButtonElement | null = null

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node

    // 创建外层容器
    this.dom = document.createElement('span')
    this.dom.classList.add('math-inline-wrapper')
    this.dom.dataset.type = 'math_inline'
    this.dom.style.display = 'inline-block'
    this.dom.style.position = 'relative'

    // 创建隐藏的 contentDOM（保持可编辑）
    this.contentDOM = document.createElement('span')
    this.contentDOM.style.position = 'absolute'
    this.contentDOM.style.opacity = '0'
    this.contentDOM.style.pointerEvents = 'none'
    this.contentDOM.style.width = '0'
    this.contentDOM.style.height = '0'
    this.contentDOM.style.overflow = 'hidden'
    this.dom.appendChild(this.contentDOM)

    // 创建 KaTeX 渲染容器
    this.katexContainer = document.createElement('span')
    this.katexContainer.classList.add('katex-display-inline')
    this.dom.appendChild(this.katexContainer)

    // PR-2 A1: 铅笔按钮 — hover 时显示,点击进入源码编辑
    this.editBtn = createMathEditButton(this.dom, 'math_inline')

    // 初始渲染
    this.scheduleRender()
  }

  private scheduleRender() {
    const seq = ++this.renderSeq
    const doRender = async () => {
      if (seq !== this.renderSeq) return
      // 用户正在输入/滚动时，先别抢 UI。
      if (isInputPendingCompat()) { requestIdleCompat(() => { void doRender() }, 200); return }
      let katex: any
      try { katex = await ensureKatexReady() } catch { return }
      if (seq !== this.renderSeq) return
      try {
        const code = this.node.textContent || ''
        const valueRaw = this.node.attrs.value || code
        const value = normalizeKatexLatexForInline(valueRaw)
        try { (this.dom as HTMLElement).dataset.value = valueRaw } catch {}

        // 使用 renderToString + innerHTML，减少 DOM 操作开销；并对小公式做缓存。
        this.katexContainer.innerHTML = renderKatexToHtmlCached(katex, value, false)
        // PR-2 A4: 渲染成功,清掉内嵌错误条
        clearInlineErrorOn(this.dom)
      } catch (e) {
        try { this.katexContainer.textContent = this.node.textContent || '' } catch {}
        // PR-2 A4: 渲染失败,在 dom 顶部显示内嵌错误条
        showInlineErrorOn(this.dom, e)
      }
    }

    // 超大文档：只在元素进入可视区域附近再渲染，避免一次性创建几千个 KaTeX 把 UI 卡死。
    observeMathOnce(this.dom, () => { requestIdleCompat(() => { void doRender() }, 200) })
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false

    const oldValue = this.node.attrs.value || this.node.textContent
    const newValue = node.attrs.value || node.textContent

    this.node = node

    if (oldValue !== newValue) {
      this.scheduleRender()
    }

    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    // 节点被移除时取消观察，避免观察器长期持有无用目标。
    try { _mathIOHandlers.delete(this.dom) } catch {}
    try { _mathIO?.unobserve(this.dom) } catch {}
    if (this.editBtn) {
      try { this.editBtn.remove() } catch {}
      this.editBtn = null
    }
  }
}

// Math Block NodeView
class MathBlockNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | null
  private katexContainer: HTMLElement
  private node: Node
  private renderSeq = 0
  private editBtn: HTMLButtonElement | null = null

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node

    // 创建外层容器
    this.dom = document.createElement('div')
    this.dom.classList.add('math-block-wrapper')
    this.dom.dataset.type = 'math_block'
    this.dom.style.margin = '1em 0'
    this.dom.style.position = 'relative'

    // 创建隐藏的 contentDOM（保持可编辑）
    this.contentDOM = document.createElement('div')
    this.contentDOM.style.position = 'absolute'
    this.contentDOM.style.opacity = '0'
    this.contentDOM.style.pointerEvents = 'none'
    this.contentDOM.style.width = '0'
    this.contentDOM.style.height = '0'
    this.contentDOM.style.overflow = 'hidden'
    this.dom.appendChild(this.contentDOM)

    // 创建 KaTeX 渲染容器
    this.katexContainer = document.createElement('div')
    this.katexContainer.classList.add('katex-display-block')
    this.katexContainer.style.textAlign = 'center'
    this.dom.appendChild(this.katexContainer)

    // PR-2 A1: 铅笔按钮 — hover 时显示,点击进入源码编辑
    this.editBtn = createMathEditButton(this.dom, 'math_block')

    // 初始渲染
    this.scheduleRender()
  }

  private scheduleRender() {
    const seq = ++this.renderSeq
    const doRender = async () => {
      if (seq !== this.renderSeq) return
      if (isInputPendingCompat()) { requestIdleCompat(() => { void doRender() }, 200); return }
      let katex: any
      try { katex = await ensureKatexReady() } catch (e) {
        try { showInlineErrorOn(this.dom, e) } catch {}
        return
      }
      if (seq !== this.renderSeq) return
      try {
        const valueRaw = this.node.attrs.value || this.node.textContent || ''
        const value = normalizeKatexLatexForInline(valueRaw)
        try { (this.dom as HTMLElement).dataset.value = valueRaw } catch {}
        this.katexContainer.innerHTML = renderKatexToHtmlCached(katex, value, true)
        // PR-2 A4: 渲染成功,清掉错误条
        try { clearInlineErrorOn(this.dom) } catch {}
      } catch (e) {
        try { showInlineErrorOn(this.dom, e) } catch {}
        try { this.katexContainer.textContent = this.node.textContent || '' } catch {}
      }
    }

    observeMathOnce(this.dom, () => { requestIdleCompat(() => { void doRender() }, 200) })
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false

    const oldValue = this.node.attrs.value || this.node.textContent
    const newValue = node.attrs.value || node.textContent

    this.node = node

    if (oldValue !== newValue) {
      this.scheduleRender()
    }

    return true
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    try { _mathIOHandlers.delete(this.dom) } catch {}
    try { _mathIO?.unobserve(this.dom) } catch {}
    if (this.editBtn) {
      try { this.editBtn.remove() } catch {}
      this.editBtn = null
    }
  }
}

// 创建 math inline 插件
export const mathInlineViewPlugin = $view(mathInlineSchema.node, () => {
  return (node, view, getPos) => {
    return new MathInlineNodeView(node, view, getPos as () => number | undefined)
  }
})

// 创建 math block 插件
export const mathBlockViewPlugin = $view(mathBlockSchema.node, () => {
  return (node, view, getPos) => {
    return new MathBlockNodeView(node, view, getPos as () => number | undefined)
  }
})
