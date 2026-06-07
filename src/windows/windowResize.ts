// 窗口边缘 resize 初始化:为 decorations: false 时提供窗口调整大小功能
// 抽离自 main.ts:6298-6462。
// 抽离理由:8 边/角 resize 处理 + 状态机封装,无 main-local 闭包依赖;
// 只用 document / getCurrentWindow / bindWindowMaximizedState / getWindowScaleFactorSafe。
// factory init() 后直接挂事件,stop() 清理。

export interface WindowResizeDeps {
  /** 注入 getCurrentWindow */
  getCurrentWindow: () => any
  /** 注入 bindWindowMaximizedState */
  bindWindowMaximizedState: (
    getWin: () => any,
    onChange: (max: boolean) => void,
  ) => Promise<{ dispose: () => void } | null | undefined>
  /** 注入 getWindowScaleFactorSafe */
  getWindowScaleFactorSafe: () => Promise<number>
  /** 注入 isTauriRuntime 判定 */
  isTauriRuntime: () => boolean
  /** 注入 document,默认全局 */
  document?: any
  /** 注入 window,默认全局 */
  win?: any
}

export interface WindowResizeApi {
  init: () => void
  /** 计算单边 resize 后的新尺寸/位置(纯函数,可独立测试) */
  computeResize: (params: ComputeResizeParams) => ComputeResizeResult
  stop: () => void
}

export interface ComputeResizeParams {
  direction: string
  startWidth: number
  startHeight: number
  startPosX: number
  startPosY: number
  deltaX: number
  deltaY: number
  scaleFactor: number
  minWidth?: number
  minHeight?: number
}

export interface ComputeResizeResult {
  newWidth: number
  newHeight: number
  newX: number
  newY: number
}

const DEFAULT_MIN_W = 600
const DEFAULT_MIN_H = 400

