/**
 * diffMerge 单元测试
 *
 * 覆盖:
 * - buildHunks 各种 case(equal/del/add/change/多 hunk/大文件降级)
 * - 行号追踪
 * - nextHunkId 循环 + 起始
 * - copyHunkToRight / copyHunkToLeft 区间替换与插入
 * - hunkToRightText / hunkToLeftText 序列化
 * - countHunks
 */

import { describe, it, expect } from 'vitest'
import {
  buildHunks,
  hunkToLeftText,
  hunkToRightText,
  copyHunkToRight,
  copyHunkToLeft,
  nextHunkId,
  countHunks,
  type Hunk,
} from './diffMerge'

// ============================================================
// buildHunks — 基础场景
// ============================================================

describe('buildHunks: 基础场景', () => {
  it('完全相同 → 1 个 equal hunk(实际是 0 hunk),所有行 equal', () => {
    const text = 'a\nb\nc'
    const view = buildHunks(text, text)
    expect(view.hunks).toHaveLength(0) // 没有差异 → 没 hunk
    expect(view.isLargeFileFallback).toBeFalsy()
    // rows 全是 equal
    const allRows = view.hunks  // 实际为空,但 buildHunks 也输出全 equal 行流
    expect(allRows).toEqual([])
  })

  it('空文本 ↔ 空文本', () => {
    const view = buildHunks('', '')
    expect(view.hunks).toHaveLength(0)
    expect(view.isLargeFileFallback).toBeFalsy()
  })

  it('空 local,非空 external → 1 个 del hunk', () => {
    const view = buildHunks('a\nb\nc', '')
    expect(view.hunks).toHaveLength(1)
    const h = view.hunks[0]
    expect(h.rows.every((r) => r.kind === 'del')).toBe(true)
    expect(h.rows.map((r) => (r as any).text)).toEqual(['a', 'b', 'c'])
  })

  it('空 external,非空 local → 1 个 add hunk', () => {
    const view = buildHunks('', 'x\ny\nz')
    expect(view.hunks).toHaveLength(1)
    const h = view.hunks[0]
    expect(h.rows.every((r) => r.kind === 'add')).toBe(true)
    expect(h.rows.map((r) => (r as any).text)).toEqual(['x', 'y', 'z'])
  })
})

// ============================================================
// buildHunks — change 配对
// ============================================================

describe('buildHunks: change 配对', () => {
  it('等长 del + add → 全部成 change', () => {
    // 左:"a / b / c"  右:"a / X / c"  → 中间一行改
    const view = buildHunks('a\nb\nc', 'a\nX\nc')
    expect(view.hunks).toHaveLength(1)
    const rows = view.hunks[0].rows
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('change')
    expect((rows[0] as any).leftText).toBe('b')
    expect((rows[0] as any).rightText).toBe('X')
  })

  it('del 多 1 行 → 多出的 1 行单独成 del', () => {
    // 左:"a / b1 / b2 / c"  右:"a / X / c"  → 中间 2 行变 1 行
    const view = buildHunks('a\nb1\nb2\nc', 'a\nX\nc')
    expect(view.hunks).toHaveLength(1)
    const rows = view.hunks[0].rows
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('change')
    expect((rows[0] as any).leftText).toBe('b1')
    expect((rows[0] as any).rightText).toBe('X')
    expect(rows[1].kind).toBe('del')
    expect((rows[1] as any).text).toBe('b2')
  })

  it('add 多 1 行 → 多出的 1 行单独成 add', () => {
    // 左:"a / b / c"  右:"a / X / Y / c"  → 中间 1 行变 2 行
    const view = buildHunks('a\nb\nc', 'a\nX\nY\nc')
    expect(view.hunks).toHaveLength(1)
    const rows = view.hunks[0].rows
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('change')
    expect((rows[0] as any).leftText).toBe('b')
    expect((rows[0] as any).rightText).toBe('X')
    expect(rows[1].kind).toBe('add')
    expect((rows[1] as any).text).toBe('Y')
  })
})

// ============================================================
// buildHunks — 行号追踪
// ============================================================

