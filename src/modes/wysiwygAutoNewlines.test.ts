// @vitest-environment jsdom
// 测试 wysiwygAutoNewlines:WYSIWYG 模式输入 ```/~~~ 或 $ 后的自动换行逻辑
// 关注点:
// 1) autoNewlineAfterBackticksInWysiwyg: 三连 ``` + 闭合围栏 → 插入 \n + setHoldFence(true)
// 2) autoNewlineAfterBackticksInWysiwyg: 非闭合围栏 → 不 setHoldFence
// 3) autoNewlineAfterInlineDollarInWysiwyg: 行内 $ 闭合 → 补 \n\n + setHoldInlineDollar(true)
// 4) autoNewlineAfterInlineDollarInWysiwyg: 在围栏内 → 不处理
// 5) autoNewlineAfterInlineDollarInWysiwyg: $$ 块级 → 不处理

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWysiwygAutoNewlines } from './wysiwygAutoNewlines'

interface Deps {
  getWysiwyg: () => boolean
  getEditor: () => HTMLTextAreaElement
  getDirty: () => boolean
  setDirty: (v: boolean) => void
  getHoldFence: () => boolean
  setHoldFence: (v: boolean) => void
  getHoldInlineDollar: () => boolean
  setHoldInlineDollar: (v: boolean) => void
  refreshTitle: () => void
  refreshStatus: () => void
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  const editor = document.createElement('textarea')
  document.body.appendChild(editor)
  return {
    getWysiwyg: () => true,
    getEditor: () => editor,
    getDirty: () => false,
    setDirty: () => {},
    getHoldFence: () => false,
    setHoldFence: () => {},
    getHoldInlineDollar: () => false,
    setHoldInlineDollar: () => {},
    refreshTitle: () => {},
    refreshStatus: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('autoNewlineAfterBackticksInWysiwyg', () => {
  it('returns early when not in wysiwyg mode', () => {
    const editor = document.createElement('textarea')
    editor.value = '```'
    editor.selectionStart = editor.selectionEnd = 3
    document.body.appendChild(editor)
    const setHoldFence = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getWysiwyg: () => false,
      getEditor: () => editor,
      setHoldFence,
    }))
    api.autoNewlineAfterBackticksInWysiwyg()
    expect(editor.value).toBe('```')
    expect(setHoldFence).not.toHaveBeenCalled()
  })

  it('returns early when selection not at 3+', () => {
    const editor = document.createElement('textarea')
    editor.value = 'ab'
    editor.selectionStart = editor.selectionEnd = 2
    document.body.appendChild(editor)
    const setHoldFence = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldFence,
    }))
    api.autoNewlineAfterBackticksInWysiwyg()
    expect(editor.value).toBe('ab')
    expect(setHoldFence).not.toHaveBeenCalled()
  })

  it('inserts \\n after backticks and sets holdFence on closing fence', () => {
    const editor = document.createElement('textarea')
    // 前面已有 ````python 开启围栏,再输入 ``` 闭合
    editor.value = '```python\ncode\n```'
    editor.selectionStart = editor.selectionEnd = editor.value.length
    document.body.appendChild(editor)
    const setDirty = vi.fn()
    const setHoldFence = vi.fn()
    const refreshTitle = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setDirty,
      setHoldFence,
      refreshTitle,
    }))
    api.autoNewlineAfterBackticksInWysiwyg()
    // 光标前插入了 \n
    expect(editor.value).toBe('```python\ncode\n```\n')
    expect(editor.selectionStart).toBe(editor.value.length - 1)
    expect(setDirty).toHaveBeenCalledWith(true)
    expect(refreshTitle).toHaveBeenCalled()
    expect(setHoldFence).toHaveBeenCalledWith(true)
  })

  it('inserts \\n but does NOT set holdFence when not closing', () => {
    const editor = document.createElement('textarea')
    // 没有前置围栏,仅在行首输入 ``` → 非闭合
    editor.value = '```'
    editor.selectionStart = editor.selectionEnd = 3
    document.body.appendChild(editor)
    const setHoldFence = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldFence,
    }))
    api.autoNewlineAfterBackticksInWysiwyg()
    expect(editor.value).toBe('```\n')
    expect(setHoldFence).not.toHaveBeenCalled()
  })

  it('handles ~~~ tildes the same way', () => {
    const editor = document.createElement('textarea')
    editor.value = '~~~\npython\n~~~'
    editor.selectionStart = editor.selectionEnd = editor.value.length
    document.body.appendChild(editor)
    const setHoldFence = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldFence,
    }))
    api.autoNewlineAfterBackticksInWysiwyg()
    expect(editor.value).toBe('~~~\npython\n~~~\n')
    expect(setHoldFence).toHaveBeenCalledWith(true)
  })
})

