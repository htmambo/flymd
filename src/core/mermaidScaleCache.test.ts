// Mermaid 缩放 / 缓存开关的 localStorage 缓存一致性
//
// 渲染路径每张图都读一次缩放：必须走 lsGetStringCached，且写入方必须用
// lsSetStringCached（同窗口 setItem 不会触发 storage 事件，缓存不会自己失效）。

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

import { getMermaidScale, setMermaidScaleClamped, isMermaidCacheDisabled } from './mermaid'
import { lsRemoveCached, lsSetStringCached } from './lsCache'

const SCALE_KEY = 'flymd:mermaidScale'
const DISABLE_KEY = 'flymd:disableMermaidCache'

beforeEach(() => {
  lsRemoveCached(SCALE_KEY)
  lsRemoveCached(DISABLE_KEY)
})

describe('getMermaidScale', () => {
  it('读取已持久化的缩放值', () => {
    lsRemoveCached(SCALE_KEY)
    localStorage.setItem(SCALE_KEY, '1.25')
    expect(getMermaidScale()).toBe(1.25)
  })

  it('同窗口写入后立即读到新值（不依赖 storage 事件）', () => {
    setMermaidScaleClamped(2.5)
    expect(getMermaidScale()).toBe(2.5)
    expect(localStorage.getItem(SCALE_KEY)).toBe('2.5')
  })

  it('非法值回落到默认 0.75', () => {
    lsSetStringCached(SCALE_KEY, 'not-a-number')
    expect(getMermaidScale()).toBe(0.75)
  })

  it('超出范围的持久化值同样回落', () => {
    lsSetStringCached(SCALE_KEY, '12')
    expect(getMermaidScale()).toBe(0.75)
  })
})

describe('isMermaidCacheDisabled', () => {
  it('同窗口切换开关即时生效', () => {
    expect(isMermaidCacheDisabled()).toBe(false)
    lsSetStringCached(DISABLE_KEY, '1')
    expect(isMermaidCacheDisabled()).toBe(true)
    lsSetStringCached(DISABLE_KEY, '0')
    expect(isMermaidCacheDisabled()).toBe(false)
  })
})