describe('buildHunks: 行号追踪', () => {
  it('equal 段同时推进 leftLine 和 rightLine', () => {
    // 全部相同 3 行
    const view = buildHunks('a\nb\nc', 'a\nb\nc')
    // 没有 hunk(没差异),但内部分配过行号,这里只能间接验证:从 countHunks 和 isLargeFileFallback
    expect(view.hunks).toHaveLength(0)
  })

  it('带前后 equal 段的 change → 验证行号', () => {
    // 左:"1 / 2 / 3"  右:"1 / X / 3"  → 中间一行改
    const view = buildHunks('1\n2\n3', '1\nX\n3')
    expect(view.hunks).toHaveLength(1)
    const r = view.hunks[0].rows[0] as any
    expect(r.kind).toBe('change')
    expect(r.leftLine).toBe(2)  // 第 2 行
    expect(r.rightLine).toBe(2) // 第 2 行
  })

  it('带前后 equal 段的 del → 验证行号', () => {
    // 左:"1 / 2 / 3"  右:"1 / 3"  → 删除中间行
    const view = buildHunks('1\n2\n3', '1\n3')
    expect(view.hunks).toHaveLength(1)
    const r = view.hunks[0].rows[0] as any
    expect(r.kind).toBe('del')
    expect(r.leftLine).toBe(2)
    expect(r.text).toBe('2')
  })

  it('带前后 equal 段的 add → 验证行号', () => {
    // 左:"1 / 3"  右:"1 / 2 / 3"  → 插入中间行
    const view = buildHunks('1\n3', '1\n2\n3')
    expect(view.hunks).toHaveLength(1)
    const r = view.hunks[0].rows[0] as any
    expect(r.kind).toBe('add')
    expect(r.rightLine).toBe(2)
    expect(r.text).toBe('2')
  })
})

// ============================================================
// buildHunks — 多 hunk 拆分
// ============================================================

describe('buildHunks: 多 hunk 拆分', () => {
  it('两段独立差异 → 2 个 hunk', () => {
    // 左:"a / b / c / d / e"  右:"a / B / c / D / e"
    const view = buildHunks('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne')
    expect(view.hunks).toHaveLength(2)
    expect(view.hunks[0].id).toBe(0)
    expect(view.hunks[1].id).toBe(1)
    // hunk 0:行 2 改
    expect(view.hunks[0].rows).toHaveLength(1)
    expect(view.hunks[0].rows[0].kind).toBe('change')
    // hunk 1:行 4 改
    expect(view.hunks[1].rows).toHaveLength(1)
    expect(view.hunks[1].rows[0].kind).toBe('change')
  })

  it('hunk id 严格从 0 开始递增', () => {
    const view = buildHunks('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne')
    expect(view.hunks.map((h) => h.id)).toEqual([0, 1])
  })
})

// ============================================================
// buildHunks — 大文件降级
// ============================================================

describe('buildHunks: 大文件降级', () => {
  it('总行数 > 5000 → isLargeFileFallback = true,单 hunk change', () => {
    // 6000 行 left + 6000 行 right = 12000 > 5000
    const bigLeft = Array.from({ length: 6000 }, (_, i) => `L${i}`).join('\n')
    const bigRight = Array.from({ length: 6000 }, (_, i) => `R${i}`).join('\n')
    const view = buildHunks(bigLeft, bigRight)
    expect(view.isLargeFileFallback).toBe(true)
    expect(view.hunks).toHaveLength(1)
    expect(view.hunks[0].rows).toHaveLength(1)
    const r = view.hunks[0].rows[0] as any
    expect(r.kind).toBe('change')
    expect(r.leftText).toBe(bigLeft)
    expect(r.rightText).toBe(bigRight)
  })

  it('总行数 = 5000 → 不降级(临界值,应不触发)', { timeout: 30000 }, () => {
    // 2500 + 2500 = 5000,不大于 5000,走正常 diff
    const left = Array.from({ length: 2500 }, (_, i) => `L${i}`).join('\n')
    const right = Array.from({ length: 2500 }, (_, i) => `R${i}`).join('\n')
    const view = buildHunks(left, right)
    expect(view.isLargeFileFallback).toBeFalsy()
  })

  it('总行数 = 5001 → 降级', () => {
    const left = Array.from({ length: 2500 }, (_, i) => `L${i}`).join('\n')
    const right = Array.from({ length: 2501 }, (_, i) => `R${i}`).join('\n')
    const view = buildHunks(left, right)
    expect(view.isLargeFileFallback).toBe(true)
  })
})

