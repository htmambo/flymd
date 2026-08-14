// Milkdown 任务列表点击切换插件
// 背景:@milkdown/preset-gfm 只把 `- [ ]` / `- [x]` 解析为 list_item.checked 属性,
// toDOM 仅输出 li[data-item-type="task"][data-checked],不渲染 checkbox 元素
// (官方方案是 Crepe 的 list-item-block 组件,本项目未引入)。
// 外观由 style.css 里 li[data-item-type="task"]::before 的伪元素复选框补齐;
// 本插件负责点击该复选框区域时翻转 checked 属性,由 gfm 序列化器自动写回 `- [ ]`/`- [x]`。

import { $prose } from '@milkdown/utils'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

// 点击落在 li 内容盒左边界(复选框所在的 marker 沟槽)即视为点击复选框
// ::before 复选框位于 left: -1.4em,宽 15px,整体在 li 边界左侧,这里留 2px 容差
const HIT_TOLERANCE_PX = 2

function toggleTaskListItem(view: EditorView, li: HTMLElement): boolean {
  try {
    const pos = view.posAtDOM(li, 0)
    const $pos = view.state.doc.resolve(pos)
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d)
      if (node.type.name !== 'list_item') continue
      if (node.attrs.checked == null) return false
      const itemPos = $pos.before(d)
      const tr = view.state.tr.setNodeMarkup(itemPos, undefined, {
        ...node.attrs,
        checked: !node.attrs.checked,
      })
      view.dispatch(tr)
      return true
    }
  } catch {}
  return false
}

export const taskListTogglePlugin = $prose(() => new Plugin({
  key: new PluginKey('flymd-task-list-toggle'),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const ev = event as MouseEvent
        if (ev.button !== 0) return false
        // 点击 ::before 伪元素时,事件 target 是 li 本身
        const target = ev.target as HTMLElement | null
        if (!target || target.tagName !== 'LI') return false
        if (target.getAttribute('data-item-type') !== 'task') return false
        const rect = target.getBoundingClientRect()
        if (ev.clientX - rect.left > HIT_TOLERANCE_PX) return false
        ev.preventDefault()
        return toggleTaskListItem(view, target)
      },
    },
  },
}))