export function createWindowResize(deps: WindowResizeDeps): WindowResizeApi {
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null)
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)
  const handleClass = 'window-resize-handle'
  const containerClass = 'window-resize-handles'

  const resizeDirMap = {
    top: 'North',
    bottom: 'South',
    left: 'West',
    right: 'East',
    'corner-nw': 'NorthWest',
    'corner-ne': 'NorthEast',
    'corner-sw': 'SouthWest',
    'corner-se': 'SouthEast',
  } as const

  let container: HTMLElement | null = null
  let running = false
  let resizing = false
  let maximizedBinding: { dispose: () => void } | null = null
  let ready = false
  let startX = 0
  let startY = 0
  let startWidth = 0
  let startHeight = 0
  let startPosX = 0
  let startPosY = 0
  let startScaleFactor = 1
  let direction = ''

  const setMaximizedClass = (isMax: boolean) => {
    if (isMax) doc?.body?.classList?.add('window-maximized')
    else doc?.body?.classList?.remove('window-maximized')
  }

  function computeResize(p: ComputeResizeParams): ComputeResizeResult {
    const minW = Math.round((p.minWidth ?? DEFAULT_MIN_W) * p.scaleFactor)
    const minH = Math.round((p.minHeight ?? DEFAULT_MIN_H) * p.scaleFactor)
    let newWidth = p.startWidth
    let newHeight = p.startHeight
    let newX = p.startPosX
    let newY = p.startPosY
    if (p.direction.includes('right') || p.direction === 'corner-ne' || p.direction === 'corner-se') {
      newWidth = Math.max(minW, p.startWidth + p.deltaX)
    }
    if (p.direction.includes('left') || p.direction === 'corner-nw' || p.direction === 'corner-sw') {
      const widthDelta = Math.min(p.deltaX, p.startWidth - minW)
      newWidth = p.startWidth - widthDelta
      newX = p.startPosX + widthDelta
    }
    if (p.direction.includes('bottom') || p.direction === 'corner-sw' || p.direction === 'corner-se') {
      newHeight = Math.max(minH, p.startHeight + p.deltaY)
    }
    if (p.direction.includes('top') || p.direction === 'corner-nw' || p.direction === 'corner-ne') {
      const heightDelta = Math.min(p.deltaY, p.startHeight - minH)
      newHeight = p.startHeight - heightDelta
      newY = p.startPosY + heightDelta
    }
    return { newWidth, newHeight, newX, newY }
  }

  function onMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (!target?.classList?.contains(handleClass)) return
    if (!doc?.body?.classList?.contains('no-native-decorations')) return
    e.preventDefault()
    e.stopPropagation()
    direction = (target as any).dataset?.resizeDir || ''
    void handleDown(e, direction)
  }

  async function handleDown(e: MouseEvent, dir: string): Promise<void> {
    const platform = (win?.navigator?.platform || '').toLowerCase()
    const isLinux = platform.includes('linux')
    if (isLinux && dir in resizeDirMap) {
      try {
        const w = deps.getCurrentWindow()
        await w.startResizeDragging(resizeDirMap[dir as keyof typeof resizeDirMap])
        return
      } catch {}
    }
    startScaleFactor = await deps.getWindowScaleFactorSafe()
    startX = e.screenX * startScaleFactor
    startY = e.screenY * startScaleFactor
    ready = false
    resizing = false
    try {
      const w = deps.getCurrentWindow()
      const size = await w.innerSize()
      const pos = await w.outerPosition()
      startWidth = size.width
      startHeight = size.height
      startPosX = pos.x
      startPosY = pos.y
      ready = true
      resizing = true
    } catch {
      resizing = false
      direction = ''
      ready = false
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!resizing || !ready) return
    if ((e.buttons & 1) === 0) {
      resizing = false
      direction = ''
      ready = false
      return
    }
    const deltaX = (e.screenX * startScaleFactor) - startX
    const deltaY = (e.screenY * startScaleFactor) - startY
    const r = computeResize({
      direction,
      startWidth,
      startHeight,
      startPosX,
      startPosY,
      deltaX,
      deltaY,
      scaleFactor: startScaleFactor,
    })
    void applyResize(r)
  }

  async function applyResize(r: ComputeResizeResult): Promise<void> {
    try {
      const w = deps.getCurrentWindow()
      if (r.newX !== startPosX || r.newY !== startPosY) {
        await w.setPosition({ type: 'Physical', x: Math.round(r.newX), y: Math.round(r.newY) } as any)
      }
      await w.setSize({ type: 'Physical', width: Math.round(r.newWidth), height: Math.round(r.newHeight) } as any)
    } catch {}
  }

  function onMouseUp(): void {
    resizing = false
    direction = ''
    ready = false
  }

  function onBlur(): void {
    resizing = false
    direction = ''
    ready = false
  }

  function init(): void {
    if (running) return
    running = true
    if (!doc) return
    const el = doc.createElement('div') as HTMLElement
    el.className = containerClass
    const dirs = ['top', 'bottom', 'left', 'right', 'corner-nw', 'corner-ne', 'corner-sw', 'corner-se']
    for (const dir of dirs) {
      const handle = doc.createElement('div')
      handle.className = `${handleClass} ${dir}`
      ;(handle as any).dataset.resizeDir = dir
      el.appendChild(handle)
    }
    doc.body.appendChild(el)
    el.addEventListener('mousedown', onMouseDown as any)
    container = el
    doc.addEventListener('mousemove', onMouseMove as any)
    doc.addEventListener('mouseup', onMouseUp as any)
    if (win) win.addEventListener('blur', onBlur as any)
    void (async () => {
      if (!deps.isTauriRuntime()) return
      try {
        const binding = await deps.bindWindowMaximizedState(deps.getCurrentWindow, setMaximizedClass)
        maximizedBinding = binding && typeof binding.dispose === 'function' ? binding : null
      } catch {}
    })()
  }

  function stop(): void {
    if (!running) return
    running = false
    if (container) {
      try { container.removeEventListener('mousedown', onMouseDown as any) } catch {}
      try { container.parentElement?.removeChild(container) } catch {}
      container = null
    }
    try { doc?.removeEventListener('mousemove', onMouseMove as any) } catch {}
    try { doc?.removeEventListener('mouseup', onMouseUp as any) } catch {}
    try { win?.removeEventListener('blur', onBlur as any) } catch {}
    try { maximizedBinding?.dispose() } catch {}
    maximizedBinding = null
  }

  return { init, computeResize, stop }
}