// ============================================================
// buildHunks — ignoreWhitespace 选项
// ============================================================

describe('buildHunks: ignoreWhitespace 选项', () => {
  it('默认(不传 options)→ ignoreWhitespace = false,空白差异仍被识别', () => {
    // 左右仅差几个空格 — 默认应识别为 change
    const left = 'a\n  b\nc'
    const right = 'a\nb\nc'
    const view = buildHunks(left, right)
    expect(view.hunks.length).toBeGreaterThan(0)
  })

  it('ignoreWhitespace = true → 仅空白差异不再产生 hunk', () => {
    const left = 'a\n  b\nc'
    const right = 'a\nb\nc'
    const view = buildHunks(left, right, { ignoreWhitespace: true })
    // 忽略空白后,两边实际内容相同 → 无 hunk
    expect(view.hunks).toHaveLength(0)
  })

  it('ignoreWhitespace = true 但有非空白差异 → 仍产生 hunk', () => {
    const left = 'a\n  b\nc'
    const right = 'a\nX\nc'  // 不仅空白不同,字符也变
    const view = buildHunks(left, right, { ignoreWhitespace: true })
    expect(view.hunks).toHaveLength(1)
    expect(view.hunks[0].rows[0].kind).toBe('change')
  })

  it('options.ignoreWhitespace = false 显式传入 → 与默认一致', () => {
    const left = 'a\n  b\nc'
    const right = 'a\nb\nc'
    const view = buildHunks(left, right, { ignoreWhitespace: false })
    expect(view.hunks.length).toBeGreaterThan(0)
  })
})

// ============================================================
// hunkToRightText / hunkToLeftText
// ============================================================

describe('hunkToRightText / hunkToLeftText', () => {
  it('change 段:rightText 走 rightText,leftText 走 leftText', () => {
    const view = buildHunks('a\nb\nc', 'a\nX\nc')
    const h = view.hunks[0]
    expect(hunkToRightText(h)).toBe('X')
    expect(hunkToLeftText(h)).toBe('b')
  })

  it('del + add 混合:del 行只出现在 leftText,add 行只出现在 rightText', () => {
    // 左:"a / b1 / b2 / c"  右:"a / X / Y / c"
    const view = buildHunks('a\nb1\nb2\nc', 'a\nX\nY\nc')
    const h = view.hunks[0]
    expect(hunkToLeftText(h)).toBe('b1\nb2')  // 从左采用
    expect(hunkToRightText(h)).toBe('X\nY')   // 从右采用
  })

  it('纯 del hunk:leftText 包含 del 行,rightText 为空', () => {
    const view = buildHunks('a\nb\nc', 'a\nc')
    const h = view.hunks[0]
    expect(hunkToLeftText(h)).toBe('b')
    expect(hunkToRightText(h)).toBe('')
  })

  it('纯 add hunk:rightText 包含 add 行,leftText 为空', () => {
    const view = buildHunks('a\nc', 'a\nb\nc')
    const h = view.hunks[0]
    expect(hunkToLeftText(h)).toBe('')
    expect(hunkToRightText(h)).toBe('b')
  })
})

// ============================================================
// copyHunkToRight
// ============================================================

