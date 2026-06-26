// @vitest-environment jsdom
// 测试 bindWindowMaximizedState 的简化版本:
// - 不再订阅 onResized / flymd://window-maximized-changed
// - 只在初始化时调一次 isMaximized 做 baseline
// - 公开 API syncNow 仍可用于点按钮后主动刷新

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bindWindowMaximizedState } from './maximizedState'

interface FakeWin {
  isMaximized: ReturnType<typeof vi.fn>
  onResized: ReturnType<typeof vi.fn>
  listen: ReturnType<typeof vi.fn>
}

function makeWin(opts: { initialMaximized?: boolean; isMaximizedImpl?: () => Promise<boolean> } = {}) {
  const isMaximized = vi.fn(opts.isMaximizedImpl ?? (async () => opts.initialMaximized ?? false))
  const win: FakeWin = {
    isMaximized,
    onResized: vi.fn(async () => () => undefined),
    listen: vi.fn(async () => () => undefined),
  }
  return win
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bindWindowMaximizedState (simplified)', () => {
  it('initially calls isMaximized exactly once for baseline', async () => {
    const win = makeWin({ initialMaximized: false })
    const apply = vi.fn()
    await bindWindowMaximizedState(() => win, apply)
    expect(win.isMaximized).toHaveBeenCalledTimes(1)
    expect(win.onResized).not.toHaveBeenCalled()
    expect(win.listen).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledWith(false)
  })

  it('does NOT subscribe onResized (Tauri #13199 mitigation)', async () => {
    const win = makeWin({ initialMaximized: false })
    await bindWindowMaximizedState(() => win, vi.fn())
    expect(win.onResized).not.toHaveBeenCalled()
  })

  it('does NOT listen to flymd://window-maximized-changed', async () => {
    const win = makeWin({ initialMaximized: false })
    await bindWindowMaximizedState(() => win, vi.fn())
    expect(win.listen).not.toHaveBeenCalled()
  })

  it('syncNow can be called externally to refresh state', async () => {
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

  it('dispose prevents further state changes', async () => {
    const win = makeWin({ initialMaximized: false })
    const apply = vi.fn()
    const binding = await bindWindowMaximizedState(() => win, apply)
    binding.dispose()

    await binding.syncNow()
    // disposed 后 apply 不应被调
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
