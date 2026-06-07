// 右键菜单上下文构建器
// 抽离自 main.ts:1134-1191。
// 抽离理由:两个 builder 仅闭包 5 个 main-local 状态(editor / mode / currentFilePath /
// wysiwygV2Active / wysiwygV2GetSelectedText),通过 deps 对象参数化即可消除闭包。
// targetElement 来自鼠标事件,Palette 版固定为 null。
// 复用 src/ui/contextMenus.ts 的 ContextMenuContext 类型(已有权威定义)。

import type { ContextMenuContext } from './contextMenus'

export type ContextMenuMode = 'edit' | 'preview' | 'wysiwyg'

export type ContextMenuDeps = {
  editor: HTMLTextAreaElement
  mode: ContextMenuMode
  currentFilePath: string | null
  wysiwygV2Active: boolean
  wysiwygV2GetSelectedText: () => string
}

/**
 * 从鼠标右键事件构建上下文:
 * - 选区文本(若 WYSIWYG 激活,优先用 wysiwygV2GetSelectedText)
 * - 鼠标命中的 DOM 元素
 * 失败时返回安全降级值,不抛错
 */
export function buildContextMenuContext(e: MouseEvent, deps: ContextMenuDeps): ContextMenuContext {
  try {
    const sel = deps.editor.selectionStart || 0
    const end = deps.editor.selectionEnd || 0
    let text = deps.editor.value.slice(Math.min(sel, end), Math.max(sel, end))
    if (deps.wysiwygV2Active) {
      try {
        const wysSel = String(deps.wysiwygV2GetSelectedText() || '')
        text = wysSel
      } catch {}
    }
    return {
      selectedText: text,
      cursorPosition: sel,
      mode: deps.wysiwygV2Active ? 'wysiwyg' : deps.mode,
      filePath: deps.currentFilePath,
      targetElement: (e.target as HTMLElement | null) || null,
    }
  } catch {
    return {
      selectedText: '',
      cursorPosition: 0,
      mode: deps.mode,
      filePath: deps.currentFilePath,
      targetElement: (e.target as HTMLElement | null) || null,
    }
  }
}

/**
 * 命令面板使用的版本:不依赖鼠标命中节点,targetElement 固定为 null
 */
export function buildContextMenuContextForPalette(deps: ContextMenuDeps): ContextMenuContext {
  try {
    const sel = deps.editor.selectionStart || 0
    const end = deps.editor.selectionEnd || 0
    let text = deps.editor.value.slice(Math.min(sel, end), Math.max(sel, end))
    if (deps.wysiwygV2Active) {
      try {
        const wysSel = String(deps.wysiwygV2GetSelectedText() || '')
        text = wysSel
      } catch {}
    }
    return {
      selectedText: text,
      cursorPosition: sel,
      mode: deps.wysiwygV2Active ? 'wysiwyg' : deps.mode,
      filePath: deps.currentFilePath,
      targetElement: null,
    }
  } catch {
    return {
      selectedText: '',
      cursorPosition: 0,
      mode: deps.wysiwygV2Active ? 'wysiwyg' : deps.mode,
      filePath: deps.currentFilePath,
      targetElement: null,
    }
  }
}
