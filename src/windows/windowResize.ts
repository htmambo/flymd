// 窗口边缘 resize 初始化:为 decorations: false 时提供窗口调整大小功能
// 抽离自 main.ts:6298-6462。
// 抽离理由:8 边/角 resize 处理 + 状态机封装,无 main-local 闭包依赖;
// 只用 document / getCurrentWindow / bindWindowMaximizedState / getWindowScaleFactorSafe。
// factory init() 后直接挂事件,stop() 清理。
//
// ============================================================================
// Linux(Wayland)resize 失效的根因与修复(2026-10-31 实测定位)
// ============================================================================
// 症状:Linux 上窗口无法调整大小。
//
// 根因链(协议层 + 真机实测,见 docs/Task/Archive/2026-10/2026-10-31-linux-window-resize-fix.md):
//
// 1) 原生路径在 Wayland 下是死路。
//    Tauri 的 startResizeDragging → tao WindowRequest::DragResizeWindow
//    → gdk_window_begin_resize_drag(edge, button, x, y, GDK_CURRENT_TIME)。
//    GDK_CURRENT_TIME = 0 ⇒ Wayland 请求里的 serial 恒为 0。
//    实测协议:WAYLAND_DEBUG 抓到 `xdg_toplevel#34.resize(wl_seat#22, 0, 8)`,
//    之后 KWin **没有回任何 configure** —— serial=0 的请求无法把这次交互
//    绑定到用户的按键,合成器直接忽略,既不建立指针 grab,也不进交互式 resize。
//    ⇒ 原生路径在 Wayland 下 100% 无效(不是"偶尔失效",是必然无效)。
//
// 2) 手动兜底路径此前被探针误杀。
//    旧探针把「收到窗口 resize 事件」当作「合成器接管了 resize」的证据。
//    但 resize 事件是异步到达的,上一次无关的改尺寸(如 restore)的事件
//    迟到后会被当成本次手势的证据 ⇒ 探针误判成 native ⇒ 手动路径被关闭
//    ⇒ 表现为"完全无法调整大小"。
//    尺寸值比对严格优于事件证据:只要尺寸没变,合成器就没接管;
//    读不到尺寸时保持 unknown 即可。
//
// 3) Wayland 的平台限制(无法绕过,只能如实降级):
//    - setSize 可用(实测物理像素精确生效),是唯一可靠的改尺寸手段;
//    - setPosition 是 no-op(实测请求 +80/+40 后 outerPosition 仍是原值),
//      Wayland 客户端无权自行移动窗口;
//    ⇒ 手动路径在 Wayland 下能改尺寸、但不能移动窗口,
//      左/上边缘会退化为「尺寸变化但锚定边不跟随光标」。
//
// 修复后仍保留「原生 + 手动」双路径(运行时探测决定归属),因为:
// X11 下原生路径是好的(GDK3 X11 会做真正的交互式 resize),
// 不应为了修 Wayland 把 X11 也降级;两条路径不会同时改窗口。
//
// ============================================================================
// 指针位移来源(screen / client 双源自动择优)
// ============================================================================
// 手动路径需要「指针位移了多少」。两个候选:
//   - screenX/screenY:屏幕绝对坐标。指针移出窗口后仍然有效,是最理想的;
//   - clientX/clientY:视口相对坐标。一定随指针移动变化,但依赖事件持续投递。
// WebKitGTK 在 Wayland 下 screenX 由 gdk_window_get_origin 推导,并非 100% 可信,
// 因此按手势动态择优:哪个源真的在动就用哪个,手势内保持一致,避免坐标系混用。
//
// 择优后 client 源是否安全:
//   - Wayland:setPosition 是 no-op,窗口在拖拽期间永不移动 ⇒ client 坐标原点不动
//     ⇒ client 位移恒等于光标位移,不会「冻结」;
//   - X11:screenX 一定有效(X11 有真实屏幕坐标),client 源根本不会被选中。
// ⇒ 两种情况下 client 源都不会出现「窗口跟着光标走、client 位移归零」的冻结。

