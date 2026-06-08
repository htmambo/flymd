// @vitest-environment jsdom
// 测试 dotBlink 工厂:start/stop 状态机、idempotency、intervalMs 生效
// 关注点:
// 1) start 后 timer 不为 null
// 2) 多次 start idempotent(早返,不创建新 timer)
// 3) stop 后 timer 清理,on=false
// 4) start → stop → start 复活
// 5) intervalMs 注入生效(fast interval 用 fake timers 验证)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDotBlink } from './dotBlink'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createDotBlink', () => {
  it('start() sets timer and on=true', () => {
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    expect(api.isOn()).toBe(true)
    api.stop()
  })

  it('start() is idempotent: second call does not create a new timer', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.start()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    api.stop()
    setIntervalSpy.mockRestore()
  })

  it('stop() clears timer and sets on=false', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.stop()
    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(api.isOn()).toBe(false)
    clearIntervalSpy.mockRestore()
  })

  it('stop() when not started is a no-op (no throw)', () => {
    const api = createDotBlink({ intervalMs: 800 })
    expect(() => api.stop()).not.toThrow()
    expect(api.isOn()).toBe(false)
  })

  it('intervalMs injection: fast interval flips on state', () => {
    const api = createDotBlink({ intervalMs: 100 })
    api.start()
    expect(api.isOn()).toBe(true)
    vi.advanceTimersByTime(100)
    expect(api.isOn()).toBe(false)
    vi.advanceTimersByTime(100)
    expect(api.isOn()).toBe(true)
    api.stop()
  })

  it('start() after stop() resurrects the timer', () => {
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.stop()
    expect(api.isOn()).toBe(false)
    api.start()
    expect(api.isOn()).toBe(true)
    api.stop()
  })
})
