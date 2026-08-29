// 所见模式文档边界逃逸 + 末尾空段落保证
// 背景：当文档以 code_block / math_block 这类"无文本入口"的块级节点开头时，
// 该块之前不存在任何可放置光标的文本位置（doc 内容为 block+，Selection.near 只能
// 落回块内），导致方向键↑与鼠标点击块上方空白均无法把光标移出块外，
// 用户无法在块前输入内容。文档末尾的对称问题（块之后无光标位置）同理，
// 表现为点击块下方空白/按↓无法逃出。
//
// 注意：本文件导出的是 ProseMirror Plugin 实例，由 index.ts 在 editor config 阶段
// 直接注入 prosePluginsCtx。不走 $prose/.use() —— $prose 依赖 ctx.wait(SchemaReady)
// 的异步加载链路，在当前接入方式下存在静默不加载的情况；config 阶段同步注入则必然生效。

import { Plugin, PluginKey, TextSelection, NodeSelection, type EditorState, type Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

// 位于文档首位时其上方不存在有效光标位置的块级节点：
// code_block（含 mermaid 等以 code_block 表达的块）code:true，光标无法落到块外；
// math_block atom+isolating，同样无法在块外选中。
function isEntrylessTopBlock(typeName: string): boolean {
  return typeName === 'code_block' || typeName === 'math_block'
}

export function firstBlockIsEntryless(state: EditorState): boolean {
  const first = state.doc.firstChild
  return !!first && isEntrylessTopBlock(first.type.name)
}

// 光标是否被困在文档第一个"无文本入口"块内（TextSelection 在块内容最前，
// 或 NodeSelection 正选中该块）
export function selectionTrappedInFirstBlock(state: EditorState): boolean {
  if (!firstBlockIsEntryless(state)) return false
  const sel = state.selection
  if (sel instanceof TextSelection) {
    const $from = sel.$from
    return sel.empty && $from.depth === 1 && $from.index(0) === 0 && $from.parentOffset === 0
  }
  if (sel instanceof NodeSelection) {
    return sel.from === 0
  }
  return false
}

// 在文档最前插入空段落并把光标放到其中
export function insertParagraphAbove(view: EditorView): boolean {
  try {
    const paraType = view.state.schema.nodes.paragraph
    if (!paraType) return false
    const tr = view.state.tr.insert(0, paraType.createAndFill()!)
    tr.setSelection(TextSelection.create(tr.doc, 1))
    tr.scrollIntoView()
    view.dispatch(tr)
    view.focus()
    return true
  } catch {
    return false
  }
}

export function handleArrowUpEscape(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'ArrowUp' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
  if (!firstBlockIsEntryless(view.state)) return false
  const sel = view.state.selection
  if (sel instanceof TextSelection) {
    if (!sel.empty) return false
    const $from = sel.$from
    // 仅处理文档顶层首个块；是否在"首行"用视觉判断（endOfTextblock），
    // 点击定位常落在首行第 2 个字符上（offset 1），严格 ===0 会漏触发
    if ($from.depth !== 1 || $from.index(0) !== 0) return false
    try {
      if (!view.endOfTextblock('up')) return false
    } catch {
      if ($from.parentOffset !== 0) return false
    }
    return insertParagraphAbove(view)
  }
  if (sel instanceof NodeSelection) {
    return sel.from === 0
  }
  return false
}

export function handleMousedownEscape(view: EditorView, event: MouseEvent): boolean {
  const ev = event as MouseEvent
  if (ev.button !== 0 || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return false
  if (!firstBlockIsEntryless(view.state)) return false
  // 点击须落在首块矩形上方（编辑器顶部内边距区域）才算"逃逸"意图；
  // rect.top<=0 说明首块顶部已在视口之外，此时不存在"块上方"可点击区域。
  const el = view.nodeDOM(0)
  if (!(el instanceof HTMLElement)) return false
  const rect = el.getBoundingClientRect()
  if (rect.top <= 0 || ev.clientY >= rect.top) return false
  ev.preventDefault()
  return insertParagraphAbove(view)
}

// ---- 末尾空段落保证（trailing paragraph） ----
// 文档末尾是"无文本入口"的块时，块之后不存在可放置光标的位置，
// 点击块下方空白/按↓都会被 Selection.near 拉回块内（看起来"点击无效"）。
// 此插件保证文档末尾始终有一个空段落作为光标落点。
// 注意：不得使用 @milkdown/plugin-trailing —— 它 appendTransaction 生成的事务
// 不带 addToHistory:false，会被 listener 插件当作真实文档变化，经 200ms 防抖后
// 通过 markdownUpdated 把末尾空行回写进源码 textarea，导致"打开文档即脏"。

function needsTrailingParagraph(state: EditorState): boolean {
  const last = state.doc.lastChild
  if (!last) return false
  return last.type.name !== 'paragraph' && last.type.name !== 'heading'
}

// 追加末尾空段落的事务；必须标记 addToHistory:false，让 listener 插件跳过这次
// 不可见的规范化，同时避免其进入撤销历史
export function appendTrailingTransaction(state: EditorState): Transaction | null {
  if (!needsTrailingParagraph(state)) return null
  const paraType = state.schema.nodes.paragraph
  if (!paraType) return null
  const tr = state.tr.insert(state.doc.content.size, paraType.createAndFill()!)
  tr.setMeta('addToHistory', false)
  return tr
}

// 诊断句柄：view() 钩子会把运行中的 EditorView 挂到 window（与既有 __mdeditor* 钩子同风格）
function exposeDebugView(view: EditorView): { destroy: () => void } {
  try { (window as any).__flymdPmView = view } catch {}
  return { destroy: () => { try { delete (window as any).__flymdPmView } catch {} } }
}

// 末尾空段落保证：文档末尾始终存在一个可聚焦的空段落
export const trailingParagraphPlugin = new Plugin({
  key: new PluginKey('flymd-trailing-paragraph'),
  state: {
    init: (_, state) => needsTrailingParagraph(state),
    apply: (tr, value, _oldState, newState) => (tr.docChanged ? needsTrailingParagraph(newState) : value),
  },
  appendTransaction: (_trs, _oldState, state) => appendTrailingTransaction(state),
  view: exposeDebugView,
})

// 首块上边界逃逸：↑键 / 点击首块上方空白时，在其前插入空段落
export const docBoundaryEscapePlugin = new Plugin({
  key: new PluginKey('flymd-doc-boundary-escape'),
  props: {
    handleKeyDown: handleArrowUpEscape,
    handleDOMEvents: {
      mousedown: handleMousedownEscape,
    },
  },
})
