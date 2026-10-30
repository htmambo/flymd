// @vitest-environment jsdom
// 测试 dotBlink 工厂:start/stop 状态机、idempotency、无 JS interval(闪烁由 CSS 动画驱动)
// 关注点:
// 1) start 后 isOn() === true
// 2) 多次 start idempotent(状态不变,不调度任何计时器)
// 3) stop 后 isOn() === false;未 start 时 stop 不抛
// 4) start → stop → start 复活
// 5) 全程零 setInterval/clearInterval 调用(空转 interval 已移除)
//
// perf 批次 I 追加：失焦时宿主打 .wysiwyg-blurred（CSS 侧据此暂停闪烁动画），
// 聚焦后移除；重复设置同状态幂等。

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('dotBlink 失焦暂停', () => {
  let host: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div class="container wysiwyg"></div>'
    host = document.querySelector('.container') as HTMLElement
  })

  it('初始不处于失焦状态', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    expect(api.isBlurred()).toBe(false)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(false)
  })

  it('setBlurred(true) 挂标记，setBlurred(false) 移除', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.setBlurred(true)
    expect(api.isBlurred()).toBe(true)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(true)
    api.setBlurred(false)
    expect(api.isBlurred()).toBe(false)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(false)
  })

  it('重复设置同状态保持幂等', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.setBlurred(true)
    api.setBlurred(true)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(true)
    expect(api.isBlurred()).toBe(true)
  })

  it('window blur 事件触发暂停', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.start()
    window.dispatchEvent(new Event('blur'))
    expect(api.isBlurred()).toBe(true)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(true)
    api.destroy()
  })

  it('window focus 事件恢复', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.start()
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    expect(api.isBlurred()).toBe(false)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(false)
    api.destroy()
  })

  it('停止状态下的 focus/blur 事件不改变状态、不残留标记', () => {
    // 用独立宿主：其它用例遗留的运行中实例监听的是共享宿主，不会影响这里
    const local = document.createElement('div')
    document.body.appendChild(local)
    const api = createDotBlink({ intervalMs: 800, getHost: () => local })
    api.start()
    api.stop()
    window.dispatchEvent(new Event('blur'))
    expect(api.isBlurred()).toBe(false)
    expect(local.classList.contains('wysiwyg-blurred')).toBe(false)
    api.destroy()
  })

  it('宿主缺失时不抛错', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => null })
    expect(() => api.setBlurred(true)).not.toThrow()
    expect(api.isBlurred()).toBe(true)
  })

  it('start/stop 语义保持不变（闪烁由 CSS 动画驱动）', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    expect(api.isOn()).toBe(true)
    api.stop()
    expect(api.isOn()).toBe(false)
    api.start()
    expect(api.isOn()).toBe(true)
  })

  it('stop() 清理宿主上的失焦标记（否则下次 start 时光标动画一直暂停）', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.setBlurred(true)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(true)
    api.stop()
    expect(host.classList.contains('wysiwyg-blurred')).toBe(false)
  })

  it('start() 补上先于 start() 发生的失焦（避免失焦期间切入所见模式漏挂标记）', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    window.dispatchEvent(new Event('blur'))
    api.start()
    expect(api.isBlurred()).toBe(true)
    expect(host.classList.contains('wysiwyg-blurred')).toBe(true)
    api.destroy()
  })

  it('destroy() 摘除全局监听，之后的 blur 不再改变状态', () => {
    const api = createDotBlink({ intervalMs: 800, getHost: () => host })
    api.start()
    api.destroy()
    window.dispatchEvent(new Event('blur'))
    expect(api.isBlurred()).toBe(false)
  })

  it('宿主被替换后，同状态调用仍会把标记搬到新宿主', () => {
    const hosts: HTMLElement[] = []
    const api = createDotBlink({ intervalMs: 800, getHost: () => hosts[hosts.length - 1] || null })
    const h1 = document.createElement('div')
    hosts.push(h1)
    api.setBlurred(true)
    expect(h1.classList.contains('wysiwyg-blurred')).toBe(true)
    const h2 = document.createElement('div')
    hosts.push(h2)
    api.setBlurred(true)
    expect(h2.classList.contains('wysiwyg-blurred')).toBe(true)
  })
})
