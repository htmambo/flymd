// @vitest-environment jsdom
//
// PR-4: docPosition 写路径从 Store 改为 libraryPrivate（库内 local.json）。
// 测试覆盖：写走 libraryPrivate（不调 store.set）；读优先 libraryPrivate，
// fallback Store；scheduleSave 防抖；restore 还原。

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub 库作用域
const libStub = vi.hoisted(() => ({
  scope: { id: null as string | null, root: null as string | null, persisted: false },
}))

vi.mock('./libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./libraryConfig')>()
  return {
    ...actual,
    // 必须 mock libraryScopedKey(不能 spread 真实函数):
    // 真实 libraryScopedKey 内部引用了真实 getLibraryScope,而 mock 只覆盖导出对象
    // 不覆盖真实函数内部的闭包引用。
    getLibraryScope: () => libStub.scope,
    libraryScopedKey: (base: string) => {
      const scope = libStub.scope
      return scope.persisted && scope.id ? `${base}:${scope.id}` : base
    },
    LIBRARY_CHANGED_EVENT: actual.LIBRARY_CHANGED_EVENT,
  }
})

// Mock libraryPrivate: 内存模拟
const privMocks = vi.hoisted(() => {
  const privDocPos = new Map<string, any>()
  const writeLibraryPrivate = vi.fn(async (patch: any) => {
    if (patch?.docPos) {
      for (const [k, v] of Object.entries(patch.docPos)) {
        privDocPos.set(k, v)
      }
    }
    return true
  })
  const readLibraryPrivate = vi.fn(async () => {
    const map: any = {}
    for (const [k, v] of privDocPos.entries()) map[k] = v
    return { version: 1, docPos: map }
  })
  return { privDocPos, writeLibraryPrivate, readLibraryPrivate }
})

vi.mock('./libraryPrivate', () => ({
  readLibraryPrivate: privMocks.readLibraryPrivate,
  writeLibraryPrivate: privMocks.writeLibraryPrivate,
}))

const privDocPos = privMocks.privDocPos
const writeLibraryPrivateMock = privMocks.writeLibraryPrivate
const readLibraryPrivateMock = privMocks.readLibraryPrivate

import { createDocPositionStore, type DocPositionStoreDeps } from './docPosition'

