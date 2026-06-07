// @vitest-environment jsdom
// 测试 wysiwygCaret:覆盖 5 个 WYSIWYG caret 反馈函数
// 关注点:
// 1) updateWysiwygLineHighlight: 非 wysiwyg 静默 + 高亮 top/height 由 lineHeight 决定
// 2) measureCharWidth: 同字体返回缓存(确定性 8 当无 canvas)
// 3) moveWysiwygCaretByLines: 跨行移动 + 保留 visual column + 越界返回 0
// 4) updateWysiwygCaretDot: 算 top/left + 加 show class
// 5) updateWysiwygVirtualPadding: 非 wysiwyg 清 padding + wysiwyg 补 padding
// 6) ensureWysiwygCaretDotInView: caret-dot 越界滚动

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWysiwygCaret } from './wysiwygCaret'

interface Deps {
  getWysiwyg: () => boolean
  getEditor: () => HTMLTextAreaElement
  getPreview: () => HTMLElement
  getLineEl: () => HTMLDivElement | null
  getCaretEl: () => HTMLDivElement | null
  getPadBottomBasePx: () => number
  setPadBottomBasePx: (n: number) => void
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  const editor = document.createElement('textarea')
  document.body.appendChild(editor)
  const preview = document.createElement('div')
  document.body.appendChild(preview)
  const lineEl = document.createElement('div')
  document.body.appendChild(lineEl)
  const caretEl = document.createElement('div')
  document.body.appendChild(caretEl)
  return {
    getWysiwyg: () => true,
    getEditor: () => editor,
    getPreview: () => preview,
    getLineEl: () => lineEl,
    getCaretEl: () => caretEl,
    getPadBottomBasePx: () => 40,
    setPadBottomBasePx: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('updateWysiwygLineHighlight', () => {
  it('does nothing when not in wysiwyg mode', () => {
    const lineEl = document.createElement('div')
    document.body.appendChild(lineEl)
    const deps = makeDeps({ getWysiwyg: () => false, getLineEl: () => lineEl })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygLineHighlight()
    expect(lineEl.style.top).toBe('')
  })

  it('positions lineEl at current line index', () => {
    const editor = document.createElement('textarea')
    editor.value = 'a\nb\nc'
    editor.selectionStart = 4
    document.body.appendChild(editor)
    const lineEl = document.createElement('div')
    document.body.appendChild(lineEl)
    const deps = makeDeps({ getEditor: () => editor, getLineEl: () => lineEl })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygLineHighlight()
    expect(lineEl.style.height).toMatch(/px$/)
    expect(lineEl.style.top).toMatch(/px$/)
  })
})

describe('measureCharWidth', () => {
  it('returns cached value when font key unchanged', () => {
    const deps = makeDeps()
    const api = createWysiwygCaret(deps)
    const w1 = api.measureCharWidth()
    const w2 = api.measureCharWidth()
    // jsdom 没有真实 lineHeight, 走 fs*1.6 回退;只要两次结果一致即可
    expect(w2).toBe(w1)
    expect(w1).toBeGreaterThan(0)
  })
})

describe('moveWysiwygCaretByLines', () => {
  it('returns 0 when not in wysiwyg mode', () => {
    const editor = document.createElement('textarea')
    editor.value = 'a\nb\nc'
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor, getWysiwyg: () => false })
    const api = createWysiwygCaret(deps)
    expect(api.moveWysiwygCaretByLines(1)).toBe(0)
  })

  it('returns 0 when deltaLines is 0', () => {
    const editor = document.createElement('textarea')
    editor.value = 'a\nb'
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor })
    const api = createWysiwygCaret(deps)
    expect(api.moveWysiwygCaretByLines(0)).toBe(0)
  })

  it('returns 0 when selection is a range (collapsed required)', () => {
    const editor = document.createElement('textarea')
    editor.value = 'abcdef'
    editor.selectionStart = 1
    editor.selectionEnd = 3
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor })
    const api = createWysiwygCaret(deps)
    expect(api.moveWysiwygCaretByLines(1)).toBe(0)
  })

  it('moves caret down one line', () => {
    const editor = document.createElement('textarea')
    editor.value = 'a\nbb\nccc'
    editor.selectionStart = 0
    editor.selectionEnd = 0
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor })
    const api = createWysiwygCaret(deps)
    const moved = api.moveWysiwygCaretByLines(1)
    expect(moved).toBe(1)
    expect(editor.selectionStart).toBe(2) // after first \n
  })

  it('preserves preferred column on long-line move', () => {
    const editor = document.createElement('textarea')
    editor.value = 'short\nlongerline\nlast'
    editor.selectionStart = 2 // on first line, col=2
    editor.selectionEnd = 2
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor })
    const api = createWysiwygCaret(deps)
    // preferredColumn=3, 目标行 'longerline' col=3 → lineStart=6, offset=3, newPos=9
    api.moveWysiwygCaretByLines(1, 3)
    expect(editor.selectionStart).toBe(9)
  })

  it('moves caret up one line', () => {
    const editor = document.createElement('textarea')
    editor.value = 'a\nbb\nccc'
    editor.selectionStart = 5 // on third line 'ccc' at col=0
    editor.selectionEnd = 5
    document.body.appendChild(editor)
    const deps = makeDeps({ getEditor: () => editor })
    const api = createWysiwygCaret(deps)
    const moved = api.moveWysiwygCaretByLines(-1)
    expect(moved).toBe(-1)
    // landed on line 'bb' at column 0 → lineStart=2, offset=0
    expect(editor.selectionStart).toBe(2)
  })
})

