// @vitest-environment jsdom
// 测试 windowResize:覆盖 computeResize 纯函数(8 方向 × 边界条件)+ init/stop 副作用
// 关注点:
// 1) computeResize right: newWidth 增长,不超 min
// 2) computeResize left: 同时减宽 + 移 x
// 3) computeResize corner-se: 双向扩
// 4) computeResize 越界 → 钳制到 min
// 5) init() 创建 8 个 handle,挂到 body
// 6) stop() 移除所有 listener + container

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWindowResize } from './windowResize'

function makeDeps(overrides: any = {}) {
  return {
    getCurrentWindow: overrides.getCurrentWindow ?? (() => ({})),
    bindWindowMaximizedState: overrides.bindWindowMaximizedState ?? (async () => () => undefined),
    getWindowScaleFactorSafe: overrides.getWindowScaleFactorSafe ?? (async () => 1),
    isTauriRuntime: overrides.isTauriRuntime ?? (() => false),
    document: overrides.document,
    win: overrides.win,
  }
}

describe('computeResize', () => {
  const api = createWindowResize(makeDeps())

  it('right edge: grows width by deltaX', () => {
    const r = api.computeResize({
      direction: 'right',
      startWidth: 1000, startHeight: 800, startPosX: 0, startPosY: 0,
      deltaX: 200, deltaY: 0, scaleFactor: 1,
    })
    expect(r.newWidth).toBe(1200)
    expect(r.newHeight).toBe(800)
    expect(r.newX).toBe(0)
    expect(r.newY).toBe(0)
  })

  it('left edge: grows width and shifts x', () => {
    const r = api.computeResize({
      direction: 'left',
      startWidth: 1000, startHeight: 800, startPosX: 500, startPosY: 0,
      deltaX: -100, deltaY: 0, scaleFactor: 1,
    })
    expect(r.newWidth).toBe(1100)
    expect(r.newX).toBe(400)
  })

  it('corner-se: grows both width and height', () => {
    const r = api.computeResize({
      direction: 'corner-se',
      startWidth: 1000, startHeight: 800, startPosX: 0, startPosY: 0,
      deltaX: 50, deltaY: 100, scaleFactor: 1,
    })
    expect(r.newWidth).toBe(1050)
    expect(r.newHeight).toBe(900)
  })

  it('clamps to min width on left resize (no shrink below min)', () => {
    const r = api.computeResize({
      direction: 'left',
      startWidth: 700, startHeight: 800, startPosX: 100, startPosY: 0,
      deltaX: 500, deltaY: 0, scaleFactor: 1, // grow by 500, but min 600 reached
    })
    // widthDelta = min(500, 700-600) = 100
    expect(r.newWidth).toBe(600)
    expect(r.newX).toBe(200)
  })

  it('top edge: grows height and shifts y', () => {
    const r = api.computeResize({
      direction: 'top',
      startWidth: 1000, startHeight: 800, startPosX: 0, startPosY: 200,
      deltaX: 0, deltaY: -50, scaleFactor: 1,
    })
    expect(r.newHeight).toBe(850)
    expect(r.newY).toBe(150)
  })

  it('corner-nw: grows both and shifts x+y', () => {
    const r = api.computeResize({
      direction: 'corner-nw',
      startWidth: 1000, startHeight: 800, startPosX: 100, startPosY: 200,
      deltaX: -50, deltaY: -80, scaleFactor: 1,
    })
    expect(r.newWidth).toBe(1050)
    expect(r.newHeight).toBe(880)
    expect(r.newX).toBe(50)
    expect(r.newY).toBe(120)
  })

  it('respects scaleFactor in min calculation', () => {
    const r = api.computeResize({
      direction: 'right',
      startWidth: 1200, startHeight: 800, startPosX: 0, startPosY: 0,
      deltaX: -1000, deltaY: 0, scaleFactor: 2, // min = 1200, can't shrink
    })
    // 1200 + (-1000) = 200, but min is 1200
    expect(r.newWidth).toBe(1200)
  })
})

describe('init / stop', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.className = 'no-native-decorations'
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('init() creates 8 handles under .window-resize-handles', () => {
    const api = createWindowResize(makeDeps())
    api.init()
    const containers = document.querySelectorAll('.window-resize-handles')
    expect(containers.length).toBe(1)
    const handles = containers[0].querySelectorAll('.window-resize-handle')
    expect(handles.length).toBe(8)
    const dirs = Array.from(handles).map((h: any) => h.dataset.resizeDir).sort()
    expect(dirs).toEqual(['bottom', 'corner-ne', 'corner-nw', 'corner-se', 'corner-sw', 'left', 'right', 'top'])
  })

  it('stop() removes container and listeners', () => {
    const api = createWindowResize(makeDeps())
    api.init()
    expect(document.querySelector('.window-resize-handles')).toBeTruthy()
    api.stop()
    expect(document.querySelector('.window-resize-handles')).toBeNull()
  })

  it('stop() is idempotent and safe on second call', () => {
    const api = createWindowResize(makeDeps())
    api.init()
    api.stop()
    expect(() => api.stop()).not.toThrow()
  })
})
