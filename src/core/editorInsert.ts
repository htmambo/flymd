// 编辑器文本插入 / 包装工具。
// 抽离自 main.ts:insertAtCursor / wrapSelection。
// 两者都是纯函数,只依赖 editor(DOM)+ setDirty + 顶栏刷新。

interface Deps {
  getEditor: () => HTMLTextAreaElement
  setDirty: (v: boolean) => void
  refreshTitle: () => void
  refreshStatus: () => void
}

export interface EditorInsertApi {
  insertAtCursor: (text: string) => void
  wrapSelection: (before: string, after: string, placeholder?: string) => void
}

export function createEditorInsert(deps: Deps): EditorInsertApi {
  function insertAtCursor(text: string) {
    const editor = deps.getEditor()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const val = editor.value
    editor.value = val.slice(0, start) + text + val.slice(end)
    const pos = start + text.length
    editor.selectionStart = editor.selectionEnd = pos
    deps.setDirty(true)
    deps.refreshTitle()
    deps.refreshStatus()
  }

  function wrapSelection(before: string, after: string, placeholder = '') {
    const editor = deps.getEditor()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const val = editor.value
    const selected = val.slice(start, end) || placeholder
    const insert = `${before}${selected}${after}`
    editor.value = val.slice(0, start) + insert + val.slice(end)
    const selStart = start + before.length
    const selEnd = selStart + selected.length
    editor.selectionStart = selStart
    editor.selectionEnd = selEnd
    deps.setDirty(true)
    deps.refreshTitle()
    deps.refreshStatus()
  }

  return { insertAtCursor, wrapSelection }
}
