// mermaid SVG 缓存字节记账测试（D2 / P2-16）
//
// 覆盖：
// - 插入的字节记账（code.length + svg.length 代理）
// - 同 code 替换按差值记账（不重复累计）
// - 条数上限（300）仍生效且与字节上限并存
// - 字节上限按 LRU 序淘汰最旧条目；刚插入的条目永不被淘汰
// - LRU 访问（getCachedMermaidSvg）不改变字节量
// - invalidateMermaidSvgCache 清零字节计数

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => null),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
}))

import * as mermaidMod from './mermaid'

const { mermaidSvgCache, cacheMermaidSvg, getCachedMermaidSvg, invalidateMermaidSvgCache } = mermaidMod

const bytesOf = (code: string, svg: string) => code.length + svg.length

beforeEach(() => {
  try { localStorage.removeItem('flymd:disableMermaidCache') } catch {}
  invalidateMermaidSvgCache('test-reset')
  mermaidMod._setMermaidCacheMaxBytesForTest(null)
})

describe('mermaidSvgCache 字节记账', () => {
  it('插入按 code + svg 长度累计', () => {
    cacheMermaidSvg('code-a', '<svg>a</svg>', 'id1')
    cacheMermaidSvg('code-b', '<svg>bb</svg>', 'id2')
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(
      bytesOf('code-a', '<svg>a</svg>') + bytesOf('code-b', '<svg>bb</svg>'),
    )
    expect(mermaidSvgCache.size).toBe(2)
  })

  it('同 code 替换按差值记账（先扣旧再加新）', () => {
    cacheMermaidSvg('code-a', '<svg id="id1">short</svg>', 'id1')
    const before = mermaidMod.mermaidSvgCacheBytes
    cacheMermaidSvg('code-a', '<svg id="id2">much-longer-svg</svg>', 'id2')
    expect(mermaidSvgCache.size).toBe(1)
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(
      before - '<svg id="id1">short</svg>'.length + '<svg id="id2">much-longer-svg</svg>'.length,
    )
    // ID 替换行为不受字节记账影响：旧 renderId 换成 desired
    expect(getCachedMermaidSvg('code-a', 'desired')).toContain('desired')
  })

  it('LRU 访问不改变字节量', () => {
    cacheMermaidSvg('code-a', '<svg>a</svg>', 'id1')
    cacheMermaidSvg('code-b', '<svg>b</svg>', 'id2')
    const before = mermaidMod.mermaidSvgCacheBytes
    expect(getCachedMermaidSvg('code-a', 'x')).toBeTruthy()
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(before)
  })

  it('字节上限按 LRU 序淘汰最旧条目，刚插入的条目永不淘汰', () => {
    mermaidMod._setMermaidCacheMaxBytesForTest(20)
    // A: 6+10=16；B: 6+12=18 → 34 > 20 → 淘汰 A，剩 B(18) 仍 > 20 但 size==1 → 保留
    cacheMermaidSvg('code-a', '<svg>aaaaaa</svg>', 'id-a')
    cacheMermaidSvg('code-b', '<svg>bbbbbbbb</svg>', 'id-b')
    expect(mermaidSvgCache.has('code-a')).toBe(false)
    expect(mermaidSvgCache.has('code-b')).toBe(true)
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(bytesOf('code-b', '<svg>bbbbbbbb</svg>'))
    // 再插 C(6+4=10) → 28 > 20 → 淘汰 B，剩 C
    cacheMermaidSvg('code-c', '<svg>c</svg>', 'id-c')
    expect(mermaidSvgCache.has('code-b')).toBe(false)
    expect(mermaidSvgCache.has('code-c')).toBe(true)
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(bytesOf('code-c', '<svg>c</svg>'))
  })

  it('条数上限（300）与字节上限并存', () => {
    for (let i = 0; i < 302; i++) {
      cacheMermaidSvg(`code-${String(i).padStart(3, '0')}`, `<svg>${i}</svg>`, `id-${i}`)
    }
    expect(mermaidSvgCache.size).toBe(300)
    expect(mermaidSvgCache.has('code-000')).toBe(false) // 最旧被条数上限淘汰
    expect(mermaidSvgCache.has('code-301')).toBe(true)
  })

  it('invalidateMermaidSvgCache 清空并清零字节计数', () => {
    cacheMermaidSvg('code-a', '<svg>a</svg>', 'id1')
    expect(mermaidMod.mermaidSvgCacheBytes).toBeGreaterThan(0)
    invalidateMermaidSvgCache('unit')
    expect(mermaidSvgCache.size).toBe(0)
    expect(mermaidMod.mermaidSvgCacheBytes).toBe(0)
  })
})
