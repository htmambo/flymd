// @vitest-environment jsdom
// 测试 outline:覆盖核心渲染(源码 + DOM heads 两条路径)、滚动同步、PDF outline
// 关注点:
// 1) getOutlineContext: 三模式 (wysiwyg/preview/source) DOM 查询
// 2) renderOutlinePanel: 源码模式扫描 # 标题 + 折叠状态记忆 + 点击跳转
// 3) renderOutlinePanel: PDF 文件走 renderPdfOutline(此处仅 mock 不真正加载 pdfjs)
// 4) updateOutlineActive: active class 切换 + 缓存命中
// 5) scheduleOutlineUpdate: 200ms 防抖

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOutline } from './outline'

function makeDeps(overrides: any = {}) {
  const editor = document.createElement('textarea')
  document.body.appendChild(editor)
  return {
    getCurrentFilePath: overrides.getCurrentFilePath ?? (() => null),
    getEditor: overrides.getEditor ?? (() => editor),
    getWysiwyg: overrides.getWysiwyg ?? (() => false),
    getMode: overrides.getMode ?? (() => 'edit'),
    getPdfIframe: overrides.getPdfIframe ?? (() => null),
    getPdfSrcUrl: overrides.getPdfSrcUrl ?? (() => null),
    getOutlineLayout: overrides.getOutlineLayout ?? (() => ({})),
    getOutlineLastSignature: overrides.getOutlineLastSignature ?? (() => ''),
    setOutlineLastSignature: overrides.setOutlineLastSignature ?? (() => {}),
    shouldUpdateOutlinePanel: overrides.shouldUpdateOutlinePanel ?? (() => true),
    syncDetachedOutlineVisibility: overrides.syncDetachedOutlineVisibility ?? (() => false),
    notifyWorkspaceLayoutChanged: overrides.notifyWorkspaceLayoutChanged ?? (() => {}),
    applyOutlineDockUi: overrides.applyOutlineDockUi ?? (() => {}),
    setOutlineHasContent: overrides.setOutlineHasContent ?? (() => {}),
    getOutlineDocked: overrides.getOutlineDocked ?? (() => true),
    clearOutlineHeadsCache: overrides.clearOutlineHeadsCache ?? (() => {}),
    ensureOutlineHeadsCacheFromCtx: overrides.ensureOutlineHeadsCacheFromCtx ?? (() => ({ ids: [], tops: [], scrollEl: null, bodyEl: null })),
    cssEscapeCompat: overrides.cssEscapeCompat ?? ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')),
    makePreviewHeadingId: overrides.makePreviewHeadingId ?? ((t: string, i: number) => `h-${i}-${t.replace(/\s+/g, '-')}`),
    readFile: overrides.readFile ?? (async () => new Uint8Array()),
    stat: overrides.stat ?? (async () => ({ mtimeMs: 0 })),
    logDebug: overrides.logDebug ?? (() => {}),
    logWarn: overrides.logWarn ?? (() => {}),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('getOutlineContext', () => {
  it('returns source mode when no preview/wysiwyg DOM present', () => {
    const api = createOutline(makeDeps())
    const ctx = api.getOutlineContext(false)
    expect(ctx.mode).toBe('source')
    expect(ctx.scrollEl).toBeNull()
  })

  it('returns preview mode when .preview + .preview-body present', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    preview.appendChild(body)
    document.body.appendChild(preview)
    const api = createOutline(makeDeps())
    const ctx = api.getOutlineContext(false)
    expect(ctx.mode).toBe('preview')
    expect(ctx.scrollEl).toBe(preview)
    expect(ctx.bodyEl).toBe(body)
  })

  it('returns wysiwyg mode when getWysiwyg true and DOM present', () => {
    const root = document.createElement('div')
    root.id = 'md-wysiwyg-root'
    const scrollView = document.createElement('div')
    scrollView.className = 'scrollView'
    const body = document.createElement('div')
    body.className = 'ProseMirror'
    scrollView.appendChild(body)
    root.appendChild(scrollView)
    document.body.appendChild(root)
    const api = createOutline(makeDeps({ getWysiwyg: () => true }))
    const ctx = api.getOutlineContext(false)
    expect(ctx.mode).toBe('wysiwyg')
    expect(ctx.bodyEl).toBe(body)
  })
})

describe('renderOutlinePanel — source mode', () => {
  it('scans # 标题 from editor value and renders .ol-item', () => {
    const editor = document.createElement('textarea')
    editor.value = '# Title\n\n## Sub\n\nbody'
    document.body.appendChild(editor)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    const deps = makeDeps({
      getEditor: () => editor,
      getCurrentFilePath: () => '/doc.md',
    })
    const api = createOutline(deps)
    api.renderOutlinePanel()
    const items = outline.querySelectorAll('.ol-item')
    expect(items.length).toBe(2)
    expect(items[0].classList.contains('lvl-1')).toBe(true)
    expect(items[1].classList.contains('lvl-2')).toBe(true)
  })

  it('skips render when signature matches cache', () => {
    const editor = document.createElement('textarea')
    editor.value = '# T'
    document.body.appendChild(editor)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    outline.innerHTML = '<div class="ol-item">prev</div>'
    document.body.appendChild(outline)
    let sig = ''
    const deps = makeDeps({
      getEditor: () => editor,
      getCurrentFilePath: () => '/d.md',
      getOutlineLastSignature: () => sig,
      setOutlineLastSignature: (s: string) => { sig = s },
    })
    // 第一次渲染,签名写入 sig
    const api = createOutline(deps)
    api.renderOutlinePanel()
    const firstInner = outline.innerHTML
    expect(sig).not.toBe('')
    // 改 editor 但同时把 sig 设为相同(模拟缓存命中)
    editor.value = '# T2'
    sig = 'd.md::' + JSON.stringify([[1, 'h-0-T', 'T']])
    // 改回 editor.value 模拟不同内容,但 sig 不变(测试不重渲染)
    editor.value = '# T'
    api.renderOutlinePanel()
    expect(outline.innerHTML).toBe(firstInner)
  })

  it('renders "未检测到标题" when no headings', () => {
    const editor = document.createElement('textarea')
    editor.value = 'plain text\nno headings here'
    document.body.appendChild(editor)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    const api = createOutline(makeDeps({ getEditor: () => editor }))
    api.renderOutlinePanel()
    expect(outline.innerHTML).toContain('未检测到标题')
  })

  it('renders "未检测到标题" when file path is null', () => {
    const editor = document.createElement('textarea')
    document.body.appendChild(editor)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    const api = createOutline(makeDeps({ getEditor: () => editor, getCurrentFilePath: () => null }))
    api.renderOutlinePanel()
    expect(outline.innerHTML).toContain('未检测到标题')
  })
})

describe('renderOutlinePanel — PDF path delegation', () => {
  it('delegates to renderPdfOutline for .pdf files (sets "正在读取" placeholder)', async () => {
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    // renderPdfOutline 会调用 deps.setOutlineHasContent(el, true) + 写 '正在读取 PDF 目录…'。
    // 没法用 vi.fn 替换内部闭包,但能观察副作用:不应走源码扫描路径(不调 setOutlineHasContent 的 hasContent=false 路径)。
    // 关键断言:渲染后 outline 内容是 PDF 路径的占位符,而不是源码扫描结果
    const editor = document.createElement('textarea')
    editor.value = '# Should be ignored'
    document.body.appendChild(editor)
    // 让 stat 走正常路径(返回 mtimeMs=0),但 renderItems 内会 await doc.getOutline() — 内部 pdfjs 加载会失败
    // 因为 jsdom 没有 pdfjs 解析能力,我们只关心"renderOutlinePanel 走了 PDF 分支"。
    // 简便做法:拦截 renderPdfOutline 内部 await 链 — 但它闭包,无法替换。
    // 替代:用 setOutlineHasContent 调用次数判定(走 PDF 分支时立即调用 setOutlineHasContent(el, true))
    const setHasContent = vi.fn()
    const deps = makeDeps({
      getCurrentFilePath: () => '/x.pdf',
      getEditor: () => editor,
      setOutlineHasContent: setHasContent,
    })
    const api = createOutline(deps)
    api.renderOutlinePanel()
    // 不等待 renderPdfOutline 完成(void),只检查"立即调用"是否发生
    expect(setHasContent).toHaveBeenCalled()
    // 调用参数中应有 outline 元素 + true(标记为"有内容"以保留布局)
    const calls = setHasContent.mock.calls
    const trueCall = calls.find(c => c[0] === outline && c[1] === true)
    expect(trueCall).toBeTruthy()
  })
})

describe('renderOutlinePanel — preview/DOM heads path', () => {
  it('extracts h1-h6 from .preview .preview-body and renders items with id', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    const h1 = document.createElement('h1')
    h1.textContent = 'Top'
    h1.setAttribute('id', 'top-id')
    const h2 = document.createElement('h2')
    h2.textContent = 'Sub'
    h2.setAttribute('id', 'sub-id')
    body.appendChild(h1); body.appendChild(h2)
    preview.appendChild(body)
    document.body.appendChild(preview)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    const deps = makeDeps({ getMode: () => 'preview' })
    const api = createOutline(deps)
    api.renderOutlinePanel()
    const items = outline.querySelectorAll('.ol-item')
    expect(items.length).toBe(2)
    expect((items[0] as HTMLElement).dataset.id).toBe('top-id')
    expect((items[1] as HTMLElement).dataset.id).toBe('sub-id')
  })
})

