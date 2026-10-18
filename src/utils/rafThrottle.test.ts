// @vitest-environment jsdom
// 测试 createRafThrottle:leading 立即执行、同帧多次调用合并为一次 trailing 补发(最新参数)、cancel 语义
// 用 fake timers 接管 requestAnimationFrame,16ms 推一帧

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRafThrottle } from './rafThrottle'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRafThrottle', () => {
  it('executes the leading call immediately', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    t('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('a')
  })

  it('collapses same-frame calls into one trailing invocation with the latest args', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    t(1); t(2); t(3)
    // 一帧内只执行一次(leading)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(16)
    // trailing 补发一次,用最新参数
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)
  })

  it('runs at most once per frame under continuous calls', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    for (let f = 0; f < 10; f++) {
      t(f)
      vi.advanceTimersByTime(16)
    }
    expect(fn).toHaveBeenCalledTimes(10)
    expect(fn).toHaveBeenLastCalledWith(9)
  })

  it('executes the next leading call immediately after the trailing frame fired', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    t(1); t(2)
    vi.advanceTimersByTime(16)
    expect(fn).toHaveBeenCalledTimes(2)
    t(3)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith(3)
  })

  it('cancel() drops the pending trailing frame', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    t(1); t(2)
    t.cancel()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
  })

  it('cancel() with no pending frame is a no-op', () => {
    const fn = vi.fn()
    const t = createRafThrottle(fn)
    expect(() => t.cancel()).not.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })
})
