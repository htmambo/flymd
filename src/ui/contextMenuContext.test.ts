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
