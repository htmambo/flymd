// Windows 透明无边框窗口拖动后偶发"顶部白条/残影"的兜底
// 抽离自 main.ts:6122-6260。
// 抽离理由:WebView2/DWM 合成在某些 move 序列里没及时刷新透明 surface;本块用
//  "轻微改变 body 背景一帧" 强制触发一次合成更新,无 main-local 闭包依赖。
// 工厂模式:start/stop 显式控制(便于单测),内部 state 封装在闭包中。

export interface WindowsCompositorPokeDeps {
  /** 注入 isTauriRuntime 判定(必填) */
  isTauriRuntime: () => boolean
  /** 注入 getCurrentWindow(必填,Vite ESM 友好) */
  getCurrentWindow: () => any
  /** 注入 document,默认全局 document */
  document?: any
  /** 注入 window,默认全局 window */
  win?: any
  /** 注入 setTimeout,默认全局 setTimeout */
  setTimeoutFn?: (cb: () => void, ms: number) => any
  /** 注入 clearTimeout,默认全局 clearTimeout */
  clearTimeoutFn?: (id: any) => void
  /** 注入 clearInterval,默认全局 clearInterval */
  clearIntervalFn?: (id: any) => void
  /** 注入 requestAnimationFrame,默认全局 */
  raf?: (cb: (t: number) => void) => any
  /** 注入 Date.now,默认全局 */
  now?: () => number
}

export interface WindowsCompositorPokeApi {
  start: () => void
  stop: () => void
  isRunning: () => boolean
  /** 仅测试用:重置内部状态 */
  _resetState: () => void
}

const SETTLE_DELAY_MS = 200
const POKE_THROTTLE_MS = 80
const SETTLE_DEFER_MS = 140
const UNFOCUSED_INTERVAL_MS = 520
const UNFOCUSED_MAX_TICKS = 6
const STARTUP_DEFER_MS = 260
const FOCUS_LOSS_DEFER_MS = [80, 260, 520]
const BLUR_DEFER_MS = [120, 320]

export function createWindowsCompositorPoke(deps: WindowsCompositorPokeDeps): WindowsCompositorPokeApi {
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null)
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)
  const setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((id) => clearTimeout(id))
  const setIntervalFn = (cb: () => void, ms: number) => setInterval(cb, ms)
  const clearIntervalFn = deps.clearIntervalFn ?? ((id) => clearInterval(id))
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb))
  const now = deps.now ?? (() => Date.now())
  const isTauriRuntime = deps.isTauriRuntime
  const getCurrentWindow = deps.getCurrentWindow

  let running = false
  let settleTimer: any = null
  let settling = false
  let lastPokeAt = 0
  let unfocusedTimer: any = null
  const listeners: Array<{ target: any; ev: string; fn: any; opts?: any }> = []

  function pokeCssOnce(): void {
    try {
      if (!doc?.body?.classList) return
      doc.body.classList.add('win-compositor-poke')
      raf(() => {
        raf(() => {
          try { doc.body.classList.remove('win-compositor-poke') } catch {}
        })
      })
    } catch {}
  }

  async function settle(): Promise<void> {
    if (settling) return
    settling = true
    try {
      pokeCssOnce()
      const w = getCurrentWindow()
      let shouldPokeSize = false
      try { shouldPokeSize = !!doc?.body?.classList?.contains('no-native-decorations') } catch {}
      if (!shouldPokeSize) return
      try {
        const isMax = await w.isMaximized()
        if (isMax) return
      } catch {}
      try {
        const isFs = await w.isFullscreen()
        if (isFs) return
      } catch {}
      try {
        const s = await w.innerSize()
        await w.setSize({ type: 'Physical', width: s.width, height: s.height } as any)
      } catch {}
    } catch {} finally {
      setTimeoutFn(() => { settling = false }, SETTLE_DELAY_MS)
    }
  }

  function stopUnfocusedPoke(): void {
    try { if (unfocusedTimer) clearIntervalFn(unfocusedTimer) } catch {}
    unfocusedTimer = null
  }

  function startUnfocusedPoke(): void {
    if (!doc?.body?.classList?.contains('sticky-note-mode')) return
    if (unfocusedTimer) return
    let n = 0
    unfocusedTimer = setIntervalFn(() => {
      n++
      schedule()
      if (n >= UNFOCUSED_MAX_TICKS) stopUnfocusedPoke()
    }, UNFOCUSED_INTERVAL_MS)
  }

  function schedule(): void {
    if (settling) return
    const t = now()
    if (t - lastPokeAt > POKE_THROTTLE_MS) {
      lastPokeAt = t
      pokeCssOnce()
    }
    try { if (settleTimer) clearTimeoutFn(settleTimer) } catch {}
    settleTimer = setTimeoutFn(() => {
      settleTimer = null
      void settle()
    }, SETTLE_DEFER_MS)
  }

  function addListener(target: any, ev: string, fn: any, opts?: any): void {
    if (!target?.addEventListener) return
    target.addEventListener(ev, fn, opts)
    listeners.push({ target, ev, fn, opts })
  }

  function clearListeners(): void {
    for (const l of listeners) {
      try { l.target.removeEventListener(l.ev, l.fn, l.opts) } catch {}
    }
    listeners.length = 0
  }

  function start(): void {
    if (running) return
    const platform = (win?.navigator?.platform || '').toLowerCase()
    if (!platform.includes('win')) return
    if (!isTauriRuntime()) return
    running = true

    void (async () => {
      try {
        const w = getCurrentWindow()
        try { await w.onMoved(() => schedule()) } catch {}
        try { await w.onResized(() => schedule()) } catch {}
        try {
          await w.onFocusChanged(({ payload }: any) => {
            if (payload) {
              stopUnfocusedPoke()
              return schedule()
            }
            for (const ms of FOCUS_LOSS_DEFER_MS) setTimeoutFn(() => schedule(), ms)
            startUnfocusedPoke()
          })
        } catch {}
        try { await w.onScaleChanged(() => schedule()) } catch {}
      } catch {}
    })()

    addListener(win, 'focus', () => schedule(), { passive: true })
    addListener(win, 'blur', () => {
      schedule()
      for (const ms of BLUR_DEFER_MS) setTimeoutFn(() => schedule(), ms)
      startUnfocusedPoke()
    }, { passive: true })
    addListener(doc, 'visibilitychange', () => {
      try { if (!doc.hidden) schedule() } catch {}
    }, { passive: true } as any)

    try { setTimeoutFn(() => schedule(), STARTUP_DEFER_MS) } catch {}
  }

  function stop(): void {
    if (!running) return
    running = false
    clearListeners()
    try { if (settleTimer) clearTimeoutFn(settleTimer) } catch {}
    settleTimer = null
    stopUnfocusedPoke()
  }

  function _resetState(): void {
    stop()
    settling = false
    lastPokeAt = 0
  }

  return { start, stop, isRunning: () => running, _resetState }
}
