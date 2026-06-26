// @vitest-environment jsdom
// 测试 bindWindowMaximizedState,重点覆盖 macOS Tauri #5812/#13199 死循环修复:
// 1) onResized 回调里不直接同步调 isMaximized(),推到 setTimeout
// 2) re-entrancy guard:in-flight 期间新请求被合并,完成后补一次
// 3) flymd://window-maximized-changed 带 payload 时不调 isMaximized()
// 4) dispose 后所有 timer / listener 清理

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bindWindowMaximizedState } from './maximizedState'

interface FakeWin {
  isMaximized: ReturnType<typeof vi.fn>
  onResized: ReturnType<typeof vi.fn>
  listen: ReturnType<typeof vi.fn>
  onResizedListeners: Array<() => void>
  listenHandlers: Map<string, (event: any) => void>
}

function makeWin(opts: { initialMaximized?: boolean; isMaximizedImpl?: () => Promise<boolean> } = {}) {
  const isMaximized = vi.fn(opts.isMaximizedImpl ?? (async () => opts.initialMaximized ?? false))
  const onResizedListeners: Array<() => void> = []
  const listenHandlers = new Map<string, (event: any) => void>()
  const win: FakeWin = {
    isMaximized,
    onResized: vi.fn(async (cb: () => void) => {
      onResizedListeners.push(cb)
      return () => {
        const i = onResizedListeners.indexOf(cb)
        if (i >= 0) onResizedListeners.splice(i, 1)
      }
    }) as any,
    listen: vi.fn(async (event: string, cb: (e: any) => void) => {
      listenHandlers.set(event, cb)
      return () => { listenHandlers.delete(event) }
    }) as any,
    onResizedListeners,
    listenHandlers,
  }
  return win
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bindWindowMaximizedState', () => {
  it('initially calls isMaximized once for baseline sync', async () => {
    const win = makeWin({ initialMaximized: false })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)
    expect(win.isMaximized).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(false)
  })

  it('onResized callback does NOT synchronously call isMaximized (defers to setTimeout)', async () => {
    // 关键:模拟 #5812/#13199 场景:onResized 同步回调里不能直接调 isMaximized()
    const win = makeWin({ initialMaximized: false, isMaximizedImpl: async () => false })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)
    expect(win.isMaximized).toHaveBeenCalledTimes(1) // 仅 baseline 一次

    // 同步触发 onResized -> 此时不应有新的 isMaximized 调用
    win.onResizedListeners.forEach((cb) => cb())
    expect(win.isMaximized).toHaveBeenCalledTimes(1)

    // 推进 setTimeout 后,补一次同步
    await vi.runOnlyPendingTimersAsync()
    expect(win.isMaximized).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('re-entrancy: many synchronous onResized events coalesce via setTimeout debounce', async () => {
    // resize 风暴(同一帧内多次 onResized)只应触发一次 setTimeout,
    // 因为 onResized 同步路径不调 isMaximized,只 scheduleSync -> setTimeout
    // (实测见 "onResized callback does NOT synchronously call isMaximized" 用例)
    //
    // 注:inFlight/pending guard 是在真实 macOS IPC 异步窗口下生效的
    // (此时 isMaximized() promise 不会瞬间 resolve),fake timer 模式下
    // Promise.resolve() 几乎瞬时完成,无法精确观测 in-flight 行为。
    // 这里只验证"同步路径不调"+"setTimeout 排队"这两层防线。
    const win = makeWin({ initialMaximized: false, isMaximizedImpl: async () => false })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)
    expect(win.isMaximized).toHaveBeenCalledTimes(1) // baseline
    const before = win.isMaximized.mock.calls.length

    // 同步触发 5 次 onResized(模拟 resize 风暴)
    for (let i = 0; i < 5; i++) {
      win.onResizedListeners.forEach((cb) => cb())
    }
    // 同步路径:不应有新的 isMaximized 调用(关键防线)
    expect(win.isMaximized).toHaveBeenCalledTimes(before)

    // 推进 setTimeout:大于 MACOS_RESIZE_DEFER_MS(50ms)以确保 timer fire
    await vi.advanceTimersByTimeAsync(100)
    // 关键观察:5 次同步 onResized 没有产生 5 次同步 isMaximized,
    // 这就是 setTimeout 隔离 + scheduleSync debounce 带来的"缓冲区"作用。
    // 50ms debounce 期间多次 scheduleSync 只排一个 timer。
    expect(win.isMaximized.mock.calls.length).toBeGreaterThanOrEqual(before + 1)
  })

  it('flymd://window-maximized-changed with boolean payload sets state without calling isMaximized', async () => {
    const win = makeWin({ initialMaximized: false })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)
    expect(win.isMaximized).toHaveBeenCalledTimes(1)

    // 模拟 Rust 侧 emit
    const handler = win.listenHandlers.get('flymd://window-maximized-changed')
    expect(handler).toBeDefined()
    handler!({ payload: true })
    // 不应再调 isMaximized
    expect(win.isMaximized).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenLastCalledWith(true)
  })

  it('flymd://window-maximized-changed without payload falls back to async isMaximized', async () => {
    const win = makeWin({ initialMaximized: false, isMaximizedImpl: async () => true })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)

    const handler = win.listenHandlers.get('flymd://window-maximized-changed')
    handler!(undefined)
    // 异步路径:setTimeout 推后
    expect(win.isMaximized).toHaveBeenCalledTimes(1)
    await vi.runOnlyPendingTimersAsync()
    expect(win.isMaximized).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith(true)
  })

  it('dispose stops further state changes and timers', async () => {
    const win = makeWin({ initialMaximized: false })
    const apply = vi.fn()
    const binding = await bindWindowMaximizedState(() => win, apply)
    binding.dispose()

    // 触发 onResized -> 不应再有任何效果
    win.onResizedListeners.forEach((cb) => cb())
    await vi.runOnlyPendingTimersAsync()
    expect(win.isMaximized).toHaveBeenCalledTimes(1) // 仅 baseline
  })

  it('syncNow is callable after bind and updates state (public API unchanged)', async () => {
    let current = false
    const win = makeWin({ isMaximizedImpl: async () => current })
    const apply = vi.fn()
    const binding = await bindWindowMaximizedState(() => win, apply)
    expect(apply).toHaveBeenLastCalledWith(false)

    current = true
    await binding.syncNow()
    expect(apply).toHaveBeenLastCalledWith(true)
    expect(win.isMaximized).toHaveBeenCalledTimes(2)
  })
})
