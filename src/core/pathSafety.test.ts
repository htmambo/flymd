import { describe, it, expect } from 'vitest'
import { assertSafeEntryName } from './pathSafety'

describe('assertSafeEntryName', () => {
  it('接受普通名字（含 Unicode / 空格 / 点）', () => {
    expect(assertSafeEntryName('note.md')).toBe('note.md')
    expect(assertSafeEntryName('新建文档 2.md')).toBe('新建文档 2.md')
    expect(assertSafeEntryName('.hidden')).toBe('.hidden')
    expect(assertSafeEntryName('a.b.c')).toBe('a.b.c')
  })

  it('拒绝穿越 / 分隔符 / 盘符 / 控制字符', () => {
    for (const bad of ['', '   ', '.', '..', '../x.md', 'a/b.md', 'a\\b.md', 'C:x', 'a:b', 'a\0b', 'a\nb']) {
      expect(() => assertSafeEntryName(bad), JSON.stringify(bad)).toThrow()
    }
  })
})
