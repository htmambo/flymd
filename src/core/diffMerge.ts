/**
 * 文件冲突 — 行级 diff / merge 纯函数模块
 *
 * 设计要点:
 * - 仅依赖 jsdiff 的 diffLines,无 DOM / I/O 副作用
 * - 行号严格追踪,便于上层定位 hunk 行
 * - 大文件保护:总行数 > 50000 时降级为单 hunk 整体替换
 * - change 段按行配对(min 配对 + 多余行单独成 add/del)
 *
 * @internal 本模块为纯函数,可被 `node --import tsx` 调试手测;暂未引入 vitest
 */

import { diffLines } from 'diff'

// ============================================================
// 公共类型
// ============================================================

export type DiffRow =
  | { kind: 'equal'; leftLine: number; rightLine: number; text: string }
  | { kind: 'del'; leftLine: number; text: string }
  | { kind: 'add'; rightLine: number; text: string }
  | { kind: 'change'; leftLine: number; rightLine: number; leftText: string; rightText: string }

export type Hunk = { id: number; rows: DiffRow[] }
export type MergeView = {
  hunks: Hunk[]
  leftText: string
  rightText: string
  /** true = 大文件降级模式(单 hunk 整体替换,copyHunkToXxx 不可用) */
  isLargeFileFallback?: boolean
}

/** 总行数阈值;超过则降级为单 hunk 整体替换(避免 O(N²) 卡死 + DOM 渲染卡)。
 * markdown 文档极少 > 5000 行/侧,50000 太宽松会导致 DOM 渲染卡。 */
const LARGE_FILE_LINE_THRESHOLD = 5000

// ============================================================
// 工具:把 jsdiff Change 段拆成单行
// ============================================================

/**
 * 把以 \n 拼接的多行文本拆成单行数组;
 * 注意:jsdiff 在 diffLines 模式下,每段 value 末尾可能带或不带 \n,
 * 我们用 split('\n') 后去掉末尾空串(若原值以 \n 结尾会多一个空元素)
 */
function splitLines(value: string): string[] {
  if (!value) return []
  const arr = value.split('\n')
  // 末尾若是 '' (因 \n 结尾),去掉避免引入伪空行
  if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
  return arr
}

// ============================================================
// 核心:buildHunks
// ============================================================

/**
 * 构造左右两段文本的 hunk 视图。
 *
 * 行号约定:从 1 开始(贴近编辑器/diff 工具习惯)。
 *
 * @param external 左侧 / 外部(磁盘)文本
 * @param local 右侧 / 本地(可编辑)文本
 */
/** buildHunks 可选参数 */
export type BuildHunksOptions = {
  /** true = 忽略空格 / 制表符 / 行尾空白差异(仅比较有效字符) */
  ignoreWhitespace?: boolean
}

export function buildHunks(external: string, local: string, options: BuildHunksOptions = {}): MergeView {
  const leftText = String(external ?? '')
  const rightText = String(local ?? '')
  const ignoreWhitespace = options.ignoreWhitespace === true

  // 大文件降级:不做行级 diff,直接返回一个 change 整体 hunk
  const leftLines = leftText.split('\n')
  const rightLines = rightText.split('\n')
  if (leftLines.length + rightLines.length > LARGE_FILE_LINE_THRESHOLD) {
    const row: DiffRow = {
      kind: 'change',
      leftLine: 1,
      rightLine: 1,
      leftText,
      rightText,
    }
    return {
      hunks: [{ id: 0, rows: [row] }],
      leftText,
      rightText,
      isLargeFileFallback: true,
    }
  }

  const changes = diffLines(leftText, rightText, {
    newlineIsToken: false,
    ignoreWhitespace,
  })

  // 把 jsdiff 段流转换为线性 DiffRow 流,行号严格按 equal/del/change 推左,equal/add/change 推右
  let leftLineNum = 1
  let rightLineNum = 1
  const rows: DiffRow[] = []

  for (let i = 0; i < changes.length; i++) {
    const cur = changes[i]
    const lines = splitLines(cur.value)
    if (lines.length === 0) continue

    if (!cur.added && !cur.removed) {
      // equal 段
      for (const txt of lines) {
        rows.push({
          kind: 'equal',
          leftLine: leftLineNum++,
          rightLine: rightLineNum++,
          text: txt,
        })
      }
      continue
    }

    if (cur.removed) {
      // 紧邻一个 added 段 → change 配对
      const nxt = changes[i + 1]
      if (nxt && nxt.added) {
        const addLines = splitLines(nxt.value)
        const minLen = Math.min(lines.length, addLines.length)
        for (let k = 0; k < minLen; k++) {
          rows.push({
            kind: 'change',
            leftLine: leftLineNum++,
            rightLine: rightLineNum++,
            leftText: lines[k],
            rightText: addLines[k],
          })
        }
        // 多出的 del 行单独成 del
        for (let k = minLen; k < lines.length; k++) {
          rows.push({
            kind: 'del',
            leftLine: leftLineNum++,
            text: lines[k],
          })
        }
        // 多出的 add 行单独成 add
        for (let k = minLen; k < addLines.length; k++) {
          rows.push({
            kind: 'add',
            rightLine: rightLineNum++,
            text: addLines[k],
          })
        }
        i += 1 // 跳过下一个(已消费)
        continue
      }
      // 纯删除
      for (const txt of lines) {
        rows.push({ kind: 'del', leftLine: leftLineNum++, text: txt })
      }
      continue
    }

    if (cur.added) {
      // 纯新增(若被前一个 removed 配对吃掉,这里不会再到)
      for (const txt of lines) {
        rows.push({ kind: 'add', rightLine: rightLineNum++, text: txt })
      }
      continue
    }
  }

  // 把连续 non-equal 行打包为 hunk
  const hunks: Hunk[] = []
  let cursor: DiffRow[] = []
  let hunkId = 0
  for (const r of rows) {
    if (r.kind === 'equal') {
      if (cursor.length > 0) {
        hunks.push({ id: hunkId++, rows: cursor })
        cursor = []
      }
    } else {
      cursor.push(r)
    }
  }
  if (cursor.length > 0) {
    hunks.push({ id: hunkId++, rows: cursor })
  }

  return { hunks, leftText, rightText }
}

