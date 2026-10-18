// @vitest-environment jsdom
// 测试 dotBlink 工厂:start/stop 状态机、idempotency、无 JS interval(闪烁由 CSS 动画驱动)
// 关注点:
// 1) start 后 isOn() === true
// 2) 多次 start idempotent(状态不变,不调度任何计时器)
// 3) stop 后 isOn() === false;未 start 时 stop 不抛
// 4) start → stop → start 复活
// 5) 全程零 setInterval/clearInterval 调用(空转 interval 已移除)

import { describe, it, expect, vi } from 'vitest'
import { createDotBlink } from './dotBlink'

describe('createDotBlink', () => {
  it('start() sets on=true', () => {
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    expect(api.isOn()).toBe(true)
    api.stop()
  })

  it('start() is idempotent: repeated calls keep state and schedule no timers', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.start()
    api.start()
    expect(api.isOn()).toBe(true)
    expect(setIntervalSpy).not.toHaveBeenCalled()
    api.stop()
    setIntervalSpy.mockRestore()
  })

  it('stop() sets on=false and clears nothing (no timer to clear)', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.stop()
    expect(api.isOn()).toBe(false)
    expect(clearIntervalSpy).not.toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })

  it('stop() when not started is a no-op (no throw)', () => {
    const api = createDotBlink({ intervalMs: 800 })
    expect(() => api.stop()).not.toThrow()
    expect(api.isOn()).toBe(false)
  })

  it('start() after stop() resurrects the on state', () => {
    const api = createDotBlink({ intervalMs: 800 })
    api.start()
    api.stop()
    expect(api.isOn()).toBe(false)
    api.start()
    expect(api.isOn()).toBe(true)
    api.stop()
  })

  it('never schedules an interval across the full lifecycle', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const api = createDotBlink({ intervalMs: 100 })
    api.start()
    api.stop()
    api.start()
    api.stop()
    expect(setIntervalSpy).not.toHaveBeenCalled()
    setIntervalSpy.mockRestore()
  })
})
