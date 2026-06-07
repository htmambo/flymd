// WYSIWYG 可视列号计算
// 之所以独立成模块:所见模式需要按"视觉列"移动光标,而 textarea 只有逻辑列,
// 这三个工具纯粹做逻辑列↔可视列(以 4 空格为制表符步长)的换算,无 main.ts 闭包依赖。
// 抽离自 main.ts:2819-2847(byte-identical,无行为变更)。

export function advanceVisualColumn(column: number, code: number): number {
  if (code === 13 /* \r */) return column
  if (code === 9 /* \t */) {
    const modulo = column % 4
    const step = modulo === 0 ? 4 : 4 - modulo
    return column + step
  }
  return column + 1
}

export function calcVisualColumn(segment: string): number {
  let col = 0
  for (let i = 0; i < segment.length; i++) {
    col = advanceVisualColumn(col, segment.charCodeAt(i))
  }
  return col
}

export function offsetForVisualColumn(line: string, column: number): number {
  if (!Number.isFinite(column) || column <= 0) return 0
  let col = 0
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i)
    const next = advanceVisualColumn(col, code)
    if (next >= column) return i + 1
    col = next
  }
  return line.length
}
