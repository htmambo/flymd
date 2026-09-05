// 代码块内快捷键跳转：Ctrl+Home / Ctrl+End（macOS 兼容 Cmd+↑ / Cmd+↓）
// 光标在 code_block 内时跳转到代码块内容顶端/底端并滚动到可见；
// 不在代码块内时返回 false 不拦截，保持 ProseMirror/浏览器默认行为（跳文档首尾）。
// 纯选区事务：不改文档、不进 undo 栈。

import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

function jumpToCodeBlockBoundary(view: EditorView, dir: 'start' | 'end'): boolean {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'code_block') continue
    const contentStart = $from.before(d) + 1
    const contentEnd = Math.max(contentStart, $from.after(d) - 1)
    const pos = dir === 'start' ? contentStart : contentEnd
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView())
    return true
  }
  return false
}

export const codeBlockJumpPlugin = new Plugin({
  key: new PluginKey('flymd-code-block-jump'),
  props: {
    handleKeyDown(view, event) {
      if ((event as KeyboardEvent).isComposing) return false
      if (event.shiftKey || event.altKey) return false
      if (event.key === 'Home' && (event.ctrlKey || event.metaKey)) {
        return jumpToCodeBlockBoundary(view, 'start')
      }
      if (event.key === 'End' && (event.ctrlKey || event.metaKey)) {
        return jumpToCodeBlockBoundary(view, 'end')
      }
      // macOS 习惯：Cmd+↑ / Cmd+↓
      if (event.metaKey && !event.ctrlKey && event.key === 'ArrowUp') {
        return jumpToCodeBlockBoundary(view, 'start')
      }
      if (event.metaKey && !event.ctrlKey && event.key === 'ArrowDown') {
        return jumpToCodeBlockBoundary(view, 'end')
      }
      return false
    },
  },
})
