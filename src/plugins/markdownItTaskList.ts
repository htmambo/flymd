// Markdown-it 任务列表扩展
// 抽离自 main.ts:1934-1957(scanTaskList)+ main.ts:3411-3456(applyMdTaskListPlugin)。
// 抽离理由:
//   - scanTaskList 纯字符串扫描,无 main.ts 闭包依赖(主给预览大纲和点击穿透定位用)
//   - applyMdTaskListPlugin 只 mutate 传入的 markdown-it 实例,无 main.ts 闭包依赖
//   - 这两个拼起来就是"任务列表"完整用例,作为独立插件模块最自然

/**
 * 扫描 markdown 文本里所有 task list 复选框,返回编辑器坐标位置。
 * - 支持 `- [ ]` `+ [ ]` `* [ ]` `1. [ ]` 形式
 * - 跳过围栏代码块内部
 * - ch 指向 `[` 后 1 位(checkbox 内容起始)
 */
export function scanTaskList(md: string): Array<{ line: number; ch: number }> {
  try {
    const lines = String(md || '').split('\n')
    const out: Array<{ line: number; ch: number }> = []
    let fenceOpen = false
    let fenceCh = ''
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i]
      const mFence = s.match(/^ {0,3}(`{3,}|~{3,})/)
      if (mFence) {
        const ch = mFence[1][0]
        if (!fenceOpen) { fenceOpen = true; fenceCh = ch } else if (ch === fenceCh) { fenceOpen = false; fenceCh = '' }
      }
      if (fenceOpen) continue
      const m = s.match(/^(\s*)(?:[-+*]|\d+[.)])\s+\[( |x|X)\]\s+/)
      if (!m) continue
      const start = m[1].length
      const bpos = s.indexOf('[', start) + 1
      if (bpos <= 0) continue
      out.push({ line: i, ch: bpos })
    }
    return out
  } catch { return [] }
}

/**
 * 把 markdown-it 扩展成"任务列表"渲染:
 * - 列表项前自动插入 <input type=checkbox>
 * - li 节点加 .task-list-item,父 ul/ol 加 .task-list
 * - 兼容 `paragraph_open` 与直 `list_item_open` 两种前置形态
 */
export function applyMdTaskListPlugin(md: any): void {
  try {
    md.core.ruler.after('inline', 'task-list', function (state: any) {
      try {
        const tokens = state.tokens || []
        const TokenCtor = state.Token
        for (let i = 0; i < tokens.length; i++) {
          const tInline = tokens[i]
          if (!tInline || tInline.type !== 'inline') continue
          let liIdx = -1
          const tPrev = tokens[i - 1]
          const tPrev2 = tokens[i - 2]
          if (tPrev && tPrev.type === 'paragraph_open' && tPrev2 && tPrev2.type === 'list_item_open') liIdx = i - 2
          else if (tPrev && tPrev.type === 'list_item_open') liIdx = i - 1
          if (liIdx < 0) continue
          const tLiOpen = tokens[liIdx]
          const children = (tInline.children || [])
          if (children.length === 0) continue
          const first = children[0]
          if (!first || first.type !== 'text') continue
          const m = (first.content || '').match(/^(\s*)\[( |x|X)\]\s+/)
          if (!m) continue
          try { tLiOpen.attrJoin('class', 'task-list-item') } catch {}
          try {
            const level = tLiOpen.level - 1
            for (let j = liIdx - 1; j >= 0; j--) {
              const tj = tokens[j]
              if (!tj) continue
              if ((tj.type === 'bullet_list_open' || tj.type === 'ordered_list_open') && tj.level === level) { try { tj.attrJoin('class', 'task-list') } catch {}; break }
            }
          } catch {}
          try {
            first.content = (first.content || '').replace(/^(\s*)\[(?: |x|X)\]\s+/, '')
            const box = new TokenCtor('html_inline', '', 0)
            const checked = (m[2] || '').toLowerCase() === 'x'
            box.content = `<input class="task-list-item-checkbox" type="checkbox"${checked ? ' checked' : ''}>`
            children.unshift(box)
            tInline.children = children
          } catch {}
        }
      } catch {}
      return false
    })
  } catch {}
}