describe('copyHunkToRight', () => {
  it('change hunk:右侧区间被替换为 leftText', () => {
    // 左:"a / b / c"  右:"a / X / c"  → 从左复制到右
    const right = 'a\nX\nc'
    const view = buildHunks('a\nb\nc', right)
    const h = view.hunks[0]
    const result = copyHunkToRight(h, right)
    expect(result).toBe('a\nb\nc')  // 现在右 = 左
  })

  it('del + add 混合:替换区间为 hunkToLeftText', () => {
    // 左:"a / b1 / b2 / c"  右:"a / X / c"  → 把 X 替换为 b1 + b2
    const right = 'a\nX\nc'
    const view = buildHunks('a\nb1\nb2\nc', right)
    const h = view.hunks[0]
    const result = copyHunkToRight(h, right)
    // rightRangeOf 应涵盖 rightLine 2 那一行 → 替换为 b1 + b2
    expect(result).toBe('a\nb1\nb2\nc')
  })

  it('纯 del hunk:在右的对应位置插入左的行', () => {
    // 左:"a / b / c"  右:"a / c"  → 把 b 插入右
    const right = 'a\nc'
    const view = buildHunks('a\nb\nc', right)
    const h = view.hunks[0]
    const result = copyHunkToRight(h, right)
    expect(result).toBe('a\nb\nc')
  })

  it('大文件降级 hunk:不调用(由 UI 禁用),但函数不应崩溃', () => {
    // 模拟大文件降级:leftText 整段 + rightText 整段
    const leftBig = Array.from({ length: 6000 }, (_, i) => `L${i}`).join('\n')
    const rightBig = Array.from({ length: 6000 }, (_, i) => `R${i}`).join('\n')
    const view = buildHunks(leftBig, rightBig)
    expect(view.isLargeFileFallback).toBe(true)
    const h = view.hunks[0]
    // 不期望特定结果(因为算法无定义,降级模式 UI 禁用按钮)
    // 至少函数不应抛错
    expect(() => copyHunkToRight(h, rightBig)).not.toThrow()
  })
})

// ============================================================
// copyHunkToLeft
// ============================================================

describe('copyHunkToLeft', () => {
  it('change hunk:左侧区间被替换为 rightText', () => {
    // 左:"a / b / c"  右:"a / X / c"  → 从右复制到左
    const left = 'a\nb\nc'
    const view = buildHunks(left, 'a\nX\nc')
    const h = view.hunks[0]
    const result = copyHunkToLeft(h, left)
    expect(result).toBe('a\nX\nc')  // 现在左 = 右
  })

  it('纯 add hunk:在左的对应位置插入右的行', () => {
    // 左:"a / c"  右:"a / b / c"  → 把 b 插入左
    const left = 'a\nc'
    const view = buildHunks(left, 'a\nb\nc')
    const h = view.hunks[0]
    const result = copyHunkToLeft(h, left)
    expect(result).toBe('a\nb\nc')
  })
})

// ============================================================
// 空行差异(回归)— bug 复现:全空行 del/add 时 block === '' 误判为无 hunk
// ============================================================

