// @vitest-environment jsdom
// 测试 windowResize:覆盖 computeResize 纯函数(8 方向 × 边界条件)+ init/stop 副作用
// 关注点:
// 1) computeResize right: newWidth 增长,不超 min
// 2) computeResize left: 同时减宽 + 移 x
// 3) computeResize corner-se: 双向扩
// 4) computeResize 越界 → 钳制到 min
// 5) init() 创建 8 个 handle,挂到 body
// 6) stop() 移除所有 listener + container

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWindowResize } from './windowResize'

// 可控 rAF 队列:实现里把一次手势内的多次 mousemove 合并成"一帧一次 setSize",
// 测试需要能精确推进帧,否则无法断言"合并了几次"。
let rafSeq = 0
const rafPending = new Map<number, (t: number) => void>()
function flushRaf(): void {
  const entries = Array.from(rafPending.entries())
  rafPending.clear()
  for (const [, cb] of entries) cb(0)
}

function makeDeps(overrides: any = {}) {
  return {
    getCurrentWindow: overrides.getCurrentWindow ?? (() => ({})),
    bindWindowMaximizedState: overrides.bindWindowMaximizedState ?? (async () => () => undefined),
    getWindowScaleFactorSafe: overrides.getWindowScaleFactorSafe ?? (async () => 1),
    isTauriRuntime: overrides.isTauriRuntime ?? (() => false),
    document: overrides.document,
    win: overrides.win,
    isLinux: overrides.isLinux,
    sleep: overrides.sleep,
    raf: overrides.raf ?? ((cb: (t: number) => void) => {
      const id = ++rafSeq
      rafPending.set(id, cb)
      return id
    }),
    cancelRaf: overrides.cancelRaf ?? ((id: any) => { rafPending.delete(id) }),
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

// Linux resize 双路径(原生合成器 + 手动兜底):
//   历史实现里 Linux 分支 `await startResizeDragging(); return` 无条件返回,
//   而 tao 的 drag_resize_window 永远返回 Ok(()),手动兜底在 Linux 上是死代码。
//   现在两条路径并存,由运行时探测决定归属,测试覆盖三种结局。
describe('Linux resize:原生 + 手动兜底双路径', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.className = 'no-native-decorations'
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function makeFakeWin(opts: {
    startResizeThrows?: boolean
    composerResizes?: boolean
  } = {}) {
    const state = { composerResizes: !!opts.composerResizes }
    const calls = {
      setSize: [] as any[],
      setPosition: [] as any[],
      startResizeDragging: [] as string[],
    }
    let size = { width: 800, height: 600 }
    const fake = {
      innerSize: async () => ({ width: size.width, height: size.height }),
      outerPosition: async () => ({ x: 100, y: 100 }),
      setSize: async (s: any) => {
        calls.setSize.push(s)
        size = { width: s.width, height: s.height }
      },
      setPosition: async (p: any) => {
        calls.setPosition.push(p)
      },
      startResizeDragging: async (dir: string) => {
        calls.startResizeDragging.push(dir)
        if (opts.startResizeThrows) throw new Error('not supported')
        // 模拟合成器接管:原生请求发出后窗口尺寸确实变了
        if (state.composerResizes) size = { width: size.width + 50, height: size.height }
      },
    }
    return { fake, calls, state }
  }

  function makeLinuxDeps(fake: any) {
    return makeDeps({
      getCurrentWindow: () => fake,
      isLinux: () => true,
      sleep: async () => {},
      getWindowScaleFactorSafe: async () => 1,
    })
  }

  async function flush(times = 6): Promise<void> {
    for (let i = 0; i < times; i++) {
      await new Promise((r) => setTimeout(r, 0))
      flushRaf()
    }
  }

  function mouseDown(dir: string, pos: { screenX?: number; screenY?: number; clientX?: number; clientY?: number } = {}): void {
    const handle = document.querySelector(`.window-resize-handle.${dir}`) as HTMLElement
    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      screenX: pos.screenX ?? 100,
      screenY: pos.screenY ?? 100,
      clientX: pos.clientX ?? 0,
      clientY: pos.clientY ?? 0,
      buttons: 1,
    }))
  }

  function mouseMove(screenX: number, screenY = 100, clientX?: number, clientY?: number): void {
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      screenX,
      screenY,
      clientX: clientX ?? 0,
      clientY: clientY ?? 0,
      buttons: 1,
    }))
  }

  it('原生调用抛错时立即切到手动兜底并按位移改尺寸', async () => {
    const { fake, calls } = makeFakeWin({ startResizeThrows: true })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    expect(api.getLinuxResizeMode()).toBe('manual')

    mouseMove(150)
    await flush()
    expect(calls.setSize.length).toBeGreaterThan(0)
    expect(calls.setSize[0].width).toBe(850)
    api.stop()
  })

  it('原生请求被忽略(尺寸不变)时探测后由手动兜底接管', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    // 探测前不手动改尺寸,避免与合成器同时改窗口
    expect(calls.setSize.length).toBe(0)

    mouseMove(150)
    await flush()
    expect(api.getLinuxResizeMode()).toBe('manual')
    expect(calls.setSize.length).toBeGreaterThan(0)
    expect(calls.setSize[0].width).toBe(850)
    api.stop()
  })

  it('合成器接管(尺寸变化)时不再手动改尺寸', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: true })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()

    expect(api.getLinuxResizeMode()).toBe('native')
    expect(calls.setSize.length).toBe(0)
    expect(calls.startResizeDragging).toEqual(['East'])
    api.stop()
  })

  it('探测在首次位移后才发生,探测期间不调用 setSize', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    // 只按下不移动 → 不进入探测,也不改尺寸
    expect(calls.setSize.length).toBe(0)
    expect(api.getLinuxResizeMode()).toBe('unknown')
    api.stop()
  })

  it('原生路径本次没生效时降级为 unknown,下次手势重新探测', async () => {
    const { fake, state } = makeFakeWin({ composerResizes: true })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()
    expect(api.getLinuxResizeMode()).toBe('native')

    // 第二次手势:合成器不再改尺寸 → 有位移但尺寸没变 → 降级重新探测
    state.composerResizes = false
    mouseDown('right')
    await flush()
    mouseMove(200)
    await flush()
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, screenX: 200, screenY: 100 }))
    await flush()
    expect(api.getLinuxResizeMode()).toBe('unknown')
    api.stop()
  })

  it('已知原生无效时不再调用原生接口,避免原生与手动同时改窗口', async () => {
    const { fake, calls } = makeFakeWin({ startResizeThrows: true })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    // 第一次手势:原生调用被拒 → 切到 manual
    mouseDown('right')
    await flush()
    expect(api.getLinuxResizeMode()).toBe('manual')
    expect(calls.startResizeDragging.length).toBe(1)

    // 第二次手势:已知 manual,不应再调用原生接口
    mouseMove(150)
    await flush()
    mouseDown('right')
    await flush()
    expect(calls.startResizeDragging.length).toBe(1)
    api.stop()
  })

  it('探测期读取尺寸失败时不锁定模式,但本手势仍能手动改尺寸', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    let failSize = false
    const wrapped = {
      ...fake,
      innerSize: async () => {
        if (failSize) throw new Error('ipc down')
        return (fake as any).innerSize()
      },
    }
    const api = createWindowResize(makeLinuxDeps(wrapped))
    api.init()

    mouseDown('right')
    await flush()
    failSize = true
    mouseMove(150)
    await flush()

    // 读取失败 → 不锁定模式(仍为 unknown),但手动兜底已生效
    expect(api.getLinuxResizeMode()).toBe('unknown')
    expect(calls.setSize.length).toBeGreaterThan(0)
    api.stop()
  })

  it('非 Linux 平台保持原有手动路径,不会调用 startResizeDragging', async () => {
    const { fake, calls } = makeFakeWin({})
    const api = createWindowResize(makeDeps({ getCurrentWindow: () => fake }))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()

    expect(calls.startResizeDragging.length).toBe(0)
    expect(calls.setSize.length).toBeGreaterThan(0)
    expect(calls.setSize[0].width).toBe(850)
    api.stop()
  })

  // --------------------------------------------------------------------------
  // 回归:探针判据(2026-10-31 根因定位)
  //   旧实现把「收到窗口 resize 事件」当作「合成器接管了 resize」的证据。
  //   resize 事件异步投递,上一次无关改尺寸的迟到事件会被当成本次手势的证据,
  //   于是探针误判成 native → 手动兜底被关闭 → 表现为"完全无法调整大小"。
  //   正确判据只有一条:尺寸值是否偏离基线。
  // --------------------------------------------------------------------------
  it('迟到的窗口 resize 事件不得把探针误判成 native', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    // 与本次手势无关的迟到 resize 事件
    window.dispatchEvent(new Event('resize'))
    await flush()
    mouseMove(150)
    await flush()

    expect(api.getLinuxResizeMode()).toBe('manual')
    expect(calls.setSize.length).toBeGreaterThan(0)
    expect(calls.setSize[0].width).toBe(850)
    api.stop()
  })

  it('指针位移源默认取 screen 坐标', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right', { screenX: 100, screenY: 100, clientX: 10, clientY: 10 })
    await flush()
    // screen 位移 = 50,client 位移 = 20:结果若按 client 算会是 820,可据此判别
    mouseMove(150, 100, 30, 10)
    await flush()

    expect(api.getPointerSource()).toBe('screen')
    expect(calls.setSize[0].width).toBe(850)
    api.stop()
  })

  it('screen 坐标恒为 0 时退回 client 坐标', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right', { screenX: 0, screenY: 0, clientX: 100, clientY: 100 })
    await flush()
    mouseMove(0, 0, 160, 100)
    await flush()

    expect(api.getPointerSource()).toBe('client')
    expect(calls.setSize[0].width).toBe(860)
    api.stop()
  })

  it('1px 抖动不锁定指针源,避免锁死一个实际不动的坐标系', async () => {
    const { fake } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right', { screenX: 100, screenY: 100, clientX: 100, clientY: 100 })
    await flush()
    mouseMove(101, 100, 101, 100)
    await flush()
    expect(api.getPointerSource()).toBe(null)

    // 位移达到阈值后才锁定坐标系
    mouseMove(104, 100, 104, 100)
    await flush()
    expect(api.getPointerSource()).toBe('screen')
    api.stop()
  })

  it('手势结束时补上最后一帧,最终尺寸不差一帧', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()
    mouseMove(200)
    // 不 flush:最后一帧的目标还挂在 rAF 队列里
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, buttons: 0 }))
    await flush()

    expect(calls.setSize.length).toBeGreaterThan(0)
    expect(calls.setSize[calls.setSize.length - 1].width).toBe(900)
    api.stop()
  })

  it('手势在锚点采集期间结束时,不复活 resize 状态', async () => {
    // 用属性持有而非闭包变量:TS 的控制流分析看不到回调里的赋值
    const gate: { release: (() => void) | null } = { release: null }
    let first = true
    const calls = { setSize: [] as any[] }
    const fake = {
      innerSize: async () => {
        if (first) {
          first = false
          await new Promise<void>((r) => { gate.release = r })
        }
        return { width: 800, height: 600 }
      },
      outerPosition: async () => ({ x: 0, y: 0 }),
      setSize: async (s: any) => { calls.setSize.push(s) },
      setPosition: async () => {},
      startResizeDragging: async () => {},
    }
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush(2)
    // 手势在锚点采集(等待 innerSize)期间就结束了
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, buttons: 0 }))
    gate.release?.()
    await flush()

    // 之后即使有带按键的移动,也不应再触发 resize(状态没有被复活)
    mouseMove(300)
    await flush()
    expect(calls.setSize.length).toBe(0)
    api.stop()
  })

  it('指针停住后重复的相同目标不再重复下发 setSize', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()
    expect(calls.setSize.length).toBe(1)

    // 指针停住:mousemove 继续来,但目标没变 → 不应重复下发
    mouseMove(150)
    mouseMove(150)
    await flush()
    expect(calls.setSize.length).toBe(1)
    api.stop()
  })

  it('setSize 失败(异常/超时)不算落地,相同目标仍会重试', async () => {
    let fail = true
    const calls = { setSize: [] as any[] }
    const fake = {
      innerSize: async () => ({ width: 800, height: 600 }),
      outerPosition: async () => ({ x: 0, y: 0 }),
      setSize: async (s: any) => {
        calls.setSize.push(s)
        if (fail) throw new Error('ipc down')
      },
      setPosition: async () => {},
      startResizeDragging: async () => {},
    }
    const api = createWindowResize(makeDeps({ getCurrentWindow: () => fake }))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    await flush()
    expect(calls.setSize.length).toBe(1)

    // 失败后不得写入「已落地」基线,否则去重会把同一目标永久跳过
    fail = false
    mouseMove(150)
    await flush()
    expect(calls.setSize.length).toBe(2)
    api.stop()
  })

  it('新手势开始时丢弃上一次手势的待落地目标,避免跨手势污染基线', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    // 不 flush:此时 rAF 还没执行,目标仍挂在待落地队列上
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, buttons: 0 }))
    await flush()
    // 上一手势的待落地目标随手势结束被丢弃
    expect(calls.setSize.length).toBe(0)

    mouseDown('right')
    await flush()
    mouseMove(250)
    await flush()
    // 新手势的基线仍是 800,位移 250-100=150
    expect(calls.setSize.length).toBe(1)
    expect(calls.setSize[0].width).toBe(950)
    api.stop()
  })

  it('连续两帧的 resize 串行落地,旧目标不会后落地导致尺寸回跳', async () => {
    const order: string[] = []
    let size = { width: 800, height: 600 }
    const fake = {
      innerSize: async () => ({ width: size.width, height: size.height }),
      outerPosition: async () => ({ x: 0, y: 0 }),
      setSize: async (s: any) => {
        order.push(`start:${s.width}`)
        await new Promise((r) => setTimeout(r, 10))
        size = { width: s.width, height: s.height }
        order.push(`end:${s.width}`)
      },
      setPosition: async () => {},
      startResizeDragging: async () => {},
    }
    const api = createWindowResize(makeDeps({ getCurrentWindow: () => fake }))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(150)
    flushRaf()
    mouseMove(200)
    flushRaf()
    await new Promise((r) => setTimeout(r, 60))
    await flush()

    // 串行:前一个目标完成后才开始下一个,不会交叉
    expect(order).toEqual(['start:850', 'end:850', 'start:900', 'end:900'])
    api.stop()
  })

  it('一次手势内多次 mousemove 只落地一次 setSize(按帧合并)', async () => {
    const { fake, calls } = makeFakeWin({ composerResizes: false })
    const api = createWindowResize(makeLinuxDeps(fake))
    api.init()

    mouseDown('right')
    await flush()
    mouseMove(120)
    mouseMove(140)
    mouseMove(160)
    await flush()

    expect(calls.setSize.length).toBe(1)
    expect(calls.setSize[0].width).toBe(860)
    api.stop()
  })
})