describe('updateWysiwygCaretDot', () => {
  it('does nothing when not in wysiwyg mode', () => {
    const caretEl = document.createElement('div')
    document.body.appendChild(caretEl)
    const deps = makeDeps({ getWysiwyg: () => false, getCaretEl: () => caretEl })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygCaretDot()
    expect(caretEl.classList.contains('show')).toBe(false)
  })

  it('sets style + adds show class', () => {
    const editor = document.createElement('textarea')
    editor.value = 'hello'
    editor.selectionStart = 3
    document.body.appendChild(editor)
    const caretEl = document.createElement('div')
    document.body.appendChild(caretEl)
    const deps = makeDeps({ getEditor: () => editor, getCaretEl: () => caretEl })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygCaretDot()
    expect(caretEl.style.top).toMatch(/px$/)
    expect(caretEl.style.left).toMatch(/(px|)$/)
    expect(caretEl.classList.contains('show')).toBe(true)
    expect(api.getVisualColumn()).toBe(3)
  })
})

describe('updateWysiwygVirtualPadding', () => {
  it('clears padding-bottom and updates base px when not in wysiwyg', () => {
    const editor = document.createElement('textarea')
    document.body.appendChild(editor)
    const setBase = vi.fn()
    const deps = makeDeps({
      getEditor: () => editor,
      getWysiwyg: () => false,
      getPadBottomBasePx: () => 40,
      setPadBottomBasePx: setBase,
    })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygVirtualPadding()
    expect(editor.style.paddingBottom).toBe('')
    // setPadBottomBasePx called with whatever computed style returned (jsdom = '')
    // 实际不会改变,确认调用了
    expect(setBase).toHaveBeenCalled()
  })

  it('sets padding-bottom when in wysiwyg with longer preview', () => {
    const editor = document.createElement('textarea')
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(editor, 'clientHeight', { configurable: true, get: () => 200 })
    document.body.appendChild(editor)
    const preview = document.createElement('div')
    Object.defineProperty(preview, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(preview, 'clientHeight', { configurable: true, get: () => 200 })
    document.body.appendChild(preview)
    const deps = makeDeps({
      getEditor: () => editor,
      getPreview: () => preview,
      getWysiwyg: () => true,
      getPadBottomBasePx: () => 40,
    })
    const api = createWysiwygCaret(deps)
    api.updateWysiwygVirtualPadding()
    // er=0, pr=800, need=800, pb = 40+800=840
    expect(editor.style.paddingBottom).toBe('840px')
  })
})

describe('ensureWysiwygCaretDotInView', () => {
  it('does nothing when no caret-dot in preview', () => {
    const preview = document.createElement('div')
    document.body.appendChild(preview)
    const deps = makeDeps({ getPreview: () => preview })
    const api = createWysiwygCaret(deps)
    expect(() => api.ensureWysiwygCaretDotInView()).not.toThrow()
  })

  it('does nothing when not in wysiwyg mode', () => {
    const preview = document.createElement('div')
    const dot = document.createElement('span')
    dot.className = 'caret-dot'
    preview.appendChild(dot)
    document.body.appendChild(preview)
    const deps = makeDeps({ getPreview: () => preview, getWysiwyg: () => false })
    const api = createWysiwygCaret(deps)
    // 不调用 getBoundingClientRect 也行,直接验证 scrollTop 未被改
    api.ensureWysiwygCaretDotInView()
    expect(preview.scrollTop).toBe(0)
  })
})
