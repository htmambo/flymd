// @vitest-environment jsdom
// 测试 windowPlacement:覆盖 scaleFactor 兜底/ensureMinWindowSize 上下限/centerWindow 可见阈值
// 关注点:
// 1) getWindowScaleFactorSafe: Tauri 成功 / Tauri 失败 → dpr / 全部失败 → 1
// 2) ensureMinWindowSize: 偏小 → 调到 minW/minH
// 3) ensureMinWindowSize: 超过 virtual screen → 上限
// 4) ensureMinWindowSize: 在范围内 → 不调用 setSize
// 5) centerWindow: 窗口已可见 → 不调用 setPosition
// 6) centerWindow: 窗口几乎不可见 → 居中
// 7) centerWindow: 缺 currentMonitor → 用 screen * scaleFactor

import { describe, it, expect, vi } from 'vitest'
import { createWindowPlacement } from './windowPlacement'

function makeWin(overrides: any = {}): any {
  return {
    scaleFactor: vi.fn(async () => 1),
    innerSize: vi.fn(async () => ({ width: 1000, height: 700 })),
    outerPosition: vi.fn(async () => ({ x: 100, y: 100 })),
    outerSize: vi.fn(async () => ({ width: 800, height: 600 })),
    setSize: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('getWindowScaleFactorSafe', () => {
  it('returns 1 when Tauri and dpr both unavailable', async () => {
    const win = makeWin()
    win.scaleFactor = vi.fn(async () => { throw new Error('no tauri') })
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: undefined },
    })
    expect(await api.getWindowScaleFactorSafe()).toBe(1)
  })

  it('uses Tauri scaleFactor when available', async () => {
    const win = makeWin()
    win.scaleFactor = vi.fn(async () => 1.5)
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    expect(await api.getWindowScaleFactorSafe()).toBe(1.5)
  })

  it('rejects out-of-range scaleFactor and falls back to dpr', async () => {
    const win = makeWin()
    win.scaleFactor = vi.fn(async () => 0) // out of range
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 2 },
    })
    expect(await api.getWindowScaleFactorSafe()).toBe(2)
  })
})

describe('ensureMinWindowSize', () => {
  it('grows undersized window to 960x640 (logical) with scaleFactor 1', async () => {
    const win = makeWin()
    win.innerSize = vi.fn(async () => ({ width: 400, height: 200 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    await api.ensureMinWindowSize()
    expect(win.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 960, height: 640 }))
  })

  it('caps size to virtual screen maximum', async () => {
    const win = makeWin()
    win.innerSize = vi.fn(async () => ({ width: 5000, height: 3000 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async (cmd: string) => cmd === 'get_virtual_screen_size' ? { width: 2000, height: 1500 } : null,
      win: { devicePixelRatio: 1 },
    })
    await api.ensureMinWindowSize()
    expect(win.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 2000, height: 1500 }))
  })

  it('does not call setSize when size is already in range', async () => {
    const win = makeWin()
    win.innerSize = vi.fn(async () => ({ width: 1000, height: 700 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    await api.ensureMinWindowSize()
    expect(win.setSize).not.toHaveBeenCalled()
  })

  it('swallows errors silently (no throw)', async () => {
    const win = makeWin()
    win.innerSize = vi.fn(async () => { throw new Error('boom') })
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    await expect(api.ensureMinWindowSize()).resolves.toBeUndefined()
  })
})

describe('centerWindow', () => {
  it('does not call setPosition when window is visibly on screen', async () => {
    const win = makeWin()
    win.outerPosition = vi.fn(async () => ({ x: 100, y: 100 }))
    win.outerSize = vi.fn(async () => ({ width: 800, height: 600 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => ({
        workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
      }) as any,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    await api.centerWindow()
    expect(win.setPosition).not.toHaveBeenCalled()
  })

  it('centers window when off-screen', async () => {
    const win = makeWin()
    // x is way beyond workArea, so visibleEnough = false
    win.outerPosition = vi.fn(async () => ({ x: 5000, y: 5000 }))
    win.outerSize = vi.fn(async () => ({ width: 800, height: 600 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => ({
        workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
      }) as any,
      invoke: async () => null,
      win: { devicePixelRatio: 1 },
    })
    await api.centerWindow()
    expect(win.setPosition).toHaveBeenCalled()
    const call = win.setPosition.mock.calls[0][0]
    // centered around (1920/2, 1080/2) for an 800x600 window
    expect(call.x).toBe(560)
    expect(call.y).toBe(240)
  })

  it('falls back to screen * scaleFactor when currentMonitor returns null', async () => {
    const win = makeWin()
    win.outerPosition = vi.fn(async () => ({ x: 5000, y: 5000 }))
    const api = createWindowPlacement({
      getCurrentWindow: () => win,
      currentMonitor: async () => null,
      invoke: async () => null,
      win: { devicePixelRatio: 1, screen: { availWidth: 1920, availHeight: 1080, width: 1920, height: 1080 } },
    })
    await api.centerWindow()
    expect(win.setPosition).toHaveBeenCalled()
  })
})
