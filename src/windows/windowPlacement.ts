// 窗口几何兜底:缩放系数、尺寸下限、启动居中
// 抽离自 main.ts:7007-7106。
// 抽离理由:3 个函数(ensureMinWindowSize / centerWindow / getWindowScaleFactorSafe)都是
// 纯 window 几何操作,无 main-local 闭包依赖;只依赖 Tauri getCurrentWindow/currentMonitor/invoke。
// 工厂模式暴露,便于单测注入 mock。
// deps 全部必填 — 调用方负责传入静态 import 的 Tauri 句柄(避免 Vite ESM 不支持 require)。

export interface WorkArea { x: number; y: number; width: number; height: number }
export interface WinPosition { x: number; y: number }
export interface WinSize { width: number; height: number }
export interface Monitor { workArea: { position: WinPosition; size: WinSize } }

export interface VirtualScreen { width: number; height: number }

export interface WindowPlacementDeps {
  /** 注入 getCurrentWindow,调用方负责静态 import */
  getCurrentWindow: () => any
  /** 注入 currentMonitor,调用方负责静态 import */
  currentMonitor: () => Promise<Monitor | null>
  /** 注入 invoke,调用方负责静态 import */
  invoke: (cmd: string, args?: any) => Promise<any>
  /** 注入 window 引用,默认全局 window */
  win?: any
}

export interface WindowPlacementApi {
  getWindowScaleFactorSafe: () => Promise<number>
  ensureMinWindowSize: () => Promise<void>
  centerWindow: () => Promise<void>
}

const DEFAULT_MIN_W = 960
const DEFAULT_MIN_H = 640
const VIS_THRESHOLD = 48
const SCALE_MIN = 0.05
const SCALE_MAX = 16

export function createWindowPlacement(deps: WindowPlacementDeps): WindowPlacementApi {
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)

  async function getWindowScaleFactorSafe(): Promise<number> {
    try {
      const w = deps.getCurrentWindow()
      const sf = await w.scaleFactor()
      if (typeof sf === 'number' && Number.isFinite(sf) && sf > SCALE_MIN && sf < SCALE_MAX) return sf
    } catch {}
    try {
      const dpr = win?.devicePixelRatio
      if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > SCALE_MIN && dpr < SCALE_MAX) return dpr
    } catch {}
    return 1
  }

  async function ensureMinWindowSize(): Promise<void> {
    try {
      const w = deps.getCurrentWindow()
      const size = await w.innerSize()
      const sf = await getWindowScaleFactorSafe()
      const minW = Math.round(DEFAULT_MIN_W * sf)
      const minH = Math.round(DEFAULT_MIN_H * sf)
      let targetW = size.width
      let targetH = size.height

      if (targetW < minW) targetW = minW
      if (targetH < minH) targetH = minH

      let maxW = 0
      let maxH = 0
      try {
        const screen = await deps.invoke('get_virtual_screen_size') as VirtualScreen | null
        if (screen && typeof screen.width === 'number' && typeof screen.height === 'number') {
          maxW = screen.width
          maxH = screen.height
        }
      } catch {}
      if (maxW > 0 && targetW > maxW) targetW = maxW
      if (maxH > 0 && targetH > maxH) targetH = maxH

      if (targetW !== size.width || targetH !== size.height) {
        await w.setSize({ type: 'Physical', width: Math.round(targetW), height: Math.round(targetH) } as any)
      }
    } catch {}
  }

  async function centerWindow(): Promise<void> {
    try {
      const w = deps.getCurrentWindow()
      const pos = await w.outerPosition()
      const size = await w.outerSize()

      let waX = 0, waY = 0, waW = 0, waH = 0
      try {
        const mon = await deps.currentMonitor()
        if (mon && mon.workArea && mon.workArea.position && mon.workArea.size) {
          waX = mon.workArea.position.x
          waY = mon.workArea.position.y
          waW = mon.workArea.size.width
          waH = mon.workArea.size.height
        }
      } catch {}
      if (!waW || !waH) {
        const sf = await getWindowScaleFactorSafe()
        const screenW = win?.screen?.availWidth || win?.screen?.width || 0
        const screenH = win?.screen?.availHeight || win?.screen?.height || 0
        if (!screenW || !screenH) return
        waX = 0
        waY = 0
        waW = Math.round(screenW * sf)
        waH = Math.round(screenH * sf)
      }

      const visibleEnough =
        pos.x + VIS_THRESHOLD < waX + waW &&
        pos.y + VIS_THRESHOLD < waY + waH &&
        pos.x + size.width - VIS_THRESHOLD > waX &&
        pos.y + size.height - VIS_THRESHOLD > waY
      if (visibleEnough) return

      const x = Math.round(waX + Math.max(0, (waW - size.width) / 2))
      const y = Math.round(waY + Math.max(0, (waH - size.height) / 2))
      await w.setPosition({ type: 'Physical', x, y } as any)
    } catch {}
  }

  return { getWindowScaleFactorSafe, ensureMinWindowSize, centerWindow }
}