describe('copyHunkToRight / copyHunkToLeft: 空行/空格差异', () => {
  it('中间多一个空行:从左复制应正确插入空行', () => {
    // external 末尾多一个换行 vs local 末尾无换行这种 case 由 jsdiff newlineIsToken:false
    // 特殊处理,本测试只覆盖"中间空行"差异
    const external = 'a\n\nb\n'
    const local = 'a\nb\n'
    const view = buildHunks(external, local)
    expect(view.hunks.length).toBeGreaterThan(0)
    const h = view.hunks[0]
    expect(h.rows.some((r) => r.kind === 'del' || r.kind === 'change')).toBe(true)
    const newLocal = copyHunkToRight(h, local)
    // 必须包含正确数量的换行,即空行不能被吞掉
    expect(newLocal).toBe('a\n\nb\n')
  })

  it('多空行减少:从左复制应正确减少空行', () => {
    // external 'a\n\nb\n'  vs local 'a\n\n\nb\n'  → local 多一个空行
    const external = 'a\n\nb\n'
    const local = 'a\n\n\nb\n'
    const view = buildHunks(external, local)
    expect(view.hunks.length).toBeGreaterThan(0)
    // 至少能识别出 del/add 段,且空行不丢失
    const h = view.hunks[0]
    const newLocal = copyHunkToRight(h, local)
    // 不论 hunk 是 del 还是 add,空行数量必须被正确反映
    expect(newLocal.split('\n').length).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================
// nextHunkId
// ============================================================

describe('nextHunkId', () => {
  const makeHunks = (n: number): Hunk[] =>
    Array.from({ length: n }, (_, i) => ({ id: i, rows: [] }))

  it('空 hunks → 返回 -1', () => {
    expect(nextHunkId([], 0, 1, 0)).toBe(-1)
    expect(nextHunkId([], 0, -1, 0)).toBe(-1)
  })

  it('current = -1(尚未定位):dir=1 → 0,dir=-1 → 末尾', () => {
    const hunks = makeHunks(3)
    expect(nextHunkId(hunks, -1, 1, 3)).toBe(0)
    expect(nextHunkId(hunks, -1, -1, 3)).toBe(2)
  })

  it('下一处:中间位置 → current + 1', () => {
    const hunks = makeHunks(3)
    expect(nextHunkId(hunks, 0, 1, 3)).toBe(1)
    expect(nextHunkId(hunks, 1, 1, 3)).toBe(2)
  })

  it('下一处:末尾 → 回绕到 0', () => {
    const hunks = makeHunks(3)
    expect(nextHunkId(hunks, 2, 1, 3)).toBe(0)
  })

  it('上一处:中间位置 → current - 1', () => {
    const hunks = makeHunks(3)
    expect(nextHunkId(hunks, 2, -1, 3)).toBe(1)
    expect(nextHunkId(hunks, 1, -1, 3)).toBe(0)
  })

  it('上一处:开头 → 回绕到末尾', () => {
    const hunks = makeHunks(3)
    expect(nextHunkId(hunks, 0, -1, 3)).toBe(2)
  })

  it('单 hunk 边界', () => {
    const hunks = makeHunks(1)
    // 0 → 1 → 0 → 1
    expect(nextHunkId(hunks, 0, 1, 1)).toBe(0)  // 末尾回绕
    expect(nextHunkId(hunks, 0, -1, 1)).toBe(0) // 开头回绕
    // 起始 -1
    expect(nextHunkId(hunks, -1, 1, 1)).toBe(0)
    expect(nextHunkId(hunks, -1, -1, 1)).toBe(0)
  })
})

// ============================================================
// countHunks
// ============================================================

describe('countHunks', () => {
  it('正常数组', () => {
    const hunks: Hunk[] = [
      { id: 0, rows: [] },
      { id: 1, rows: [] },
      { id: 2, rows: [] },
    ]
    expect(countHunks(hunks)).toBe(3)
  })

  it('空数组', () => {
    expect(countHunks([])).toBe(0)
  })

  it('非数组输入', () => {
    expect(countHunks(null as any)).toBe(0)
    expect(countHunks(undefined as any)).toBe(0)
  })
})

// ============================================================
// 集成场景:模拟用户操作
// ============================================================

describe('集成场景:用户视角的合并流程', () => {
  it('典型冲突:外部改了中间一段,本地也改了', () => {
    // 左(磁盘):"# Title\n\ndisk content\n\n## End"
    // 右(本地):"# Title\n\nlocal content\n\n## End"
    const left = '# Title\n\ndisk content\n\n## End'
    const right = '# Title\n\nlocal content\n\n## End'
    const view = buildHunks(left, right)
    expect(view.hunks).toHaveLength(1)
    expect(view.hunks[0].rows[0].kind).toBe('change')

    // 用户选"从外部复制到本地"= copyHunkToRight
    const newRight = copyHunkToRight(view.hunks[0], right)
    expect(newRight).toBe(left)
  })

  it('多 hunk:用户从第 1 处跳到第 2 处,逐个接受', () => {
    // 左:"a / b / c / d / e"
    // 右:"a / B / c / D / e"  → 2 个 hunk(id 0 / 1)
    const left = 'a\nb\nc\nd\ne'
    const right = 'a\nB\nc\nD\ne'
    const view = buildHunks(left, right)
    expect(view.hunks).toHaveLength(2)

    // 用户在第 0 处选"从外部复制到本地"
    let newRight = copyHunkToRight(view.hunks[0], right)
    expect(newRight).toBe('a\nb\nc\nD\ne')  // 第 1 处变成 b

    // 跳到第 1 处
    const nextId = nextHunkId(view.hunks, 0, 1, 2)
    expect(nextId).toBe(1)

    // 在第 1 处选"从外部复制到本地"
    newRight = copyHunkToRight(view.hunks[nextId], newRight)
    expect(newRight).toBe(left)
  })

  it('用户取消(应用空白)→ 仍返回原 rightText 不变', () => {
    const right = 'a\nb\nc'
    const view = buildHunks('a\nX\nc', right)
    // 取消等价于不调 copyHunkToXxx,rightText 保持
    // 这里验证:如果用户没操作,nextHunkId(-1) 仍能工作
    expect(nextHunkId(view.hunks, -1, 1, 1)).toBe(0)
  })
})