function makeEditor(value = '', sel = 0, end = 0): HTMLTextAreaElement {
  const el = document.createElement('textarea')
  el.value = value
  // 必须 writable:true,否则 restore() 中 editor.selectionStart = ... 会静默失败
  Object.defineProperty(el, 'selectionStart', { configurable: true, writable: true, value: sel })
  Object.defineProperty(el, 'selectionEnd', { configurable: true, writable: true, value: end })
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

describe('createDocPositionStore (PR-4: write to libraryPrivate)', () => {
  beforeEach(() => {
    privDocPos.clear()
    writeLibraryPrivateMock.mockClear()
    readLibraryPrivateMock.mockClear()
    // 默认有持久化库根
    libStub.scope.id = 'lib1'
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('saves current editor+preview state to libraryPrivate (not Store)', async () => {
    const store = makeFakeStore()
    const editor = makeEditor('hello world', 2, 5)
    Object.defineProperty(editor, 'scrollTop', { configurable: true, value: 42 })
    const preview = makePreview(100)
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getPreview: () => preview })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    // PR-4: 写只走 libraryPrivate,store.set 不应被调用
    expect(store.set).not.toHaveBeenCalled()
    expect(writeLibraryPrivateMock).toHaveBeenCalled()
    const patchArg = writeLibraryPrivateMock.mock.calls[0][0] as any
    expect(patchArg.docPos['/doc.md']).toMatchObject({
      pos: 2, end: 5, scroll: 42, pscroll: 100, mode: 'edit',
    })
    expect(patchArg.docPos['/doc.md'].ts).toEqual(expect.any(Number))
  })

  it('skips save when currentFilePath is null', async () => {
    const store = makeFakeStore()
    const d = makeDeps({ getStore: () => store as any, getCurrentFilePath: () => null })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    expect(writeLibraryPrivateMock).not.toHaveBeenCalled()
  })

  it('skips save when no library root', async () => {
    libStub.scope.root = null
    libStub.scope.persisted = false
    const d = makeDeps()
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    expect(writeLibraryPrivateMock).not.toHaveBeenCalled()
  })

  it('uses wysiwyg mode when getter returns it', async () => {
    const store = makeFakeStore()
    const d = makeDeps({ getStore: () => store as any, getMode: () => 'wysiwyg' })
    const pos = createDocPositionStore(d)
    await pos.saveNow()
    const patchArg = writeLibraryPrivateMock.mock.calls[0][0] as any
    expect(patchArg.docPos['/doc.md'].mode).toBe('wysiwyg')
  })

  it('scheduleSave debounces and calls saveNow after delay', async () => {
    vi.useFakeTimers()
    writeLibraryPrivateMock.mockClear()
    const d = makeDeps({
      getStore: () => ({
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        save: vi.fn(async () => {}),
      } as any),
    })
    const pos = createDocPositionStore(d)
    pos.scheduleSave()
    pos.scheduleSave()
    pos.scheduleSave()
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(10)
    // 合并 + libraryPrivate 内部还有 500ms 防抖
    await vi.advanceTimersByTimeAsync(500)
    expect(writeLibraryPrivateMock).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('createDocPositionStore (PR-4: read priority)', () => {
  beforeEach(() => {
    privDocPos.clear()
    writeLibraryPrivateMock.mockClear()
    readLibraryPrivateMock.mockClear()
    libStub.scope.id = 'lib1'
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('reads from libraryPrivate first', async () => {
    // 预置 libraryPrivate 内的 docPos
    readLibraryPrivateMock.mockResolvedValueOnce({
      version: 1,
      docPos: { '/doc.md': { pos: 10, end: 10, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } },
    })
    const store = makeFakeStore()
    // 编辑器需够长以避免 pos 被 clamp 到 value.length
    // jsdom textarea 需要显式重定义 writable 才能 restore
    const editor: any = makeEditor('hello world this is a test document with more than ten chars', 0, 0)
    Object.defineProperty(editor, 'selectionStart', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(editor, 'selectionEnd', { configurable: true, writable: true, value: 0 })
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getCurrentFilePath: () => '/doc.md' })
    const pos = createDocPositionStore(d)
    await pos.restore()
    expect(editor.selectionStart).toBe(10)
    // 不应回退到 Store
    expect(store.get).not.toHaveBeenCalled()
  })

  it('falls back to Store when libraryPrivate is empty', async () => {
    readLibraryPrivateMock.mockResolvedValueOnce({ version: 1 } as any)  // 无 docPos
    const store = makeFakeStore()
    store.data['docPos:lib1'] = {
      '/doc.md': { pos: 5, end: 5, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 },
    }
    const editor: any = makeEditor('hello world this is a test document with more than five chars', 0, 0)
    Object.defineProperty(editor, 'selectionStart', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(editor, 'selectionEnd', { configurable: true, writable: true, value: 0 })
    const d = makeDeps({ getStore: () => store as any, getEditor: () => editor, getCurrentFilePath: () => '/doc.md' })
    const pos = createDocPositionStore(d)
    await pos.restore()
    expect(editor.selectionStart).toBe(5)
    expect(store.get).toHaveBeenCalled()
  })
})

describe('createDocPositionStore (regression: pre-existing restore behavior)', () => {
  beforeEach(() => {
    privDocPos.clear()
    writeLibraryPrivateMock.mockClear()
    readLibraryPrivateMock.mockClear()
    libStub.scope.id = 'lib1'
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('restore applies cached pos/end/scroll/pscroll to editor and preview', async () => {
    // 走 libraryPrivate 路径
    readLibraryPrivateMock.mockResolvedValueOnce({
      version: 1,
      docPos: { '/doc.md': { pos: 2, end: 8, scroll: 0, pscroll: 0, mode: 'edit', ts: 1 } },
    })
    const editor: any = makeEditor('hi there friend', 0, 0)
    Object.defineProperty(editor, 'selectionStart', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(editor, 'selectionEnd', { configurable: true, writable: true, value: 0 })
    const preview = makePreview(0)
    const refreshStatus = vi.fn()
    const d = makeDeps({
      getEditor: () => editor,
      getPreview: () => preview,
      refreshStatus,
    })
    const pos = createDocPositionStore(d)
    await pos.restore()
    expect(editor.selectionStart).toBe(2)
    expect(editor.selectionEnd).toBe(8)
    expect(refreshStatus).toHaveBeenCalled()
  })

  it('restore is a no-op when path has no entry', async () => {
    readLibraryPrivateMock.mockResolvedValueOnce({ version: 1, docPos: {} })
    const editor = makeEditor('xx', 0, 0)
    const d = makeDeps({ getEditor: () => editor })
    const pos = createDocPositionStore(d)
    await pos.restore('/unknown.md')
    expect(editor.selectionStart).toBe(0)
  })

  it('clamps restored pos to current value length', async () => {
    readLibraryPrivateMock.mockResolvedValueOnce({
      version: 1,
      docPos: { '/clamp.md': { pos: 9999, end: 9999, scroll: 0, pscroll: 0, mode: 'edit', ts: 1 } },
    })
    const editor = makeEditor('short', 0, 0)
    const d = makeDeps({ getEditor: () => editor, getCurrentFilePath: () => '/clamp.md' })
    const pos = createDocPositionStore(d)
    await pos.restore()
    expect(editor.selectionStart).toBeLessThanOrEqual(5)
    expect(editor.selectionEnd).toBeLessThanOrEqual(5)
  })

  it('tolerates libraryPrivate.get throwing', async () => {
    readLibraryPrivateMock.mockRejectedValueOnce(new Error('libraryPrivate broken'))
    const d = makeDeps()
    const pos = createDocPositionStore(d)
    await expect(pos.saveNow()).resolves.toBeUndefined()
    await expect(pos.restore()).resolves.toBeUndefined()
  })
})
