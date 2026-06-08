// 大纲面板子系统(Markdown / WYSIWYG / PDF 三路径统一入口)
// 抽离自 main.ts:4462-5005(原 outline 滚动同步 + 渲染 + PDF 渲染)。
// 抽离理由:7 个非 PDF 函数 + 2 个 PDF 函数 + 大量共享 main-local 闭包
// 引用构成完整"大纲"子系统;模块级缓存(_outlineActiveId / _outlineActiveEl /
// _outlineScrollBound* / _outlineRaf / _outlineLastSignature / _pdfOutlineCache)
// 闭包到工厂内;_currentPdfIframe / _currentPdfSrcUrl 因 main.ts 多处写入,
// 走 getter 注入;_outlineLastSignature 同样需暴露 setter 供 main.ts 在
// 模式切换/文件切换时强制 invalidate。
//
// 显式依赖:outlineLayout / shouldUpdateOutlinePanel / syncDetachedOutlineVisibility /
// notifyWorkspaceLayoutChanged / applyOutlineDockUi / setOutlineHasContent /
// getOutlineDocked / clearOutlineHeadsCache / ensureOutlineHeadsCacheFromCtx /
// cssEscapeCompat / makePreviewHeadingId 全部用 deps 注入。

export interface OutlineDeps {
  /** 当前文件路径(可能 null) */
  getCurrentFilePath: () => string | null
  /** 编辑器 textarea(源码模式标题扫描用) */
  getEditor: () => HTMLTextAreaElement
  /** WYSIWYG 模式标志 */
  getWysiwyg: () => boolean
  /** 主模式: 'edit' | 'preview' */
  getMode: () => 'edit' | 'preview'
  /** 当前 PDF iframe(供 PDF outline 跳转) */
  getPdfIframe: () => HTMLIFrameElement | null
  /** 当前 PDF src URL(供 PDF outline 跳转) */
  getPdfSrcUrl: () => string | null
  /** 大纲布局状态(layout 状态从外部传入) */
  getOutlineLayout: () => any
  /** outline 缓存签名 — 暴露 setter 给 main.ts 在模式切换/打开新文件时强制 invalidate */
  getOutlineLastSignature: () => string
  setOutlineLastSignature: (s: string) => void
  /** 工具:判断大纲面板是否应该更新 */
  shouldUpdateOutlinePanel: (layout: any, el: HTMLElement | null) => boolean
  /** 工具:同步剥离布局下的大纲可见性 */
  syncDetachedOutlineVisibility: (layout: any, container: HTMLElement | null, outline: HTMLElement | null, docked: boolean) => boolean
  /** 通知工作区布局变更 */
  notifyWorkspaceLayoutChanged: () => void
  /** 应用大纲 dock UI 状态 */
  applyOutlineDockUi: () => void
  /** 标记 outline 容器是否有内容(影响布局) */
  setOutlineHasContent: (el: HTMLElement, has: boolean) => void
  /** 当前 outline 是否 dock 到侧栏 */
  getOutlineDocked: () => boolean
  /** 清理 outline 标题缓存 */
  clearOutlineHeadsCache: () => void
  /** 从 ctx 重建 outline 标题缓存(滚动同步用) */
  ensureOutlineHeadsCacheFromCtx: (ctx: { mode: 'wysiwyg'|'preview'|'source'; scrollEl: HTMLElement; bodyEl: HTMLElement; heads: HTMLElement[] }) => any
  /** CSS 选择器转义 */
  cssEscapeCompat: (s: string) => string
  /** 构造大纲 heading id(源码模式用) */
  makePreviewHeadingId: (text: string, index: number) => string
  /** 读取 PDF 文件字节(Tauri fs.readFile) */
  readFile: (path: string) => Promise<Uint8Array>
  /** stat 文件(取 mtime 判失效) */
  stat: (path: string) => Promise<{ mtimeMs?: number; mtime?: Date | null; modifiedAt?: number | Date | null }>
  /** debug 日志 */
  logDebug: (...args: any[]) => void
  /** warn 日志 */
  logWarn: (...args: any[]) => void
}