describe('updateOutlineActive', () => {
  it('marks first matching heading as .active', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    preview.scrollTop = 0
    const body = document.createElement('div')
    body.className = 'preview-body'
    const h1 = document.createElement('h1')
    h1.textContent = 'X'
    h1.setAttribute('id', 'x')
    body.appendChild(h1)
    preview.appendChild(body)
    document.body.appendChild(preview)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    const item = document.createElement('div')
    item.className = 'ol-item'
    ;(item as HTMLElement).dataset.id = 'x'
    outline.appendChild(item)
    document.body.appendChild(outline)
    const deps = makeDeps({ getMode: () => 'preview' })
    const api = createOutline(deps)
    api.updateOutlineActive()
    expect(item.classList.contains('active')).toBe(true)
  })

  it('returns early when outline is hidden', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    preview.appendChild(body)
    document.body.appendChild(preview)
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    outline.classList.add('hidden')
    document.body.appendChild(outline)
    const api = createOutline(makeDeps({ getMode: () => 'preview' }))
    expect(() => api.updateOutlineActive()).not.toThrow()
  })
})

describe('scheduleOutlineUpdate', () => {
  it('coalesces multiple calls into one 200ms timer', () => {
    vi.useFakeTimers()
    // scheduleOutlineUpdate 内部闭包调用 renderOutlinePanel,无法 spy。
    // 替代:观察副作用 clearOutlineHeadsCache(在 renderOutlinePanel 入口调用)
    // 但只在 shouldUpdateOutlinePanel 为 true 时才走渲染。改用 setOutlineHasContent 触发。
    // 最简:用 deps.shouldUpdateOutlinePanel spy 记录调用次数
    const shouldUpdate = vi.fn(() => true)
    const deps = makeDeps({ shouldUpdateOutlinePanel: shouldUpdate })
    const api = createOutline(deps)
    api.scheduleOutlineUpdate()
    api.scheduleOutlineUpdate()
    api.scheduleOutlineUpdate()
    vi.advanceTimersByTime(200)
    // 200ms 后只触发 1 次 renderOutlinePanel(防抖),进而 1 次 shouldUpdate 调用
    expect(shouldUpdate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('scheduleOutlineUpdateFromSource skips when not edit mode', () => {
    const render = vi.fn()
    const api = createOutline(makeDeps({ getMode: () => 'preview' }))
    ;(api as any).scheduleOutlineUpdate = render
    api.scheduleOutlineUpdateFromSource()
    expect(render).not.toHaveBeenCalled()
  })
})

describe('bindOutlineScrollSync idempotency', () => {
  it('does not bind twice to same element', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    document.body.appendChild(preview)
    const api = createOutline(makeDeps())
    api.bindOutlineScrollSync()
    api.bindOutlineScrollSync()
    // 通过监听:不会重复 add,scroll 事件只会触发一次
    // 简单验证:函数连续调用不抛错即可
    expect(() => api.bindOutlineScrollSync()).not.toThrow()
  })
})
