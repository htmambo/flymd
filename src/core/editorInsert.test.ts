// @vitest-environment jsdom
// 测试 editorInsert 工具:insertAtCursor + wrapSelection
// 关注点:
// 1) insertAtCursor: 在选区位置插入文本,光标定位到插入文本末尾
// 2) insertAtCursor: 选区有内容时,被选区内容被替换为新文本
// 3) wrapSelection: 选中文本被 before/after 包裹
// 4) wrapSelection: 选区为空时使用 placeholder
// 5) setDirty / refreshTitle / refreshStatus 被调用

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEditorInsert } from './editorInsert'

interface Deps {
  getEditor: () => HTMLTextAreaElement
  setDirty: (v: boolean) => void
  refreshTitle: () => void
  refreshStatus: () => void
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  const editor = document.createElement('textarea')
  document.body.appendChild(editor)
  return {
    getEditor: () => editor,
    setDirty: () => {},
    refreshTitle: () => {},
    refreshStatus: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('insertAtCursor', () => {
  it('inserts text at cursor when no selection', () => {
    const editor = document.createElement('textarea')
    editor.value = 'hello world'
    editor.selectionStart = 5
    editor.selectionEnd = 5
    document.body.appendChild(editor)
    const setDirty = vi.fn()
    const refreshTitle = vi.fn()
    const api = createEditorInsert(makeDeps({ getEditor: () => editor, setDirty, refreshTitle }))
    api.insertAtCursor(' there')
    expect(editor.value).toBe('hello there world')
    expect(editor.selectionStart).toBe(11)
    expect(editor.selectionEnd).toBe(11)
    expect(setDirty).toHaveBeenCalledWith(true)
    expect(refreshTitle).toHaveBeenCalled()
  })

  it('replaces selected text with inserted text', () => {
    const editor = document.createElement('textarea')
    editor.value = 'hello world'
    editor.selectionStart = 6
    editor.selectionEnd = 11
    document.body.appendChild(editor)
    const api = createEditorInsert(makeDeps({ getEditor: () => editor }))
    api.insertAtCursor('FRIEND')
    expect(editor.value).toBe('hello FRIEND')
    expect(editor.selectionStart).toBe(12)
    expect(editor.selectionEnd).toBe(12)
  })

  it('calls refreshStatus on insert', () => {
    const editor = document.createElement('textarea')
    document.body.appendChild(editor)
    const refreshStatus = vi.fn()
    const api = createEditorInsert(makeDeps({ getEditor: () => editor, refreshStatus }))
    api.insertAtCursor('x')
    expect(refreshStatus).toHaveBeenCalled()
  })
})

describe('wrapSelection', () => {
  it('wraps selected text with before/after', () => {
    const editor = document.createElement('textarea')
    editor.value = 'this is bold text'
    editor.selectionStart = 8
    editor.selectionEnd = 12
    document.body.appendChild(editor)
    const setDirty = vi.fn()
    const api = createEditorInsert(makeDeps({ getEditor: () => editor, setDirty }))
    api.wrapSelection('**', '**')
    expect(editor.value).toBe('this is **bold** text')
    expect(editor.selectionStart).toBe(10)
    expect(editor.selectionEnd).toBe(14)
    expect(setDirty).toHaveBeenCalledWith(true)
  })

  it('uses placeholder when selection is empty', () => {
    const editor = document.createElement('textarea')
    editor.value = 'hello world'
    editor.selectionStart = 5
    editor.selectionEnd = 5
    document.body.appendChild(editor)
    const api = createEditorInsert(makeDeps({ getEditor: () => editor }))
    api.wrapSelection('*', '*', 'italic')
    expect(editor.value).toBe('hello*italic* world')
    expect(editor.selectionStart).toBe(6)
    expect(editor.selectionEnd).toBe(12)
  })

  it('uses default empty placeholder when not provided and no selection', () => {
    const editor = document.createElement('textarea')
    editor.value = 'abc'
    editor.selectionStart = 1
    editor.selectionEnd = 1
    document.body.appendChild(editor)
    const api = createEditorInsert(makeDeps({ getEditor: () => editor }))
    api.wrapSelection('`', '`')
    expect(editor.value).toBe('a``bc')
  })

  it('calls refreshTitle and refreshStatus', () => {
    const editor = document.createElement('textarea')
    document.body.appendChild(editor)
    const refreshTitle = vi.fn()
    const refreshStatus = vi.fn()
    const api = createEditorInsert(makeDeps({ getEditor: () => editor, refreshTitle, refreshStatus }))
    api.wrapSelection('**', '**')
    expect(refreshTitle).toHaveBeenCalled()
    expect(refreshStatus).toHaveBeenCalled()
  })
})