export interface OutlineApi {
  renderOutlinePanel: () => void
  getOutlineContext: (needHeads?: boolean) => { mode: 'wysiwyg'|'preview'|'source'; scrollEl: HTMLElement | null; bodyEl: HTMLElement | null; heads: HTMLElement[] }
  bindOutlineScrollSync: () => void
  onOutlineScroll: () => void
  updateOutlineActive: () => void
  renderPdfOutline: (outlineEl: HTMLDivElement) => Promise<void>
  bindPdfOutlineClicks: (outlineEl: HTMLDivElement) => void
  scheduleOutlineUpdate: () => void
  scheduleOutlineUpdateFromSource: () => void
  ensureOutlineObserverBound: () => void
}

export function createOutline(deps: OutlineDeps): OutlineApi {
  // 闭包到工厂的模块级缓存
  let _outlineScrollBound = false
  let _outlineScrollBoundPreview = false
  let _outlineScrollBoundWysiwyg = false
  let _outlineActiveId = ''
  let _outlineActiveEl: HTMLElement | null = null
  let _outlineRaf = 0
  const _pdfOutlineCache = new Map<string, { mtime: number; items: Array<{ level: number; title: string; page: number }> }>()
  let _outlineObserverBound = false
  let _outlineObserver: MutationObserver | null = null
  let _outlineUpdateTimer = 0

  // ==================== 非 PDF 路径 ====================

  function getOutlineContext(needHeads = true): { mode: 'wysiwyg'|'preview'|'source'; scrollEl: HTMLElement | null; bodyEl: HTMLElement | null; heads: HTMLElement[] } {
    try {
      if (deps.getWysiwyg()) {
        const rootEl = document.getElementById('md-wysiwyg-root') as HTMLElement | null
        if (rootEl) {
          const scrollEl = (document.querySelector('#md-wysiwyg-root .scrollView') as HTMLElement | null) || rootEl
          const bodyEl = document.querySelector('#md-wysiwyg-root .ProseMirror') as HTMLElement | null
          const heads = (needHeads && bodyEl) ? (Array.from(bodyEl.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]) : []
          if (scrollEl && bodyEl) return { mode: 'wysiwyg', scrollEl, bodyEl, heads }
        }
      }
    } catch {}
    try {
      const scrollEl = document.querySelector('.preview') as HTMLElement | null
      const bodyEl = document.querySelector('.preview .preview-body') as HTMLElement | null
      const heads = (needHeads && bodyEl) ? (Array.from(bodyEl.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]) : []
      if (scrollEl && bodyEl) return { mode: 'preview', scrollEl, bodyEl, heads }
    } catch {}
    return { mode: 'source', scrollEl: null, bodyEl: null, heads: [] }
  }

  function bindOutlineScrollSync() {
    const prev = document.querySelector('.preview') as HTMLElement | null
    if (prev && !_outlineScrollBoundPreview) { prev.addEventListener('scroll', onOutlineScroll, { passive: true }); _outlineScrollBoundPreview = true }
    const wysi = document.getElementById('md-wysiwyg-root') as HTMLElement | null
    const wysiScroll = (document.querySelector('#md-wysiwyg-root .scrollView') as HTMLElement | null) || wysi
    if (wysiScroll && !_outlineScrollBoundWysiwyg) { wysiScroll.addEventListener('scroll', onOutlineScroll, { passive: true }); _outlineScrollBoundWysiwyg = true }
    _outlineScrollBound = _outlineScrollBoundPreview || _outlineScrollBoundWysiwyg
  }

  function onOutlineScroll() {
    // 滚动事件可能非常密集:同一帧里只调度一次,别反复 cancel/re-request
    if (_outlineRaf) return
    _outlineRaf = requestAnimationFrame(() => {
      _outlineRaf = 0
      try { updateOutlineActive() } catch {}
    })
  }

  function updateOutlineActive() {
    try {
      const { scrollEl: pv, bodyEl: body } = getOutlineContext(false)
      const outline = document.getElementById('lib-outline') as HTMLDivElement | null
      if (!pv || !body || !outline || outline.classList.contains('hidden')) return
      const cache = deps.ensureOutlineHeadsCacheFromCtx({ mode: (deps.getWysiwyg() ? 'wysiwyg' : (deps.getMode() === 'preview' ? 'preview' : 'source')), scrollEl: pv, bodyEl: body, heads: [] })
      let id = ''
      try {
        if (cache && cache.scrollEl === pv && cache.bodyEl === body && cache.ids.length > 0) {
          const y = (pv.scrollTop || 0) + 60
          let lo = 0, hi = cache.tops.length - 1, best = 0
          while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (cache.tops[mid] <= y) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
          }
          id = cache.ids[Math.max(0, Math.min(cache.ids.length - 1, best))] || ''
        } else {
          const hs = body.querySelectorAll('h1,h2,h3,h4,h5,h6')
          let active: HTMLElement | null = null
          for (let i = 0; i < hs.length; i++) {
            const h = hs[i] as HTMLElement
            if ((h.getBoundingClientRect().top - pv.getBoundingClientRect().top) <= 60) active = h
            else break
          }
          if (!active && hs.length > 0) active = hs[0] as HTMLElement
          id = (active?.getAttribute('id') || '').trim()
        }
        if (!id || id === _outlineActiveId) return
        _outlineActiveId = id
        try { _outlineActiveEl?.classList.remove('active') } catch {}
        const nextEl = outline.querySelector(`.ol-item[data-id="${deps.cssEscapeCompat(id)}"]`) as HTMLElement | null
        if (nextEl) {
          try { nextEl.classList.add('active') } catch {}
          _outlineActiveEl = nextEl
        } else {
          _outlineActiveEl = null
        }
      } catch {}
    } catch {}
  }

  function renderOutlinePanel() {
    try {
      const outline = document.getElementById('lib-outline') as HTMLDivElement | null
      if (!outline) return
      // 大纲 DOM 可能被整体重建:清理状态,避免持有旧节点引用
      try { _outlineActiveEl = null } catch {}
      try { _outlineActiveId = '' } catch {}
      deps.clearOutlineHeadsCache()
      const container = document.querySelector('.container') as HTMLDivElement | null
      const layout = deps.getOutlineLayout()
      // PDF:优先读取书签目录
      try { if ((deps.getCurrentFilePath() || '').toLowerCase().endsWith('.pdf')) { void renderPdfOutline(outline); return } } catch {}
      const ctx = getOutlineContext(true)
      const heads = ctx.heads
      const items: { level: number; id: string; text: string; offset?: number }[] = []
      const useDomHeads = (deps.getWysiwyg() || deps.getMode() === 'preview') && heads.length > 0
      if (useDomHeads) {
        heads.forEach((h, idx) => {
          const tag = (h.tagName || 'H1').toUpperCase()
          const level = Math.min(6, Math.max(1, Number(tag.replace('H','')) || 1))
          let id = h.getAttribute('id') || ''
          const text = (h.textContent || '').trim() || ('标题 ' + (idx+1))
          if (!id) { id = deps.makePreviewHeadingId(text, idx); try { h.setAttribute('id', id) } catch {} }
          items.push({ level, id, text })
        })
      } else {
        // 退化:从源码扫描 # 标题行
        const sourceSnapshot = (() => {
          try { return (window as any).flymdGetSourceEditorLinesSnapshot?.() || null } catch { return null }
        })()
        const lines = Array.isArray(sourceSnapshot?.lines)
          ? (sourceSnapshot.lines as string[])
          : String(deps.getEditor().value || '').split(/\n/)
        const lineStarts = Array.isArray(sourceSnapshot?.lineStarts)
          ? (sourceSnapshot.lineStarts as number[])
          : null
        let offset = 0
        lines.forEach((ln, i) => {
          const m = ln.match(/^(#{1,6})\s+(.+?)\s*$/)
          if (m) {
            const level = m[1].length
            const text = m[2].trim()
            const id = deps.makePreviewHeadingId(text, i)
            const itemOffset = lineStarts ? lineStarts[i] : offset
            items.push({ level, id, text, offset: itemOffset })
          }
          offset += ln.length + 1
        })
      }

      deps.setOutlineHasContent(outline, items.length > 0)
      const layoutChanged = deps.syncDetachedOutlineVisibility(layout, container, outline, deps.getOutlineDocked())
      if (layoutChanged) deps.notifyWorkspaceLayoutChanged()
      try { deps.applyOutlineDockUi() } catch {}

      // 缓存命中:若本次大纲签名与上次相同,跳过重建,仅更新高亮
      try {
        const filePath = deps.getCurrentFilePath() || 'untitled'
        const key = String(filePath)
        const sig = key + '::' + JSON.stringify(items.map(it => [it.level, it.id, it.text]))
        if (sig === deps.getOutlineLastSignature() && outline.childElementCount > 0) {
          updateOutlineActive()
          return
        }
        deps.setOutlineLastSignature(sig)
      } catch {}

      if (items.length === 0) { outline.innerHTML = '<div class="empty">未检测到标题</div>'; return }

      // 计算是否有子级(用于折叠/展开,限制到 H1/H2)
      const hasChild = new Map<string, boolean>()
      for (let i = 0; i < items.length; i++) {
        const cur = items[i]
        if (cur.level > 2) continue
        let child = false
        for (let j = i + 1; j < items.length; j++) { if (items[j].level > cur.level) { child = true; break } if (items[j].level <= cur.level) break }
        hasChild.set(cur.id, child)
      }

      outline.innerHTML = items.map((it, idx) => {
        const tg = (it.level <= 2 && hasChild.get(it.id)) ? `<span class="ol-tg" data-idx="${idx}">▾</span>` : `<span class="ol-tg"></span>`
        const off = (typeof it.offset === 'number' && it.offset >= 0) ? ` data-offset="${it.offset}"` : ''
        return `<div class="ol-item lvl-${it.level}" data-id="${it.id}" data-idx="${idx}"${off}>${tg}${it.text}</div>`
      }).join('')

      // 折叠状态记忆(基于当前文件路径)
      const filePath = deps.getCurrentFilePath() || 'untitled'
      const key = 'outline-collapsed:' + filePath
      const _raw = (() => { try { return localStorage.getItem(key) } catch { return null } })()
      const collapsed = new Set<string>(_raw ? (() => { try { return JSON.parse(_raw!) } catch { return [] } })() : [])
      const saveCollapsed = () => { try { localStorage.setItem(key, JSON.stringify(Array.from(collapsed))) } catch {} }

      // 应用折叠:根据被折叠的 id 隐藏其后代
      const applyCollapse = () => {
        try {
          const nodes = Array.from(outline!.querySelectorAll('.ol-item')) as HTMLDivElement[]
          nodes.forEach(n => n.classList.remove('hidden'))
          nodes.forEach((n) => {
            const id = n.dataset.id || ''
            if (!id || !collapsed.has(id)) return
            const m1 = n.className.match(/lvl-(\d)/); const level = parseInt((m1?.[1]||'1'),10)
            for (let i = (parseInt(n.dataset.idx||'-1',10) + 1); i < nodes.length; i++) {
              const m = nodes[i]
              const m2 = m.className.match(/lvl-(\d)/); const lv = parseInt((m2?.[1]||'6'),10)
              if (lv <= level) break
              m.classList.add('hidden')
            }
          })
        } catch {}
      }

      // 折叠/展开切换
      outline.querySelectorAll('.ol-tg').forEach((tgEl) => {
        tgEl.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const el = (tgEl as HTMLElement).closest('.ol-item') as HTMLDivElement | null
          if (!el) return
          const id = el.dataset.id || ''
          const m1 = el.className.match(/lvl-(\d)/); const level = parseInt((m1?.[1]||'1'),10)
          if (!id || level > 2) return
          if (collapsed.has(id)) { collapsed.delete(id); (tgEl as HTMLElement).textContent = '▾' } else { collapsed.add(id); (tgEl as HTMLElement).textContent = '▸' }
          saveCollapsed(); applyCollapse()
        })
      })

      // 点击跳转
      outline.querySelectorAll('.ol-item').forEach((el) => {
        el.addEventListener('click', () => {
          const div = el as HTMLDivElement
          const id = div.dataset.id || ''
          const offsetStr = div.dataset.offset

          if (deps.getWysiwyg() || deps.getMode() === 'preview') {
            if (!id) return
            try {
              const target = document.getElementById(id)
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
            } catch {}
            return
          }

          if (typeof offsetStr === 'string' && offsetStr !== '') {
            const off = Number(offsetStr)
            if (!Number.isFinite(off) || off < 0) return
            try {
              const ta = deps.getEditor()
              const text = String(ta.value || '')
              const len = text.length >>> 0
              const caret = Math.max(0, Math.min(off, len))
              ta.selectionStart = caret
              ta.selectionEnd = caret
              try { ta.focus() } catch {}
              if (len > 0 && ta.scrollHeight > ta.clientHeight + 4) {
                const linesBefore = text.slice(0, caret).split('\n').length
                const totalLines = text.split('\n').length
                const lineRatio = (linesBefore - 1) / Math.max(1, totalLines - 1)
                const targetY = lineRatio * ta.scrollHeight
                ta.scrollTop = Math.max(0, targetY - ta.clientHeight * 0.3)
              }
            } catch {}
          }
        })
      })

      applyCollapse()
      setTimeout(() => { try { updateOutlineActive(); bindOutlineScrollSync(); ensureOutlineObserverBound() } catch {} }, 0)
    } catch {}
  }

  function scheduleOutlineUpdate() {
    if (_outlineUpdateTimer) { clearTimeout(_outlineUpdateTimer); _outlineUpdateTimer = 0 }
    _outlineUpdateTimer = window.setTimeout(() => {
      _outlineUpdateTimer = 0
      try {
        const outline = document.getElementById('lib-outline') as HTMLDivElement | null
        if (deps.shouldUpdateOutlinePanel(deps.getOutlineLayout(), outline)) renderOutlinePanel()
      } catch {}
    }, 200)
  }

  function scheduleOutlineUpdateFromSource() {
    if (deps.getWysiwyg() || deps.getMode() !== 'edit') return
    scheduleOutlineUpdate()
  }

  function ensureOutlineObserverBound() {
    if (_outlineObserverBound) return
    try {
      const bodyEl = document.querySelector('#md-wysiwyg-root .ProseMirror') as HTMLElement | null
      if (!bodyEl) return
      _outlineObserver = new MutationObserver(() => { scheduleOutlineUpdate() })
      _outlineObserver.observe(bodyEl, { childList: true, subtree: true, characterData: true })
      _outlineObserverBound = true
    } catch {}
  }

  // ==================== PDF 路径 ====================

  async function renderPdfOutline(outlineEl: HTMLDivElement): Promise<void> {
    try {
      outlineEl.innerHTML = '<div class="empty">正在读取 PDF 目录…</div>'
      deps.setOutlineHasContent(outlineEl, true)
      const container = document.querySelector('.container') as HTMLDivElement | null
      const layout = deps.getOutlineLayout()
      if (deps.syncDetachedOutlineVisibility(layout, container, outlineEl, deps.getOutlineDocked())) deps.notifyWorkspaceLayoutChanged()
      const filePath = String(deps.getCurrentFilePath() || '')
      if (!filePath) {
        deps.setOutlineHasContent(outlineEl, false)
        if (deps.syncDetachedOutlineVisibility(layout, container, outlineEl, deps.getOutlineDocked())) deps.notifyWorkspaceLayoutChanged()
        outlineEl.innerHTML = '<div class="empty">未打开 PDF</div>'
        return
      }

      const cacheKey = filePath.replace(/\\/g, '/')
      let curMtime = 0
      try {
        const st: any = await deps.stat(filePath)
        const cand = st?.mtimeMs ?? (st?.mtime instanceof Date ? st.mtime.getTime() : st?.mtime) ?? (st?.modifiedAt instanceof Date ? st.modifiedAt.getTime() : st?.modifiedAt)
        curMtime = Number(cand) || 0
      } catch {}

      const escHtml = (s: string) => String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[ch] || ch)

      const renderItems = (items: Array<{ level: number; title: string; page: number }>, fromCache: boolean) => {
        const hasContent = !!(items && items.length > 0)
        deps.setOutlineHasContent(outlineEl, hasContent)
        if (deps.syncDetachedOutlineVisibility(layout, container, outlineEl, deps.getOutlineDocked())) deps.notifyWorkspaceLayoutChanged()
        try { deps.applyOutlineDockUi() } catch {}
        if (!hasContent) { outlineEl.innerHTML = '<div class="empty">目录为空</div>'; return }

        const hasChild = new Map<string, boolean>()
        for (let i = 0; i < items.length; i++) {
          const cur = items[i]
          if (cur.level > 2) continue
          let child = false
          for (let j = i + 1; j < items.length; j++) {
            if (items[j].level > cur.level) { child = true; break }
            if (items[j].level <= cur.level) break
          }
          hasChild.set(String(i), child)
        }

        const keyCollapse = 'outline-collapsed:' + filePath
        let collapsed = new Set<string>()
        try { const raw = localStorage.getItem(keyCollapse); if (raw) collapsed = new Set(JSON.parse(raw)) } catch {}
        const saveCollapsed = () => { try { localStorage.setItem(keyCollapse, JSON.stringify(Array.from(collapsed))) } catch {} }

        outlineEl.innerHTML = items.map((it, idx) => {
          const k = String(idx)
          const canToggle = it.level <= 2 && !!hasChild.get(k)
          const isCollapsed = collapsed.has(k)
          const tg = canToggle ? `<span class="ol-tg" data-idx="${idx}">${isCollapsed ? '▸' : '▾'}</span>` : `<span class="ol-tg"></span>`
          return `<div class="ol-item lvl-${it.level}" data-page="${it.page}" data-idx="${idx}">${tg}${escHtml(it.title)}</div>`
        }).join('')

        const applyCollapse = () => {
          try {
            const nodes = Array.from(outlineEl.querySelectorAll('.ol-item')) as HTMLDivElement[]
            nodes.forEach(n => n.classList.remove('hidden'))
            nodes.forEach((n) => {
              const idx = n.dataset.idx
              if (idx == null || idx === '' || !collapsed.has(idx)) return
              const m1 = n.className.match(/lvl-(\d)/)
              const level = parseInt((m1?.[1] || '1'), 10)
              const start = parseInt(idx, 10)
              if (!Number.isFinite(start) || start < 0) return
              for (let i = start + 1; i < nodes.length; i++) {
                const m = nodes[i]
                const m2 = m.className.match(/lvl-(\d)/)
                const lv = parseInt((m2?.[1] || '6'), 10)
                if (lv <= level) break
                m.classList.add('hidden')
              }
            })
          } catch {}
        }

        const existingToggleHandler = (outlineEl as any)._pdfToggleHandler
        if (existingToggleHandler) outlineEl.removeEventListener('click', existingToggleHandler)
        const toggleHandler = (ev: Event) => {
          const tgEl = (ev.target as HTMLElement)
          if (!tgEl.classList.contains('ol-tg')) return
          ev.stopPropagation()
          const el = tgEl.closest('.ol-item') as HTMLDivElement | null
          if (!el) return
          const idx = el.dataset.idx
          const m1 = el.className.match(/lvl-(\d)/)
          const level = parseInt((m1?.[1] || '1'), 10)
          if (idx == null || idx === '' || level > 2) return
          if (collapsed.has(idx)) { collapsed.delete(idx); tgEl.textContent = '▾' } else { collapsed.add(idx); tgEl.textContent = '▸' }
          saveCollapsed(); applyCollapse()
        }
        ;(outlineEl as any)._pdfToggleHandler = toggleHandler
        outlineEl.addEventListener('click', toggleHandler)

        bindPdfOutlineClicks(outlineEl)
        applyCollapse()
        deps.logDebug('PDF 目录:渲染完成', { fromCache, count: items.length })
      }

      // 先走缓存:只做一次 stat,不读 PDF 字节,不加载 PDF.js
      try {
        const cached = cacheKey ? _pdfOutlineCache.get(cacheKey) : null
        if (cached && cached.items && cached.items.length > 0 && cached.mtime === curMtime) {
          renderItems(cached.items, true)
          return
        }
      } catch {}

      deps.logDebug('PDF 目录:开始解析(未命中缓存)', { path: filePath })

      // 动态加载 pdfjs-dist
      let pdfjsMod: any = null
      try {
        pdfjsMod = await import('pdfjs-dist')
        deps.logDebug('PDF 目录:模块已加载', Object.keys(pdfjsMod || {}))
      } catch (e) {
        outlineEl.innerHTML = '<div class="empty">未安装 pdfjs-dist,无法读取目录</div>'
        deps.logWarn('PDF 目录:加载 pdfjs-dist 失败', e)
        return
      }
      const pdfjs: any = (pdfjsMod && (pdfjsMod as any).getDocument)
        ? pdfjsMod
        : ((pdfjsMod && (pdfjsMod as any).default) ? (pdfjsMod as any).default : pdfjsMod)

      let disableWorker = true
      try {
        const workerMod: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
        const WorkerCtor: any = workerMod?.default || workerMod
        const worker: Worker = new WorkerCtor()
        if ((pdfjs as any).GlobalWorkerOptions) {
          ;(pdfjs as any).GlobalWorkerOptions.workerPort = worker
          disableWorker = false
          deps.logDebug('PDF 目录:workerPort 已设置')
        }
      } catch (e) {
        deps.logWarn('PDF 目录:workerPort 设置失败(将禁用 worker)', e)
        try { if ((pdfjs as any).GlobalWorkerOptions) (pdfjs as any).GlobalWorkerOptions.workerSrc = null } catch {}
      }

      let bytes: Uint8Array
      try {
        bytes = await deps.readFile(filePath)
        deps.logDebug('PDF 目录:读取字节成功', { bytes: bytes?.length })
      } catch (e) {
        outlineEl.innerHTML = '<div class="empty">无法读取 PDF 文件</div>'
        deps.logWarn('PDF 目录:读取文件失败', e)
        return
      }

      const getDocOpts: any = { data: bytes }
      if (disableWorker) getDocOpts.disableWorker = true
      const task = (pdfjs as any).getDocument ? (pdfjs as any).getDocument(getDocOpts) : null
      if (!task) { outlineEl.innerHTML = '<div class="empty">PDF.js 不可用</div>'; deps.logWarn('PDF 目录:getDocument 不可用'); return }

      const doc = (task as any).promise ? await (task as any).promise : await task
      try {
        deps.logDebug('PDF 目录:文档已打开', { numPages: doc?.numPages, disableWorker })
        const pdfOutline = await doc.getOutline()
        deps.logDebug('PDF 目录:outline 获取成功', { count: pdfOutline?.length })
        if (!pdfOutline || pdfOutline.length === 0) { outlineEl.innerHTML = '<div class="empty">此 PDF 未提供目录(书签)</div>'; return }

        const items: { level: number; title: string; page: number }[] = []
        const walk = async (nodes: any[], level: number) => {
          for (const n of nodes || []) {
            const title = String(n?.title || '').trim() || '无标题'
            let page = 1
            try {
              const destName = n?.dest
              let dest: any = destName
              if (typeof destName === 'string') dest = await doc.getDestination(destName)
              const ref = Array.isArray(dest) ? dest[0] : null
              if (ref) {
                const idx = await doc.getPageIndex(ref)
                page = (idx >>> 0) + 1
              } else {
                deps.logDebug('PDF 目录:无 ref,使用默认页', { title })
              }
            } catch (e) {
              deps.logWarn('PDF 目录:解析书签页码失败', { title, err: String(e) })
            }
            items.push({ level, title, page })
            if (Array.isArray(n?.items) && n.items.length > 0) await walk(n.items, Math.min(6, level + 1))
          }
        }
        await walk(pdfOutline, 1)
        if (items.length === 0) { outlineEl.innerHTML = '<div class="empty">目录为空</div>'; deps.logWarn('PDF 目录:目录为空'); return }

        try { if (cacheKey) _pdfOutlineCache.set(cacheKey, { mtime: curMtime, items: items.slice() }) } catch {}

        renderItems(items, false)
      } finally {
        try { await doc?.destroy?.() } catch {}
        try { await task?.destroy?.() } catch {}
      }
    } catch (e) {
      try { outlineEl.innerHTML = '<div class="empty">读取 PDF 目录失败</div>' } catch {}
      deps.logWarn('PDF 目录:异常', e)
    }
  }

  function bindPdfOutlineClicks(outlineEl: HTMLDivElement) {
    try {
      const existingHandler = (outlineEl as any)._pdfOutlineClickHandler
      if (existingHandler) { outlineEl.removeEventListener('click', existingHandler) }
      const handler = (e: Event) => {
        const clickedEl = e.target as HTMLElement
        if (clickedEl.classList.contains('ol-tg')) return
        const target = clickedEl.closest('.ol-item') as HTMLDivElement | null
        if (!target) return
        const p = Number(target.dataset.page || '1') || 1
        try {
          const iframe = deps.getPdfIframe()
          if (!iframe) { deps.logWarn('PDF 目录:未找到 iframe'); return }
          const cur = iframe.src || deps.getPdfSrcUrl() || ''
          if (!cur) { deps.logWarn('PDF 目录:无有效 iframe.src/base'); return }
          const baseNoHash = cur.split('#')[0]
          let didHash = false
          try {
            if (iframe.contentWindow) {
              iframe.contentWindow.location.hash = '#page=' + p
              didHash = true
              deps.logDebug('PDF 目录:hash 导航', { page: p })
            }
          } catch {}
          if (!didHash) {
            const next = baseNoHash + '#page=' + p
            try { if (iframe.src !== next) iframe.src = next; deps.logDebug('PDF 目录:src 导航', { page: p, next }) } catch {}
          }
        } catch (e) { deps.logWarn('PDF 目录:导航异常', e) }
      }
      ;(outlineEl as any)._pdfOutlineClickHandler = handler
      outlineEl.addEventListener('click', handler)
    } catch {}
  }

  return {
    renderOutlinePanel,
    getOutlineContext,
    bindOutlineScrollSync,
    onOutlineScroll,
    updateOutlineActive,
    renderPdfOutline,
    bindPdfOutlineClicks,
    scheduleOutlineUpdate,
    scheduleOutlineUpdateFromSource,
    ensureOutlineObserverBound,
  }
}