// ============================================================
// hunk 内文本提取
// ============================================================

/**
 * 把 hunk 序列化为"右侧采纳左侧"后的纯文本块。
 * 用于 copyHunkToRight 的内容生成:
 * - del → 左侧的行(从左采用)
 * - add → 跳过(因为是右侧的修改,从左采用即丢弃)
 * - change → leftText
 */
export function hunkToLeftText(hunk: Hunk): string {
  const lines: string[] = []
  for (const r of hunk.rows) {
    if (r.kind === 'del') lines.push(r.text)
    else if (r.kind === 'change') lines.push(r.leftText)
    // add 跳过
  }
  return lines.join('\n')
}

/**
 * 把 hunk 序列化为"左侧采纳右侧"后的纯文本块。
 * 用于 copyHunkToLeft 的内容生成:
 * - del → 跳过(因为是左侧的版本,从右采用即丢弃)
 * - add → 右侧新增行
 * - change → rightText
 */
export function hunkToRightText(hunk: Hunk): string {
  const lines: string[] = []
  for (const r of hunk.rows) {
    if (r.kind === 'add') lines.push(r.text)
    else if (r.kind === 'change') lines.push(r.rightText)
    // del 跳过
  }
  return lines.join('\n')
}

// ============================================================
// hunk 行号范围(用于在原文本中定位 splice 区间)
// ============================================================

type LineRange = { start: number; endExclusive: number } // 1-based, [start, endExclusive)

/**
 * 计算 hunk 在左侧文本中影响的行号区间。
 * 若 hunk 内无左侧行(纯 add),返回 insertAt 位置:
 * - 优先以同位置的右侧行号 → 找紧邻 add 的左 cursor
 * - 简化:用 hunk.rows 中第一个有 leftLine 的行号 - 1 = 插入点,无则用 1
 */
function leftRangeOf(hunk: Hunk): LineRange | null {
  let start = Infinity
  let end = 0
  for (const r of hunk.rows) {
    if (r.kind === 'del' || r.kind === 'change') {
      if (r.leftLine < start) start = r.leftLine
      if (r.leftLine + 1 > end) end = r.leftLine + 1
    }
  }
  if (start === Infinity) return null
  return { start, endExclusive: end }
}

export function rightRangeOf(hunk: Hunk): LineRange | null {
  let start = Infinity
  let end = 0
  for (const r of hunk.rows) {
    if (r.kind === 'add' || r.kind === 'change') {
      if (r.rightLine < start) start = r.rightLine
      if (r.rightLine + 1 > end) end = r.rightLine + 1
    }
  }
  if (start === Infinity) return null
  return { start, endExclusive: end }
}

/**
 * 计算 hunk 在右侧中的插入点(用于纯 del hunk → 把左侧行插到右侧的同对位上)。
 * 取 hunk 内任一 del 行的 leftLine,转为相邻 equal 行的 rightLine。
 * 实现上无法仅从 hunk 反推,需要由上层提供 hunks 序列中"前一段 equal 行"的右行号。
 * 但简化策略:把"左→右"和"右→左"都用整行替换 + 上下文重构,见 copyHunkToXxx 注释。
 */

// ============================================================
// copyHunkToRight / copyHunkToLeft
// ============================================================

