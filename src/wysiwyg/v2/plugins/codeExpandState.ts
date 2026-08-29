// 所见模式代码块"缩放"（限高/全高）状态记忆
// 背景：点击按钮组"缩放"切换代码块的限高/全高显示。
// 展开状态按"代码块在文档中的序号（第 N 个 code_block）"记忆，通过 ProseMirror
// Decoration（flymd-code-expand 插件）把 .code-expanded class 应用到节点 DOM：
// - Decoration 由 PM 管理，节点被 automd 等插件重建时自动跟随，无需手动恢复；
// - 切勿直接手动往 pre 上 add/remove class —— 会触发 automd 读 DOM → 重建节点 →
//   恢复逻辑再加 class 的无限重建循环（实测每帧重建一次）。
// 状态仅存活于当前所见模式会话（enableWysiwygV2 时清空），不写入 Markdown 文档。

import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'

const expandedIndexes = new Set<number>()

export function isCodeBlockExpandedByIndex(index: number): boolean {
  return expandedIndexes.has(index)
}

export function setCodeBlockExpandedByIndex(index: number, expanded: boolean): void {
  if (index < 0) return
  if (expanded) expandedIndexes.add(index)
  else expandedIndexes.delete(index)
}

export function clearExpandedCodeBlocks(): void {
  expandedIndexes.clear()
}

// 计算 pre DOM 元素对应代码块的序号：doc 顶层遍历中，起点位置 <= pre 位置的
// code_block 计数（含自身）。与 decoration 生成的序号口径一致。
export function codeBlockIndexFromDom(view: EditorView, preDom: HTMLElement): number {
  try {
    const pos = view.posAtDOM(preDom, 0)
    let idx = -1
    view.state.doc.forEach((child, offset) => {
      if (offset <= pos && child.type.name === 'code_block') idx++
    })
    return idx
  } catch {
    return -1
  }
}

// 按当前展开状态集合生成 node decorations（每个展开的 code_block 加 .code-expanded）
function buildExpandedDecorations(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = []
  let idx = -1
  doc.forEach((child: ProseNode, offset: number) => {
    if (child.type.name !== 'code_block') return
    idx++
    if (expandedIndexes.has(idx)) {
      decos.push(Decoration.node(offset, offset + child.nodeSize, { class: 'code-expanded' }))
    }
  })
  return DecorationSet.create(doc, decos)
}

// 展开状态插件：每次事务后按 Set 重算 decorations。
// toggle 时先改 Set 再 dispatch 一个空事务即可刷新；编辑导致的位置变化由
// DecorationSet 随文档映射自动保持（重算按序号亦一致）。
export const codeExpandDecorationPlugin = new Plugin({
  key: new PluginKey('flymd-code-expand'),
  state: {
    init: (_, state) => buildExpandedDecorations(state.doc),
    apply: (tr, _old, _oldState, newState) => buildExpandedDecorations(newState.doc),
  },
  props: {
    decorations(state) {
      return (this as unknown as { getState(docState: typeof state): DecorationSet }).getState(state)
    },
  },
})
