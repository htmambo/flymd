// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { buildContextMenuContext, buildContextMenuContextForPalette, type ContextMenuDeps } from './contextMenuContext'

function makeEditor(value = '', sel = 0, end = 0): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = value
  // jsdom 不把 selection 持久化到 selectionStart/End 属性,直接 defineProperty
  Object.defineProperty(el, 'selectionStart', { configurable: true, value: sel })
  Object.defineProperty(el, 'selectionEnd', { configurable: true, value: end })
  return el
}

function makeDeps(overrides: Partial<ContextMenuDeps> = {}): ContextMenuDeps {
  return {
    editor: overrides.editor ?? makeEditor(),
    mode: overrides.mode ?? 'edit',
    currentFilePath: overrides.currentFilePath ?? '/doc.md',
    wysiwygV2Active: overrides.wysiwygV2Active ?? false,
    wysiwygV2GetSelectedText: overrides.wysiwygV2GetSelectedText ?? (() => ''),
  }
}

describe('buildContextMenuContext', () => {
  it('returns selected text and mode from source editor', () => {
    const deps = makeDeps({
      editor: makeEditor('hello world', 6, 11),
      mode: 'edit',
    })
    const e = { target: null } as any
    const ctx = buildContextMenuContext(e, deps)
    expect(ctx.selectedText).toBe('world')
    expect(ctx.cursorPosition).toBe(6)
    expect(ctx.mode).toBe('edit')
    expect(ctx.filePath).toBe('/doc.md')
    expect(ctx.targetElement).toBeNull()
  })

  it('reverses selection boundaries', () => {
    // selectionStart=11, selectionEnd=6 — start > end, swap them via Math.min/Math.max
    const deps = makeDeps({ editor: makeEditor('hello world', 11, 6) })
    const ctx = buildContextMenuContext({ target: null } as any, deps)
    expect(ctx.selectedText).toBe('world')
    expect(ctx.cursorPosition).toBe(11)
  })

  it('uses WYSIWYG selected text when v2 is active', () => {
    const deps = makeDeps({
      editor: makeEditor('hello', 2, 3),
      mode: 'edit',
      wysiwygV2Active: true,
      wysiwygV2GetSelectedText: () => 'wysiwyg-selected',
    })
    const ctx = buildContextMenuContext({ target: null } as any, deps)
    expect(ctx.selectedText).toBe('wysiwyg-selected')
    expect(ctx.mode).toBe('wysiwyg')
  })

  it('falls back to editor text when wysiwyg getter throws', () => {
    const deps = makeDeps({
      editor: makeEditor('hello', 0, 5),
      wysiwygV2Active: true,
      wysiwygV2GetSelectedText: () => { throw new Error('boom') },
    })
    const ctx = buildContextMenuContext({ target: null } as any, deps)
    expect(ctx.selectedText).toBe('hello')
  })

  it('passes through event target', () => {
    const div = document.createElement('div')
    const e = { target: div } as any
    const ctx = buildContextMenuContext(e, makeDeps())
    expect(ctx.targetElement).toBe(div)
  })

  it('returns safe defaults on total failure', () => {
    const bad = makeDeps({ editor: null as any })
    const ctx = buildContextMenuContext({ target: null } as any, bad)
    expect(ctx.selectedText).toBe('')
    expect(ctx.cursorPosition).toBe(0)
    expect(ctx.targetElement).toBeNull()
  })

  // preview 模式 DOM 选区 fallback(右键落在 .preview 元素内时,textarea 通常没有选区)
  describe('preview mode DOM selection fallback', () => {
    type FakeSelection = {
      isCollapsed: boolean
      rangeCount: number
      getRangeAt: (i: number) => any
      toString: () => string
    }

    function setFakeSelection(sel: FakeSelection | null) {
      ; (window as any).getSelection = () => sel
    }

    function makePreviewWithText(): { root: HTMLElement; text: Text } {
      const root = document.createElement('div')
      root.className = 'preview'
      const t = document.createTextNode('hello preview')
      root.appendChild(t)
      document.body.appendChild(root)
      return { root, text: t }
    }

    it('reads DOM selection when mode is preview and textarea has no selection', () => {
      const { root, text } = makePreviewWithText()
      setFakeSelection({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: text,
        }),
        toString: () => 'preview-selected',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('', 0, 0), mode: 'preview' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        expect(ctx.selectedText).toBe('preview-selected')
        expect(ctx.mode).toBe('preview')
      } finally {
        root.remove()
        setFakeSelection(null)
      }
    })

    it('rejects DOM selection that falls outside .preview', () => {
      const { root } = makePreviewWithText()
      const outside = document.createTextNode('outside')
      document.body.appendChild(outside)
      setFakeSelection({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({ commonAncestorContainer: outside }),
        toString: () => 'outside-text',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('', 0, 0), mode: 'preview' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        expect(ctx.selectedText).toBe('')
      } finally {
        outside.parentNode?.removeChild(outside)
        root.remove()
        setFakeSelection(null)
      }
    })

    it('rejects multi-range selection when any range falls outside .preview', () => {
      // Firefox 用户可以按住 Ctrl/Cmd 创建多个 Range;toString() 会拼接全部,
      // 因此只要有一个 Range 在 .preview 之外就应整体拒绝,避免误复制外部内容。
      const { root, text } = makePreviewWithText()
      const outside = document.createTextNode('outside')
      document.body.appendChild(outside)
      setFakeSelection({
        isCollapsed: false,
        rangeCount: 2,
        getRangeAt: (i: number) => ({
          commonAncestorContainer: i === 0 ? text : outside,
        }),
        toString: () => 'inside+outside',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('', 0, 0), mode: 'preview' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        expect(ctx.selectedText).toBe('')
      } finally {
        outside.parentNode?.removeChild(outside)
        root.remove()
        setFakeSelection(null)
      }
    })

    it('accepts multi-range selection when all ranges are inside .preview', () => {
      const { root, text } = makePreviewWithText()
      const other = document.createElement('span')
      const otherText = document.createTextNode('sibling')
      other.appendChild(otherText)
      root.appendChild(other)
      setFakeSelection({
        isCollapsed: false,
        rangeCount: 2,
        getRangeAt: (i: number) => ({
          commonAncestorContainer: i === 0 ? text : otherText,
        }),
        toString: () => 'range0+range1',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('', 0, 0), mode: 'preview' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        expect(ctx.selectedText).toBe('range0+range1')
      } finally {
        root.remove()
        setFakeSelection(null)
      }
    })

    it('ignores collapsed DOM selection', () => {
      const { root, text } = makePreviewWithText()
      setFakeSelection({
        isCollapsed: true,
        rangeCount: 0,
        getRangeAt: () => null,
        toString: () => '',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('', 0, 0), mode: 'preview' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        expect(ctx.selectedText).toBe('')
      } finally {
        root.remove()
        setFakeSelection(null)
      }
    })

    it('does not invoke DOM fallback in edit mode', () => {
      const { root, text } = makePreviewWithText()
      setFakeSelection({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({ commonAncestorContainer: text }),
        toString: () => 'preview-text',
      })
      try {
        const deps = makeDeps({ editor: makeEditor('hello', 0, 5), mode: 'edit' })
        const ctx = buildContextMenuContext({ target: root } as any, deps)
        // edit 模式仍然读 textarea 选区,不读 DOM
        expect(ctx.selectedText).toBe('hello')
      } finally {
        root.remove()
        setFakeSelection(null)
      }
    })
  })
})

describe('buildContextMenuContextForPalette', () => {
  it('forces targetElement to null even when event provided', () => {
    const deps = makeDeps()
    const ctx = buildContextMenuContextForPalette(deps)
    expect(ctx.targetElement).toBeNull()
  })

  it('still uses editor selection when present', () => {
    // slice(3, 7) of 'hi there' = 'ther'
    const deps = makeDeps({ editor: makeEditor('hi there', 3, 7) })
    const ctx = buildContextMenuContextForPalette(deps)
    expect(ctx.selectedText).toBe('ther')
  })

  it('uses wysiwyg selected text when v2 active', () => {
    const deps = makeDeps({
      editor: makeEditor('ignored', 0, 5),
      wysiwygV2Active: true,
      wysiwygV2GetSelectedText: () => 'v2-pick',
    })
    const ctx = buildContextMenuContextForPalette(deps)
    expect(ctx.selectedText).toBe('v2-pick')
    expect(ctx.mode).toBe('wysiwyg')
  })

  it('returns safe defaults when editor selection access throws', () => {
    const deps = makeDeps({
      editor: new Proxy({}, {
        get() { throw new Error('boom') }
      }) as any,
    })
    const ctx = buildContextMenuContextForPalette(deps)
    expect(ctx.selectedText).toBe('')
    expect(ctx.targetElement).toBeNull()
  })
})