/**
 * 把 hunk(单段差异)从左侧应用到右侧 → 生成新的 rightText。
 *
 * 算法:在 rightText 中找到 hunk 影响的右侧行区间(rightRangeOf),
 *      把这段区间替换为 hunkToLeftText(hunk)。
 *      若 hunk 是纯 del(右侧无对应行),则在右侧前后 equal 行之间插入。
 *      由于 hunk 内 row 行号严格连续,纯 del hunk 的插入点 = 上一行 equal 的 rightLine + 1。
 *      实现上简化:把"右侧需要替换的区间"=
 *        - 有 right range:[start, endExclusive)
 *        - 无 right range(纯 del):[?, ?) — 取 hunk 第一行 leftLine 对应的"插入点",
 *          即在 rightLines 中插到 rightLines[insertAt - 1] 之后。
 *
 *  insertAt 取法(纯 del 场景):由 hunk 内第一行的 leftLine 找它在 equal 上下文里的 rightLine 邻居,
 *    但这里没有"上下文",只能用 hunk 第一行 leftLine 减去"左侧前面的删除行数"得到 rightLine 估值。
 *    简化:**纯 del hunk 在右侧的影响位置 = hunk 第一行 leftLine 之前的 equal 行数**。
 *
 *  为避免过度复杂,本函数限制为:必须能从 hunk.rows 推出 rightRange 或邻接 right 行;
 *  否则把 hunkToLeftText 追加到末尾(降级行为)。
 *
 * @param hunk 单段差异
 * @param rightText 当前右侧完整文本
 */
export function copyHunkToRight(hunk: Hunk, rightText: string): string {
  const rightLines = String(rightText ?? '').split('\n')
  const block = hunkToLeftText(hunk)
  // 用 hunk.rows.length 判空:即使全空行 hunkToLeftText 返回 '' 也要产出 [''] 一个空行
  const blockLines = hunk.rows.length === 0 ? [] : block.split('\n')

  const rr = rightRangeOf(hunk)
  if (rr) {
    // [start, endExclusive) 是 1-based 行号 → 转 0-based 数组索引
    const s = rr.start - 1
    const e = rr.endExclusive - 1
    const next = rightLines.slice(0, s).concat(blockLines).concat(rightLines.slice(e))
    return next.join('\n')
  }

  // 纯 del:hunk 在右侧无行可替换,需要插入。
  // 插入点估算:用 hunk 第一行的 leftLine 在左侧上下文里的位置作为插入位置(0-based 索引)。
  // 边界:若插入点超过 rightLines.length,则追加到末尾。
  const firstLeft = hunk.rows.find((r) => r.kind === 'del' || r.kind === 'change')
  const insertAt = firstLeft && (firstLeft.kind === 'del' || firstLeft.kind === 'change')
    ? Math.min(Math.max(firstLeft.leftLine - 1, 0), rightLines.length)
    : rightLines.length
  const next = rightLines.slice(0, insertAt).concat(blockLines).concat(rightLines.slice(insertAt))
  return next.join('\n')
}

/**
 * 把 hunk(单段差异)从右侧应用到左侧 → 生成新的 leftText。
 * 对偶 copyHunkToRight。
 */
export function copyHunkToLeft(hunk: Hunk, leftText: string): string {
  const leftLines = String(leftText ?? '').split('\n')
  const block = hunkToRightText(hunk)
  // 用 hunk.rows.length 判空:即使全空行 hunkToRightText 返回 '' 也要产出 [''] 一个空行
  const blockLines = hunk.rows.length === 0 ? [] : block.split('\n')

  const lr = leftRangeOf(hunk)
  if (lr) {
    const s = lr.start - 1
    const e = lr.endExclusive - 1
    const next = leftLines.slice(0, s).concat(blockLines).concat(leftLines.slice(e))
    return next.join('\n')
  }

  // 纯 add:左侧无对应行 → 插入
  const firstRight = hunk.rows.find((r) => r.kind === 'add' || r.kind === 'change')
  const insertAt = firstRight && (firstRight.kind === 'add' || firstRight.kind === 'change')
    ? Math.min(Math.max(firstRight.rightLine - 1, 0), leftLines.length)
    : leftLines.length
  const next = leftLines.slice(0, insertAt).concat(blockLines).concat(leftLines.slice(insertAt))
  return next.join('\n')
}

// ============================================================
// nextHunkId / countHunks
// ============================================================

/**
 * 计算上/下一处 hunk id。
 *
 * @param hunks       hunk 列表(可直接传 MergeView.hunks)
 * @param current     当前 hunk id(尚未定位时传 -1)
 * @param dir         1 = 下一处,-1 = 上一处
 * @param totalHunks  hunk 总数(便于上层缓存)
 *
 * 行为:
 * - hunks 空 → 返回 -1
 * - current = -1:dir=1 → 0,dir=-1 → totalHunks - 1
 * - 找下一处:第一个 > current 的 hunk id;到末尾回绕到 0
 * - 找上一处:最后一个 < current 的 hunk id;到开头回绕到 totalHunks - 1
 */
export function nextHunkId(hunks: Hunk[], current: number, dir: 1 | -1, totalHunks: number): number {
  if (totalHunks <= 0 || hunks.length === 0) return -1
  const last = totalHunks - 1
  if (current < 0) {
    return dir === 1 ? 0 : last
  }
  if (dir === 1) {
    if (current >= last) return 0
    return current + 1
  }
  // dir === -1
  if (current <= 0) return last
  return current - 1
}

/** 便利 API:返回 hunk 数量 */
export function countHunks(hunks: Hunk[]): number {
  return Array.isArray(hunks) ? hunks.length : 0
}
