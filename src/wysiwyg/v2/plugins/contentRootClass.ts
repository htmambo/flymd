// 所见模式内容根类（md-content）
//
// 目的：阅读模式（markdown-it 输出）与所见模式（ProseMirror 输出）共用同一套
// 排版规则，共享内容根类是那套规则的唯一作用域锚点（见 styles/markdown-content.css）。
//
// 注入方式：走 ProseMirror 插件的 props.attributes，而不是 editorViewOptionsCtx。
// 原因：editLock.ts 的加解锁走 ctx.set(editorViewOptionsCtx, { editable })，
// 整体替换了该 ctx 的对象，会把放在其中的 attributes 一并抹掉；而插件的
// props 在每次 state 更新时由 computeDocDeco 重算并写回 DOM，不会被覆写。
//
// prosemirror-view 的 computeDocDeco 先置 attrs.class = "ProseMirror"，
// 再对插件提供的 class 做 `attrs.class += " " + value[attr]`（追加而非覆盖），
// 最终 DOM 上是 class="ProseMirror md-content"。
// 注意：class 是「合并」语义，多个插件提供 class 时按插件顺序追加，不存在覆盖问题；
// 仓库内也没有任何代码直接改 view.dom 的 classList（NodeView 子 DOM 不在此列），
// 因此这个类不会被框架的回写机制冲掉。
// 类名与 src/styles/markdown-content.css 的共享排版层一一对应；
// 改名必须同步四处挂载点（main.ts / virtualPreview.ts / pdfContextExport.ts / 本插件），
// 由 src/styles/markdownContentMount.test.ts 断言锁死。

import { Plugin, PluginKey } from '@milkdown/prose/state'

export const contentRootClassPlugin = new Plugin({
  key: new PluginKey('flymd-content-root-class'),
  props: {
    attributes: { class: 'md-content' },
  },
})