export interface WindowResizeDeps {
  /** 注入 getCurrentWindow */
  getCurrentWindow: () => any
  /** 注入 bindWindowMaximizedState */
  bindWindowMaximizedState: (
    getWin: () => any,
    onChange: (max: boolean) => void,
  ) => Promise<{ dispose: () => void; syncNow?: () => Promise<void> } | null | undefined>
  /** 注入 getWindowScaleFactorSafe */
  getWindowScaleFactorSafe: () => Promise<number>
  /** 注入 isTauriRuntime 判定 */
  isTauriRuntime: () => boolean
  /** 注入 document,默认全局 */
  document?: any
  /** 注入 window,默认全局 */
  win?: any
  /** 注入 Linux 平台判定,默认读 navigator.platform */
  isLinux?: () => boolean
  /** 注入 sleep,默认基于 setTimeout */
  sleep?: (ms: number) => Promise<void>
  /** 注入 requestAnimationFrame,用于把一次手势内的多次 mousemove 合并成一帧一次 setSize */
  raf?: (cb: (t: number) => void) => any
  /** 注入 cancelAnimationFrame */
  cancelRaf?: (id: any) => void
}

/** Linux 下由谁驱动 resize:合成器(native) / 手动兜底(manual) / 尚未探测(unknown) */
export type LinuxResizeMode = 'unknown' | 'native' | 'manual'

/** 指针位移来源:屏幕绝对坐标 / 视口相对坐标 */
export type PointerSource = 'screen' | 'client'

export interface WindowResizeApi {
  init: () => void
  /** 计算单边 resize 后的新尺寸/位置(纯函数,可独立测试) */
  computeResize: (params: ComputeResizeParams) => ComputeResizeResult
  stop: () => void
  /** 仅测试用:当前 Linux resize 策略 */
  getLinuxResizeMode: () => LinuxResizeMode
  /** 仅测试用:当前手势选用的指针位移来源 */
  getPointerSource: () => PointerSource | null
  /**
   * 显式同步最大化状态。
   * body.window-maximized 会把手柄整体 pointer-events:none,
   * 而 bindWindowMaximizedState 只在启动时做一次基线同步(为绕开 macOS isMaximized 死循环),
   * 于是「点还原按钮后 class 仍留着」→ 手柄永久失效 → 窗口再也调不了大小。
   * 调用方在已知最大化状态变化时应显式调用本方法。
   */
  applyMaximizedState: (isMax: boolean) => void
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
/** 原生 resize 探测延迟:留时间让合成器应用第一次 resize */
const NATIVE_PROBE_DELAY_MS = 120
/** 指针位移源锁定阈值:小于该位移视为抖动,不锁定坐标系 */
const POINTER_SOURCE_LOCK_THRESHOLD_PX = 2
/** 窗口 IPC 超时:防止窗口销毁/webview 重载时 promise 永不落地,把状态机卡死 */
const WINDOW_IPC_TIMEOUT_MS = 2000

/**
 * 严格版超时:超时时 reject,调用方能把它与「成功」区分开。
 * 用于「超时后不能按成功处理」的场合(如 setSize 超时后不能记录已落地)。
 */
async function withTimeoutReject<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: any = null
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('window-ipc-timeout')), ms)
    })
    // race 已经结束后,超时 promise 的迟到 reject 会变成 unhandled rejection → 静默吞掉
    timeoutPromise.catch(() => {})
    return await Promise.race([p, timeoutPromise])
  } finally {
    if (timer != null) {
      try { clearTimeout(timer) } catch {}
      timer = null
    }
  }
}

/** 给 promise 加超时兜底:超时后按 fallback 返回,不让调用方无限等待 */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: any = null
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms) }),
    ])
  } finally {
    if (timer != null) {
      try { clearTimeout(timer) } catch {}
      timer = null
    }
  }
}