describe('autoNewlineAfterInlineDollarInWysiwyg', () => {
  it('returns early when not in wysiwyg mode', () => {
    const editor = document.createElement('textarea')
    editor.value = '$x$'
    editor.selectionStart = editor.selectionEnd = editor.value.length
    document.body.appendChild(editor)
    const setHoldInlineDollar = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getWysiwyg: () => false,
      getEditor: () => editor,
      setHoldInlineDollar,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    expect(editor.value).toBe('$x$')
    expect(setHoldInlineDollar).not.toHaveBeenCalled()
  })

  it('returns early when last char is not $', () => {
    const editor = document.createElement('textarea')
    editor.value = 'abc'
    editor.selectionStart = editor.selectionEnd = 3
    document.body.appendChild(editor)
    const setHoldInlineDollar = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldInlineDollar,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    expect(editor.value).toBe('abc')
    expect(setHoldInlineDollar).not.toHaveBeenCalled()
  })

  it('returns early when $$ (block math)', () => {
    const editor = document.createElement('textarea')
    editor.value = '$$'
    editor.selectionStart = editor.selectionEnd = 2
    document.body.appendChild(editor)
    const setHoldInlineDollar = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldInlineDollar,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    expect(editor.value).toBe('$$')
    expect(setHoldInlineDollar).not.toHaveBeenCalled()
  })

  it('does nothing when inside a code fence', () => {
    const editor = document.createElement('textarea')
    // 在代码围栏内输入 $x$,不应触发自动换行
    editor.value = '```\n$x$\n```'
    editor.selectionStart = editor.selectionEnd = editor.value.length
    document.body.appendChild(editor)
    const setHoldInlineDollar = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldInlineDollar,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    expect(editor.value).toBe('```\n$x$\n```')
    expect(setHoldInlineDollar).not.toHaveBeenCalled()
  })

  it('inserts \\n\\n after closing $x$ and sets holdInlineDollar', () => {
    const editor = document.createElement('textarea')
    editor.value = '$x$'
    editor.selectionStart = editor.selectionEnd = editor.value.length
    document.body.appendChild(editor)
    const setDirty = vi.fn()
    const setHoldInlineDollar = vi.fn()
    const refreshTitle = vi.fn()
    const refreshStatus = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setDirty,
      setHoldInlineDollar,
      refreshTitle,
      refreshStatus,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    // 补足 3 个换行 = \n\n\n
    expect(editor.value).toBe('$x$\n\n\n')
    expect(editor.selectionStart).toBe(editor.value.length)
    expect(setDirty).toHaveBeenCalledWith(true)
    expect(refreshTitle).toHaveBeenCalled()
    expect(refreshStatus).toHaveBeenCalled()
    expect(setHoldInlineDollar).toHaveBeenCalledWith(true)
  })

  it('does not insert \\n when closing $ is at end of line (no extra needed)', () => {
    const editor = document.createElement('textarea')
    // 后面已有 3 个换行,不需要再补
    editor.value = '$x$\n\n\n'
    editor.selectionStart = editor.selectionEnd = 3
    document.body.appendChild(editor)
    const setDirty = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setDirty,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    // value 不变
    expect(editor.value).toBe('$x$\n\n\n')
    // setDirty 不应被调用(因为没有真正插入)
    expect(setDirty).not.toHaveBeenCalled()
  })

  it('handles odd-even correctly (open $ → not closing)', () => {
    const editor = document.createElement('textarea')
    // 行内仅 1 个 $,不闭合
    editor.value = 'x $'
    editor.selectionStart = editor.selectionEnd = 3
    document.body.appendChild(editor)
    const setHoldInlineDollar = vi.fn()
    const api = createWysiwygAutoNewlines(makeDeps({
      getEditor: () => editor,
      setHoldInlineDollar,
    }))
    api.autoNewlineAfterInlineDollarInWysiwyg()
    expect(editor.value).toBe('x $')
    expect(setHoldInlineDollar).not.toHaveBeenCalled()
  })
})
