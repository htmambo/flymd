/**
 * docPresenceScan 单元测试
 *
 * 覆盖：
 * - normalizeWatchPaths：反斜杠归一、尾斜杠去除、去重保序、空/非字符串跳过
 * - pathsToInvalidatePrefixes：自身 + 祖先链、去重、长度降序、驱动器根截断、文件系统根跳过
 * - resolveDocPresenceRefresh：无路径上下文 / >64 降级全扫 / ≤64 增量 / 标脏兜底（64 vs 65 边界锁定）
 * - docPresenceHintSetsEqual：集合一致性比较
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeWatchPaths,
  pathsToInvalidatePrefixes,
  resolveDocPresenceRefresh,
  docPresenceHintSetsEqual,
  WATCH_INVALIDATE_FULL_SCAN_THRESHOLD,
} from './docPresenceScan'

describe('normalizeWatchPaths', () => {
  it('反斜杠 → 正斜杠', () => {
    expect(normalizeWatchPaths(['C:\\Users\\foo\\a.md'])).toEqual(['C:/Users/foo/a.md'])
    expect(normalizeWatchPaths(['a\\b\\c'])).toEqual(['a/b/c'])
    expect(normalizeWatchPaths(['C:\\Users/foo\\bar'])).toEqual(['C:/Users/foo/bar'])
  })

  it('去尾斜杠（普通路径），根路径与驱动器根保留', () => {
    expect(normalizeWatchPaths(['/a/b/c/'])).toEqual(['/a/b/c'])
    expect(normalizeWatchPaths(['/a/b/c///'])).toEqual(['/a/b/c'])
    expect(normalizeWatchPaths(['/'])).toEqual(['/'])
    expect(normalizeWatchPaths(['C:/'])).toEqual(['C:'])
    expect(normalizeWatchPaths(['C:\\'])).toEqual(['C:'])
  })

  it('去重（归一后相等即去重）且保序', () => {
    expect(normalizeWatchPaths(['/a/b/', '/a\\b', '/a/b'])).toEqual(['/a/b'])
    expect(normalizeWatchPaths(['/x', '/y', '/x/', '/z'])).toEqual(['/x', '/y', '/z'])
  })

  it('空串与非字符串条目跳过', () => {
    expect(normalizeWatchPaths(['', '/a', null as any, undefined as any, 42 as any])).toEqual(['/a'])
    expect(normalizeWatchPaths([])).toEqual([])
    expect(normalizeWatchPaths(null as any)).toEqual([])
  })
})

describe('pathsToInvalidatePrefixes', () => {
  it('单文件：自身 + 全部祖先目录', () => {
    expect(pathsToInvalidatePrefixes(['/a/b/c.md'])).toEqual(['/a/b/c.md', '/a/b', '/a'])
  })

  it('多级深层路径完整祖先链', () => {
    expect(pathsToInvalidatePrefixes(['/lib/x/y/z/w.md'])).toEqual([
      '/lib/x/y/z/w.md', '/lib/x/y/z', '/lib/x/y', '/lib/x', '/lib',
    ])
  })

  it('Windows 路径：驱动器根截断（C: 不作为祖先，避免退化为全清）', () => {
    expect(pathsToInvalidatePrefixes(['C:/lib/a/b.md'])).toEqual(['C:/lib/a/b.md', 'C:/lib/a', 'C:/lib'])
    expect(pathsToInvalidatePrefixes(['C:\\lib\\a\\b.md'])).toEqual(['C:/lib/a/b.md', 'C:/lib/a', 'C:/lib'])
  })

  it('文件系统根 / 不作为祖先输出', () => {
    expect(pathsToInvalidatePrefixes(['/a.md'])).toEqual(['/a.md'])
    expect(pathsToInvalidatePrefixes(['/a/b.md'])).toEqual(['/a/b.md', '/a'])
  })

  it('多条路径：并集去重', () => {
    expect(pathsToInvalidatePrefixes(['/a/b/c.md', '/a/b/d.md'])).toEqual([
      '/a/b/c.md', '/a/b/d.md', '/a/b', '/a',
    ])
  })

  it('祖先链覆盖另一条路径：归一去重', () => {
    expect(pathsToInvalidatePrefixes(['/a/b', '/a/b/c.md'])).toEqual(['/a/b/c.md', '/a/b', '/a'])
  })

  it('输出按长度降序（子代在前）', () => {
    const out = pathsToInvalidatePrefixes(['/a/b/c.md', '/a/b.md'])
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].length).toBeGreaterThanOrEqual(out[i].length)
    }
    expect(out[0]).toBe('/a/b/c.md')
  })

  it('先归一再展开祖先（反斜杠/尾斜杠输入）', () => {
    expect(pathsToInvalidatePrefixes(['/a\\b\\c.md/'])).toEqual(['/a/b/c.md', '/a/b', '/a'])
  })

  it('UNC 路径：文件系统根 / 不作为祖先输出（防退化为整树失效）', () => {
    expect(pathsToInvalidatePrefixes(['//server/share/x.md'])).toEqual([
      '//server/share/x.md', '//server/share', '//server',
    ])
  })

  it('事件路径恰为驱动器根：仅自身，不展开', () => {
    expect(pathsToInvalidatePrefixes(['C:/'])).toEqual(['C:'])
    expect(pathsToInvalidatePrefixes(['C:'])).toEqual(['C:'])
  })
})

describe('resolveDocPresenceRefresh（阈值边界 64 vs 65）', () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `/lib/f${i}.md`)

  it('无路径上下文 → full-scan', () => {
    expect(resolveDocPresenceRefresh(null).kind).toBe('full-scan')
    expect(resolveDocPresenceRefresh(undefined).kind).toBe('full-scan')
    expect(resolveDocPresenceRefresh([]).kind).toBe('full-scan')
  })

  it('归一后去重为空 → full-scan', () => {
    expect(resolveDocPresenceRefresh(['', null as any]).kind).toBe('full-scan')
  })

  it('64 条（边界内）→ incremental', () => {
    const s = resolveDocPresenceRefresh(paths(64))
    expect(s.kind).toBe('incremental')
    expect(WATCH_INVALIDATE_FULL_SCAN_THRESHOLD).toBe(64)
  })

  it('65 条（边界外）→ full-scan', () => {
    expect(resolveDocPresenceRefresh(paths(65)).kind).toBe('full-scan')
  })

  it('重复路径去重后计入阈值（65 条去重成 64 → incremental）', () => {
    const dup = [...paths(64), '/lib/f0.md']
    expect(dup.length).toBe(65)
    expect(resolveDocPresenceRefresh(dup).kind).toBe('incremental')
  })

  it('标脏 → full-scan（即使有路径上下文）', () => {
    expect(resolveDocPresenceRefresh(['/lib/a.md'], { dirty: true }).kind).toBe('full-scan')
  })

  it('incremental 携带祖先链前缀集合', () => {
    const s = resolveDocPresenceRefresh(['/lib/a/b.md'])
    expect(s).toEqual({ kind: 'incremental', prefixes: ['/lib/a/b.md', '/lib/a', '/lib'] })
  })
})

describe('docPresenceHintSetsEqual', () => {
  it('相等 / 不等', () => {
    expect(docPresenceHintSetsEqual(new Set(['/a', '/b']), new Set(['/a', '/b']))).toBe(true)
    expect(docPresenceHintSetsEqual(new Set(['/a']), new Set(['/a', '/b']))).toBe(false)
    expect(docPresenceHintSetsEqual(new Set(['/a', '/b']), new Set(['/a', '/c']))).toBe(false)
    expect(docPresenceHintSetsEqual(new Set(), new Set())).toBe(true)
  })

  it('兼容 Map（预扫描缓存按 key 集合比较）', () => {
    const a = new Map([['/a', true], ['/b', true]])
    const b = new Map([['/b', true], ['/a', true]])
    const c = new Map([['/a', true]])
    expect(docPresenceHintSetsEqual(a, b)).toBe(true)
    expect(docPresenceHintSetsEqual(a, c)).toBe(false)
  })
})