export function createWindowResize(deps: WindowResizeDeps): WindowResizeApi {
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null)
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)
  const handleClass = 'window-resize-handle'
  const containerClass = 'window-resize-handles'
  const isLinux = deps.isLinux ?? (() => {
    const platform = (win?.navigator?.platform || '').toLowerCase()
    return platform.includes('linux')
  })
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const raf = deps.raf ?? ((cb: (t: number) => void) => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
    return setTimeout(() => cb(0), 16) as any
  })
  const cancelRaf = deps.cancelRaf ?? ((id: any) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
  })

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
  let maximizedBinding: { dispose: () => void; syncNow?: () => Promise<void> } | null = null
  let ready = false
  let startWidth = 0
  let startHeight = 0
  let startPosX = 0
  let startPosY = 0
  let startScaleFactor = 1
  let direction = ''

  // Linux 双路径状态
  let linuxMode: LinuxResizeMode = 'unknown'
  let linuxProbePending = false
  let linuxProbeResolving = false
  /** 正在进行的探测所属手势序号 */
  let linuxProbeSeq = 0
  let linuxBaselineWidth = 0
  let linuxBaselineHeight = 0
  let linuxPendingDeltaX = 0
  let linuxPendingDeltaY = 0
  let linuxGestureMoved = false
  /** 手势序号:探测是异步的,用序号丢弃过期手势的探测结果 */
  let gestureSeq = 0

  // 指针位移跟踪
  let pointerSource: PointerSource | null = null
  let startScreenX = 0
  let startScreenY = 0
  let startClientX = 0
  let startClientY = 0
  let curScreenX = 0
  let curScreenY = 0
  let curClientX = 0
  let curClientY = 0

  // resize 落地:按帧节流 + 串行化(避免旧目标后落地导致尺寸回跳)
  let pendingResize: ComputeResizeResult | null = null
  let rafId: any = null
  let applyQueue: ComputeResizeResult | null = null
  let applying = false
  let applyIdleWaiters: Array<() => void> = []
  /** 上一次成功落地的几何:用于跳过重复的相同目标(指针停住时 mousemove 仍在来) */
  let lastAppliedWidth = -1
  let lastAppliedHeight = -1
  let lastAppliedX = Number.NaN
  let lastAppliedY = Number.NaN

  const setMaximizedClass = (isMax: boolean) => {
    if (isMax) doc?.body?.classList?.add('window-maximized')
    else doc?.body?.classList?.remove('window-maximized')
  }

  /**
   * Linux 专用的最大化状态自愈:
   * 用户可能用合成器快捷键(Super+Up/Down)、窗口菜单等应用之外的方式改最大化状态,
   * 这些路径不会通知前端,body.window-maximized 会与真实状态脱节。
   * 这里在窗口尺寸变化后做一次去抖的 isMaximized() 复核并纠正 class。
   * 只在 Linux 启用:macOS 上在 onResized 回调里调 isMaximized() 会触发
   * Tauri #5812/#13199 描述的 looped resize 死循环(见 maximizedState.ts 的说明)。
   */
  const MAXIMIZED_RESYNC_DEBOUNCE_MS = 150
  let maximizedResyncTimer: any = null
  let maximizedResyncPending = false

  function scheduleMaximizedResync(): void {
    // 手势进行中先挂起,避免在拖拽中途切 class;手势结束后再复核
    if (resizing || linuxProbePending) {
      maximizedResyncPending = true
      return
    }
    maximizedResyncPending = false
    if (maximizedResyncTimer != null) {
      try { clearTimeout(maximizedResyncTimer) } catch {}
      maximizedResyncTimer = null
    }
    maximizedResyncTimer = setTimeout(() => {
      maximizedResyncTimer = null
      try { void maximizedBinding?.syncNow?.()?.catch?.(() => {}) } catch {}
    }, MAXIMIZED_RESYNC_DEBOUNCE_MS)
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

  /** 丢弃上一次手势遗留的待落地目标(跨手势污染会让探针误判) */
  function dropPendingResize(): void {
    if (rafId != null) {
      try { cancelRaf(rafId) } catch {}
      rafId = null
    }
    pendingResize = null
    applyQueue = null
  }

  /** 等待在途的 resize 写入落地,避免读到过期的窗口尺寸 */
  function drainApplies(): Promise<boolean> {
    if (!applyQueue && !applying) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => { applyIdleWaiters.push(() => resolve(true)) })
  }

  /**
   * 指针位移:取「当前指针位置 - 手势起点指针位置」的绝对差。
   * 用绝对差而不是逐事件累加:事件丢包时绝对差不会丢位移,也不会累积漂移。
   * 坐标系在手势内保持一致:第一个真正在动的源胜出,之后不再切换。
   */
  function trackPointer(e: MouseEvent): { dx: number; dy: number } {
    curScreenX = e.screenX
    curScreenY = e.screenY
    curClientX = e.clientX
    curClientY = e.clientY
    if (!pointerSource) {
      // 位移小于阈值视为抖动,不锁定坐标系(否则 1px 抖动可能锁死一个"其实不动"的源)
      const sdx = Math.abs(curScreenX - startScreenX)
      const sdy = Math.abs(curScreenY - startScreenY)
      const cdx = Math.abs(curClientX - startClientX)
      const cdy = Math.abs(curClientY - startClientY)
      if (sdx >= POINTER_SOURCE_LOCK_THRESHOLD_PX || sdy >= POINTER_SOURCE_LOCK_THRESHOLD_PX) {
        pointerSource = 'screen'
      } else if (cdx >= POINTER_SOURCE_LOCK_THRESHOLD_PX || cdy >= POINTER_SOURCE_LOCK_THRESHOLD_PX) {
        pointerSource = 'client'
      }
    }
    if (pointerSource === 'client') {
      return { dx: curClientX - startClientX, dy: curClientY - startClientY }
    }
    return { dx: curScreenX - startScreenX, dy: curScreenY - startScreenY }
  }

  /** 采集本次手势的锚点(起始尺寸/位置),失败或手势已过期返回 false */
  async function captureAnchor(e: MouseEvent, seq: number): Promise<boolean> {
    // 缩放系数未知时继续用默认值会造成整手势的像素换算偏差 → 超时即中止本次手势
    let sf = 0
    try {
      sf = await withTimeoutReject(deps.getWindowScaleFactorSafe(), WINDOW_IPC_TIMEOUT_MS)
    } catch {
      resizing = false
      ready = false
      direction = ''
      return false
    }
    startScaleFactor = Number.isFinite(sf) && sf > 0 ? sf : 1
    // 新手势开始:清掉上一次手势的残留状态与待落地目标
    dropPendingResize()
    linuxProbePending = false
    linuxProbeResolving = false
    linuxPendingDeltaX = 0
    linuxPendingDeltaY = 0
    pointerSource = null
    // 新手势重新开始:清掉去重基线,否则窗口被外部改动后可能误跳过本应生效的目标
    lastAppliedWidth = -1
    lastAppliedHeight = -1
    lastAppliedX = Number.NaN
    lastAppliedY = Number.NaN
    startScreenX = e.screenX
    startScreenY = e.screenY
    startClientX = e.clientX
    startClientY = e.clientY
    curScreenX = e.screenX
    curScreenY = e.screenY
    curClientX = e.clientX
    curClientY = e.clientY
    ready = false
    resizing = false
    try {
      // 先等在途写入落地,否则基线可能读到旧尺寸(加超时,防止 IPC 挂起把状态机卡死)
      const drained = await withTimeout(drainApplies(), WINDOW_IPC_TIMEOUT_MS, false)
      // 世代校验必须在最前面:失配说明本次协程属于已结束的手势,
      // 直接裸返回,不得触碰任何共享状态(否则会抹掉新手势已设好的字段)。
      if (seq !== gestureSeq) return false
      if (!drained) {
        // 等不到在途写入落地:基线不可信,本次手势直接放弃
        resizing = false
        ready = false
        direction = ''
        return false
      }
      const w = deps.getCurrentWindow()
      const size = await withTimeout(w.innerSize(), WINDOW_IPC_TIMEOUT_MS, null as any)
      if (seq !== gestureSeq) return false
      const pos = await withTimeout(w.outerPosition(), WINDOW_IPC_TIMEOUT_MS, null as any)
      if (seq !== gestureSeq) return false
      if (!size || !pos) {
        resizing = false
        ready = false
        direction = ''
        return false
      }
      startWidth = size.width
      startHeight = size.height
      startPosX = pos.x
      startPosY = pos.y
      ready = true
      resizing = true
      return true
    } catch {
      resizing = false
      ready = false
      direction = ''
      return false
    }
  }

  /** Linux 手势:原生(合成器)与手动兜底并存,靠运行时探测决定归属 */
  async function handleLinuxDown(e: MouseEvent, dir: string, seq: number): Promise<void> {
    // 先取锚点:原生路径失败时手动兜底可以直接接管
    if (!(await captureAnchor(e, seq))) return
    if (seq !== gestureSeq) return

    linuxBaselineWidth = startWidth
    linuxBaselineHeight = startHeight
    linuxGestureMoved = false

    // 已知原生无效:不再调用原生接口,避免原生与手动同时改窗口
    if (linuxMode === 'manual') return

    const w = deps.getCurrentWindow()
    let nativeStarted = false
    try {
      // 原生路径:由合成器接管交互式 resize
      // (Wayland 下 serial 恒为 0,合成器会直接忽略,故探测会落到手动兜底)
      await w.startResizeDragging(resizeDirMap[dir as keyof typeof resizeDirMap])
      nativeStarted = true
    } catch {
      // 原生调用被拒(权限缺失 / 非 Tauri 运行时等):落到手动兜底
      nativeStarted = false
    }

    if (!nativeStarted) {
      linuxMode = 'manual'
      return
    }
    if (linuxMode === 'native') {
      // 已知合成器能接管:关闭手动路径,尺寸完全交给合成器
      resizing = false
      ready = false
      return
    }
    // unknown:先探测,探测窗口内不动尺寸,避免两条路径同时改窗口
    resizing = false
    ready = false
    linuxProbePending = true
  }

  /**
   * 探测合成器是否真的在改尺寸;过期手势的结果直接丢弃。
   * 判据只看「尺寸值是否偏离基线」,不依赖 resize 事件:
   * resize 事件是异步投递的,上一次无关改尺寸的迟到事件会被误当成本次手势的证据。
   */
  async function resolveLinuxProbe(seq: number): Promise<void> {
    // 同一次手势内的重复探测直接忽略;不同手势的探测靠 seq 区分
    if (linuxProbeResolving && linuxProbeSeq === seq) return
    linuxProbeResolving = true
    linuxProbeSeq = seq
    let decided = false
    let native = false
    try {
      // 给合成器一点时间应用第一次 resize
      await sleep(NATIVE_PROBE_DELAY_MS)
      if (seq !== gestureSeq) return
      let size: { width: number; height: number } | null = null
      try {
        size = await withTimeout(deps.getCurrentWindow().innerSize(), WINDOW_IPC_TIMEOUT_MS, null as any)
      } catch {}
      if (size) {
        native = size.width !== linuxBaselineWidth || size.height !== linuxBaselineHeight
        decided = true
      }
      // size 为 null:读取失败,本次不判定归属(保持 unknown),本手势仍走手动兜底
    } finally {
      // finally 一定会执行(即使上面 return),跨手势时只清理本次探测自身的标志位
      if (seq === gestureSeq) {
        linuxProbePending = false
        linuxProbeResolving = false
        if (decided) {
          if (native) {
            // 合成器在改尺寸:原生路径胜出,手动路径保持关闭直到本次手势结束
            linuxMode = 'native'
            resizing = false
            ready = false
          } else {
            // 合成器忽略了原生请求:手动兜底接管
            linuxMode = 'manual'
            ready = true
            resizing = true
          }
        } else {
          // 读取失败:不锁定模式,但本手势仍要能 resize
          ready = true
          resizing = true
        }
      } else if (linuxProbeSeq === seq) {
        linuxProbeResolving = false
      }
    }
    if (seq === gestureSeq && linuxMode !== 'native' && ready) {
      // 落地前再复核一次:若合成器此刻才应用了 resize(慢 WM),应交回原生路径,
      // 否则手动路径与迟到的原生 resize 会双写打架
      let latest: { width: number; height: number } | null = null
      try {
        latest = await withTimeout(deps.getCurrentWindow().innerSize(), WINDOW_IPC_TIMEOUT_MS, null as any)
      } catch {}
      if (seq !== gestureSeq) return
      if (latest && (latest.width !== linuxBaselineWidth || latest.height !== linuxBaselineHeight)) {
        linuxMode = 'native'
        resizing = false
        ready = false
        return
      }
      // 补上探测期间累计的增量,避免首个手势丢位移
      const r = computeResize({
        direction,
        startWidth,
        startHeight,
        startPosX,
        startPosY,
        deltaX: linuxPendingDeltaX,
        deltaY: linuxPendingDeltaY,
        scaleFactor: startScaleFactor,
      })
      scheduleApply(r)
    }
  }

  function onMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (!target?.classList?.contains(handleClass)) return
    if (!doc?.body?.classList?.contains('no-native-decorations')) return
    e.preventDefault()
    e.stopPropagation()
    direction = (target as any).dataset?.resizeDir || ''
    const seq = ++gestureSeq
    void handleDown(e, direction, seq)
  }

  async function handleDown(e: MouseEvent, dir: string, seq: number): Promise<void> {
    if (isLinux() && dir in resizeDirMap) {
      await handleLinuxDown(e, dir, seq)
      return
    }
    await captureAnchor(e, seq)
  }

  function onMouseMove(e: MouseEvent): void {
    if (!resizing && !linuxProbePending) {
      // native 模式下同样要跟踪手势是否发生过位移:有位移但尺寸始终没变 → 原生路径失效
      if (linuxMode === 'native' && (e.buttons & 1) !== 0) linuxGestureMoved = true
      return
    }
    // mouseup 可能发生在窗口外,用 buttons 状态兜底,避免"松开鼠标还在 resize"
    if ((e.buttons & 1) === 0) {
      endGesture(true)
      return
    }
    linuxGestureMoved = true
    const ptr = trackPointer(e)
    if (linuxProbePending) {
      // 探测期间只累计增量,不立即改尺寸
      linuxPendingDeltaX = ptr.dx * startScaleFactor
      linuxPendingDeltaY = ptr.dy * startScaleFactor
      void resolveLinuxProbe(gestureSeq)
      return
    }
    if (!resizing || !ready) return
    const r = computeResize({
      direction,
      startWidth,
      startHeight,
      startPosX,
      startPosY,
      deltaX: ptr.dx * startScaleFactor,
      deltaY: ptr.dy * startScaleFactor,
      scaleFactor: startScaleFactor,
    })
    scheduleApply(r)
  }

  /** 按帧合并 resize 请求:一次手势内高频 mousemove 只落地一次 setSize */
  function scheduleApply(r: ComputeResizeResult): void {
    pendingResize = r
    if (rafId != null) return
    rafId = raf(() => {
      rafId = null
      const target = pendingResize
      pendingResize = null
      if (!target) return
      applyQueue = target
      pumpApplies()
    })
  }

  /**
   * 串行落地 resize:同一时刻只允许一个 setSize 在途。
   * 连续两帧的 setSize 若并发,后到的旧目标可能后落地 → 尺寸回跳一帧。
   * 队列只保留最新目标,避免积压。
   */
  function pumpApplies(): void {
    if (applying) return
    applying = true
    void (async () => {
      try {
        while (applyQueue) {
          const target = applyQueue
          applyQueue = null
          await applyResize(target)
        }
      } catch {
      } finally {
        applying = false
        if (!applyQueue) {
          const waiters = applyIdleWaiters.splice(0)
          for (const w of waiters) {
            try { w() } catch {}
          }
        }
      }
    })()
  }

  async function applyResize(r: ComputeResizeResult): Promise<void> {
    try {
      // 目标与上一次落地完全一致时跳过:指针停住后 mousemove 仍会持续到来,
      // 否则同一几何会被反复下发(实测一次拖拽重复下发十余次)。
      const width = Math.round(r.newWidth)
      const height = Math.round(r.newHeight)
      if (
        width === lastAppliedWidth
        && height === lastAppliedHeight
        && Math.round(r.newX) === lastAppliedX
        && Math.round(r.newY) === lastAppliedY
      ) return
      const w = deps.getCurrentWindow()
      // 用严格超时:超时要抛出去,否则会被当成成功并写入 lastApplied*,
      // 导致该目标被去重逻辑永久跳过、手势内无重试路径。
      const newX = Math.round(r.newX)
      const newY = Math.round(r.newY)
      if (newX !== Math.round(startPosX) || newY !== Math.round(startPosY)) {
        await withTimeoutReject(
          w.setPosition({ type: 'Physical', x: newX, y: newY } as any),
          WINDOW_IPC_TIMEOUT_MS,
        )
      }
      await withTimeoutReject(
        w.setSize({ type: 'Physical', width, height } as any),
        WINDOW_IPC_TIMEOUT_MS,
      )
      lastAppliedWidth = width
      lastAppliedHeight = height
      lastAppliedX = newX
      lastAppliedY = newY
    } catch {}
  }

  /** 立即落地待处理目标(手势结束时补上最后一帧,避免最终尺寸差一帧) */
  function flushPendingResize(): void {
    if (rafId != null) {
      try { cancelRaf(rafId) } catch {}
      rafId = null
    }
    const target = pendingResize
    pendingResize = null
    if (!target) return
    applyQueue = target
    pumpApplies()
  }

  /** 结束当前手势:清空所有进行中的状态 */
  function endGesture(flush = false): void {
    resizing = false
    direction = ''
    ready = false
    linuxProbePending = false
    linuxProbeResolving = false
    // 手势结束即作废在途探测:探测返回后不能再把 ready/resizing 重新置真,
    // 否则一次已经松开的手势会复活 resize 状态,污染下一次手势的基线。
    gestureSeq++
    if (flush) flushPendingResize()
    else dropPendingResize()
    if (maximizedResyncPending) scheduleMaximizedResync()
  }

  function onMouseUp(): void {
    // 判定失准时降级为 unknown,下次手势重新探测:
    //   native 模式:有位移但尺寸始终没变 → 原生路径其实无效;
    //   manual 模式:有位移但尺寸始终没变 → 手动路径其实没生效(误判成 manual 的兜底)。
    const wasNative = linuxMode === 'native'
    const wasManual = linuxMode === 'manual'
    const moved = linuxGestureMoved
    const baseW = linuxBaselineWidth
    const baseH = linuxBaselineHeight
    endGesture(true)
    if ((wasNative || wasManual) && moved) {
      void (async () => {
        try {
          const s = await withTimeout(deps.getCurrentWindow().innerSize(), WINDOW_IPC_TIMEOUT_MS, null as any)
          if (s && s.width === baseW && s.height === baseH) linuxMode = 'unknown'
        } catch {}
      })()
    }
  }

  function onBlur(): void {
    endGesture()
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
    if (win) {
      win.addEventListener('blur', onBlur as any)
      if (isLinux()) win.addEventListener('resize', scheduleMaximizedResync as any)
    }
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
    try { win?.removeEventListener('resize', scheduleMaximizedResync as any) } catch {}
    try { maximizedBinding?.dispose() } catch {}
    maximizedBinding = null
    if (maximizedResyncTimer != null) {
      try { clearTimeout(maximizedResyncTimer) } catch {}
      maximizedResyncTimer = null
    }
    endGesture()
  }

  return {
    init,
    computeResize,
    stop,
    getLinuxResizeMode: () => linuxMode,
    getPointerSource: () => pointerSource,
    applyMaximizedState: (isMax: boolean) => setMaximizedClass(!!isMax),
  }
}
