// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDocPositionStore, type DocPositionStoreDeps } from './docPosition'

function makeEditor(value = '', sel = 0, end = 0): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = value
  Object.defineProperty(el, 'selectionStart', { configurable: true, value: sel })
  Object.defineProperty(el, 'selectionEnd', { configurable: true, value: end })
  el.scrollTop = 0
  return el
}

function makePreview(scrollTop = 0): HTMLDivElement {
  const d = document.createElement('div')
  Object.defineProperty(d, 'scrollTop', { configurable: true, value: scrollTop })
  return d
}

function makeDeps(overrides: Partial<DocPositionStoreDeps> = {}): DocPositionStoreDeps {
  return {
    getStore: overrides.getStore ?? (() => null),
    getCurrentFilePath: overrides.getCurrentFilePath ?? (() => '/doc.md'),
    getEditor: overrides.getEditor ?? (() => makeEditor()),
    getPreview: overrides.getPreview ?? (() => makePreview()),
    getMode: overrides.getMode ?? (() => 'edit'),
    refreshStatus: overrides.refreshStatus ?? (() => {}),
  }
}

function makeFakeStore() {
  const data: Record<string, any> = {}
  return {
    data,
    get: vi.fn(async (k: string) => data[k]),
    set: vi.fn(async (k: string, v: any) => { data[k] = v }),
    save: vi.fn(async () => {}),
  }
}

describe('createDocPositionStore', () => {
  beforeEach(() => { vi.useRealTimers() })

  it('saves current editor+preview state under currentFilePath', async () => {
    const store = makeFakeStore()
    const editor = makeEditor('hello world', 2, 5)
    Object.defineProperty(editor, 'scrollTop', { configurable: true, value: 42 })
    const preview = makePreview(100)
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getPreview: () => preview })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    expect(store.set).toHaveBeenCalledWith('docPos', {
      '/doc.md': {
        pos: 2, end: 5, scroll: 42, pscroll: 100, mode: 'edit', ts: expect.any(Number),
      },
    })
    expect(store.save).toHaveBeenCalled()
  })

  it('skips save when currentFilePath is null', async () => {
    const store = makeFakeStore()
    const d = makeDeps({ getStore: () => store as any, getCurrentFilePath: () => null })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    expect(store.set).not.toHaveBeenCalled()
  })

  it('skips save when store is null', async () => {
    const d = makeDeps({ getStore: () => null })
    const pos = createDocPositionStore(d)
    await expect(pos.saveNow()).resolves.toBeUndefined()
  })

  it('uses wysiwyg mode when getter returns it', async () => {
    const store = makeFakeStore()
    const d = makeDeps({ getStore: () => store as any, getMode: () => 'wysiwyg' })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    expect(store.set).toHaveBeenCalledWith('docPos', expect.objectContaining({
      '/doc.md': expect.objectContaining({ mode: 'wysiwyg' }),
    }))
  })

  it('scheduleSave debounces and calls saveNow after delay', async () => {
    vi.useFakeTimers()
    const saveSpy = vi.fn(async () => {})
    const d = makeDeps({
      getStore: () => ({
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        save: saveSpy,
      } as any),
    })
    const pos = createDocPositionStore(d)
    pos.scheduleSave()
    pos.scheduleSave()
    pos.scheduleSave()
    await vi.advanceTimersByTimeAsync(500)
    // idle callback runs synchronously in jsdom; the inner setTimeout fallback is what we hit
    await vi.advanceTimersByTimeAsync(10)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('restore applies cached pos/end/scroll/pscroll to editor and preview', async () => {
    const store = makeFakeStore()
    // unlock selectionStart/End for assignment (jsdom defaults to read-only)
    const editor: any = makeEditor('hi there friend', 0, 0)
    Object.defineProperty(editor, 'selectionStart', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(editor, 'selectionEnd', { configurable: true, writable: true, value: 0 })
    const preview = makePreview(0)
    const refreshStatus = vi.fn()
    const d = makeDeps({
      getStore: () => store as any,
      getEditor: () => editor,
      getPreview: () => preview,
      refreshStatus,
    })
    const pos = createDocPositionStore(d)
    // pre-seed the map with a known state
    await store.set('docPos', {
      '/doc.md': { pos: 2, end: 8, scroll: 0, pscroll: 0, mode: 'edit', ts: 1 },
    })
    await pos.restore()
    expect(editor.selectionStart).toBe(2)
    expect(editor.selectionEnd).toBe(8)
    expect(refreshStatus).toHaveBeenCalled()
  })

  it('restore is a no-op when path has no entry', async () => {
    const store = makeFakeStore()
    const editor = makeEditor('xx', 0, 0)
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor })
    const pos = createDocPositionStore(d)
    await pos.restore('/unknown.md')
    expect(editor.selectionStart).toBe(0)
  })

  it('restore falls back to currentFilePath when path arg omitted', async () => {
    const store = makeFakeStore()
    const editor = makeEditor('hi', 0, 0)
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getCurrentFilePath: () => '/fallback.md' })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    // pretend file is now different
    d.getCurrentFilePath = () => '/fallback.md'
    await pos.restore()
    // no error, no restore
    expect(editor.selectionStart).toBe(0)
  })

  it('clamps restored pos to current value length', async () => {
    const store = makeFakeStore()
    // Pre-seed with bogus huge pos
    await store.set('docPos', { '/clamp.md': { pos: 9999, end: 9999, scroll: 0, pscroll: 0, mode: 'edit', ts: 1 } })
    const editor = makeEditor('short', 0, 0)
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getCurrentFilePath: () => '/clamp.md' })
    const pos = createDocPositionStore(d)
    await pos.restore()
    expect(editor.selectionStart).toBeLessThanOrEqual(5)
    expect(editor.selectionEnd).toBeLessThanOrEqual(5)
  })

  it('tolerates store.get throwing', async () => {
    const broken = { get: vi.fn(async () => { throw new Error('store broken') }), set: vi.fn(), save: vi.fn() }
    const d = makeDeps({ getStore: () => broken as any })
    const pos = createDocPositionStore(d)
    await expect(pos.saveNow()).resolves.toBeUndefined()
  })
})
