export type WindowMaximizedStateBinding = {
  dispose: () => void
  syncNow: () => Promise<void>
}

function readMaximizedPayload(event: any): boolean | null {
  if (typeof event === 'boolean') return event
  const payload = event && typeof event === 'object' ? (event as any).payload : null
  return typeof payload === 'boolean' ? payload : null
}

// macOS 上的 isMaximized() 实现存在已知问题(参见 tauri-apps/tauri#5812 / #13199):
// 在 tauri://resize 事件回调里同步调 isMaximized() 会触发 looped resize events,
// 表现为 100% CPU + 内存爆炸 + webview IPC 全部挂起,导致顶部交互 / Cmd+Q /
// 关闭按钮全部失效。这里用三个机制避开:
// 1) 异步隔离:onResized 回调里把 syncNow 推到 setTimeout,不在 resize 同步路径调
// 2) scheduleSync debounce:已有 pending timer 时不再排新的,避免堆积
// 3) re-entrancy guard:inFlight 期间合并请求,完成后补一次
//
// MACOS_RESIZE_DEFER_MS 给一个非零值(50ms),即使 isMaximized() 触发额外 resize
// 事件,异步循环频率也能限制在 < 20 Hz,不再造成 100% CPU。
const MACOS_RESIZE_DEFER_MS = 50

// 统一把窗口最大化状态同步给前端控件。
// 不信任“按钮刚刚点过”，只信任窗口当前真实状态。
export async function bindWindowMaximizedState(
  getWindow: () => any,
  applyState: (isMaximized: boolean) => void,
): Promise<WindowMaximizedStateBinding> {
  const unlisteners: Array<() => void> = []
  let disposed = false
  // re-entrancy guard:true 表示当前已有一次 syncNow 在飞,新的请求被忽略
  let inFlight = false
  // pending 表示在 inFlight 期间收到过一次新请求,需要等当前完成后补一次
  let pending = false
  // scheduleSync debounce:已有 setTimeout 排队时直接 return,避免 resize 风暴期间堆积 timer
  let syncTimer: ReturnType<typeof setTimeout> | null = null

  const setState = (isMaximized: boolean) => {
    if (disposed) return
    applyState(!!isMaximized)
  }

  const syncNow = async (): Promise<void> => {
    if (disposed) return
    if (inFlight) {
      // 已有一次调用在飞,标记 pending;当前完成后会补一次,保证最终一致
      pending = true
      return
    }
    inFlight = true
    try {
      const win = getWindow()
      setState(await win.isMaximized())
    } catch {
      // 静默吞掉,不影响其它路径
    } finally {
      inFlight = false
      // 期间收到过新请求 -> 补一次(走 scheduleSync 异步再起,避免栈溢出)
      if (pending && !disposed) {
        pending = false
        scheduleSync()
      }
    }
  }

  // 异步隔离:onResized 回调同步路径不直接调 syncNow,推到下一事件循环
  // debounce:已有 pending timer 时不再排新的
  const scheduleSync = () => {
    if (disposed) return
    if (syncTimer !== null) return
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncNow()
    }, MACOS_RESIZE_DEFER_MS)
  }

  await syncNow()

  try {
    const win = getWindow()
    try {
      const off = await win.onResized(() => {
        // 关键修复:不直接 void syncNow(),而是 scheduleSync 推到下一 tick
        scheduleSync()
      })
      if (typeof off === 'function') unlisteners.push(off)
    } catch {}
    try {
      const off = await win.listen('flymd://window-maximized-changed', (event: any) => {
        const payload = readMaximizedPayload(event)
        if (payload == null) {
          // 没有 payload 时也走异步路径,避开 onResized 同步链
          scheduleSync()
          return
        }
        setState(payload)
      })
      if (typeof off === 'function') unlisteners.push(off)
    } catch {}
  } catch {}

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      // 清理 pending timer,避免 dispose 后还在 fire
      if (syncTimer !== null) {
        try { clearTimeout(syncTimer) } catch {}
        syncTimer = null
      }
      for (const off of unlisteners.splice(0)) {
        try { off() } catch {}
      }
    },
    syncNow,
  }
}