// ============================================================================
// 最大化状态同步(手柄可用性)
//   body.window-maximized 会把手柄整体 pointer-events:none。
//   bindWindowMaximizedState 只在启动时做一次基线同步(为绕开 macOS isMaximized 死循环),
//   于是「点还原按钮后 class 仍留着」→ 手柄永久失效 → 窗口再也调不了大小。
// ============================================================================
describe('最大化状态同步', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.className = 'no-native-decorations'
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('applyMaximizedState 同步 body.window-maximized', () => {
    const api = createWindowResize(makeDeps())
    api.init()
    api.applyMaximizedState(true)
    expect(document.body.classList.contains('window-maximized')).toBe(true)
    api.applyMaximizedState(false)
    expect(document.body.classList.contains('window-maximized')).toBe(false)
    api.stop()
  })

  it('Linux:窗口尺寸变化后去抖复核,纠正与真实状态脱节的 class', async () => {
    let maximized = true
    const listeners: Array<[string, any]> = []
    const fakeWin = {
      isMaximized: async () => maximized,
      innerSize: async () => ({ width: 800, height: 600 }),
      outerPosition: async () => ({ x: 0, y: 0 }),
      setSize: async () => {},
      setPosition: async () => {},
      startResizeDragging: async () => {},
      addEventListener: (t: string, fn: any) => { listeners.push([t, fn]) },
      removeEventListener: () => {},
    }
    const api = createWindowResize(makeDeps({
      getCurrentWindow: () => fakeWin,
      isLinux: () => true,
      isTauriRuntime: () => true,
      win: fakeWin,
      bindWindowMaximizedState: async (getWin: any, apply: any) => {
        apply(await getWin().isMaximized())
        return {
          dispose: () => {},
          syncNow: async () => { apply(await getWin().isMaximized()) },
        }
      },
    }))
    api.init()
    await new Promise((r) => setTimeout(r, 10))
    // 启动时窗口是最大化 → class 置上,手柄被禁用(这是预期行为)
    expect(document.body.classList.contains('window-maximized')).toBe(true)

    // 用户用合成器快捷键还原了窗口,应用本身不知情
    maximized = false
    const resizeListener = listeners.find(([t]) => t === 'resize')
    expect(resizeListener).toBeTruthy()
    resizeListener![1]()
    await new Promise((r) => setTimeout(r, 300))

    expect(document.body.classList.contains('window-maximized')).toBe(false)
    api.stop()
  })
})
