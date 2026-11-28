// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}))

import { stripEmptySvgSizeAttrs } from './mermaid'

describe('stripEmptySvgSizeAttrs', () => {
  it('移除空的 width / height 属性', () => {
    expect(stripEmptySvgSizeAttrs('<svg width="" height="">x</svg>')).toBe('<svg>x</svg>')
    expect(stripEmptySvgSizeAttrs("<svg width='' height=''>x</svg>")).toBe('<svg>x</svg>')
    expect(stripEmptySvgSizeAttrs('<svg width = "" >x</svg>')).toBe('<svg >x</svg>')
  })

  it('保留有效尺寸', () => {
    const m = '<svg width="100%" height="40"><rect width="" height="0"/></svg>'
    expect(stripEmptySvgSizeAttrs(m)).toBe('<svg width="100%" height="40"><rect height="0"/></svg>')
  })

  it('空输入安全', () => {
    expect(stripEmptySvgSizeAttrs('')).toBe('')
    expect(stripEmptySvgSizeAttrs(undefined as any)).toBe('')
  })
})
