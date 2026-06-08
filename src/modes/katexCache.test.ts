// @vitest-environment node
// 测试 katexCache 工厂:缓存命中/未命中、容量上限、清空、长度阈值
// 关注点:
// 1) 第一次 render 调用 mod.renderToString 并写入缓存
// 2) 相同 key 第二次调用不调用 mod,直接返 hit
// 3) 不同 displayMode (B/I) 视为不同 key
// 4) 大于 maxLen 的公式不缓存(永远调 mod)
// 5) 容量到达 max 时清空再写入
// 6) 空字符串不缓存

import { describe, it, expect, vi } from 'vitest'
import { createKatexCache } from './katexCache'

function makeFakeKatex() {
  return {
    default: {
      renderToString: vi.fn((src: string, opts: any) =>
        `<span data-latex="${src}" data-display="${opts.displayMode}"></span>`
      ),
    },
  }
}

describe('createKatexCache', () => {
  it('calls mod.renderToString and caches on first call', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 100 })
    const out = api.renderCached(mod, 'a+b', false)
    expect(out).toBe('<span data-latex="a+b" data-display="false"></span>')
    expect(mod.default.renderToString).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on second call with same key', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 100 })
    api.renderCached(mod, 'a+b', false)
    api.renderCached(mod, 'a+b', false)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(1)
  })

  it('treats displayMode true/false as separate keys', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 100 })
    api.renderCached(mod, 'a+b', false)
    api.renderCached(mod, 'a+b', true)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(2)
  })

  it('does not cache when latex length > maxLen', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 5 })
    const big = 'x'.repeat(10)
    api.renderCached(mod, big, false)
    api.renderCached(mod, big, false)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(2)
  })

  it('does not cache empty string', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 100 })
    api.renderCached(mod, '', false)
    api.renderCached(mod, '', false)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(2)
  })

  it('clears cache when size reaches max', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 2, maxLen: 100 })
    api.renderCached(mod, 'a', false)
    api.renderCached(mod, 'b', false)
    // 现在 size=2,再次写入应触发 clear
    api.renderCached(mod, 'c', false)
    // 'a' 的 hit 不应存在(被清空),再调一次 'a' 应再调 mod
    api.renderCached(mod, 'a', false)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(4)
  })

  it('treats empty string as falsy (no cache)', () => {
    const mod = makeFakeKatex()
    const api = createKatexCache({ max: 10, maxLen: 100 })
    api.renderCached(mod, '', false)
    api.renderCached(mod, '', false)
    expect(mod.default.renderToString).toHaveBeenCalledTimes(2)
  })
})
