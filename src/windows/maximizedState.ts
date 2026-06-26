export type WindowMaximizedStateBinding = {
  dispose: () => void
  syncNow: () => Promise<void>
}

// 简化:不再监听 onResized / flymd://window-maximized-changed。
// macOS WKWebView 上任何调 isMaximized() 都会触发 Tauri #5812/#13199 描述的
// looped resize 死循环(100% CPU + webview IPC 全部挂起,导致调整尺寸后
// 拖拽/按钮/Cmd+Q 全部失效)。即使通过 setTimeout debounce / inFlight guard
// 把循环降到 20Hz,慢循环仍会抢 IPC 通道,导致所有按钮失效。
//
// 修复策略:彻底放弃"实时同步 isMaximized 状态变化"路径。
// - 前端不再订阅 onResized 监听(全平台)
// - 前端不再 listen "flymd://window-maximized-changed" 事件(全平台)
// - 按钮图标的刷新完全靠"点最大化按钮 → 主动 syncNow"路径
//   (单次调 isMaximized 不会触发死循环,死循环需要"在 onResized 回调里再次调")
//
// 代价:用户用键盘 / 系统菜单最大化时,按钮图标不实时更新;
// 只在点自定义最大化按钮时更新。可接受。

export async function bindWindowMaximizedState(
  getWindow: () => any,
  applyState: (isMaximized: boolean) => void,
): Promise<WindowMaximizedStateBinding> {
  let disposed = false

  const setState = (isMaximized: boolean) => {
    if (disposed) return
    applyState(!!isMaximized)
  }

  const syncNow = async (): Promise<void> => {
    if (disposed) return
    try {
      const win = getWindow()
      setState(await win.isMaximized())
    } catch {
      // 静默吞掉,不影响其它路径
    }
  }

  // baseline 一次初始同步,然后不再自动轮询
  await syncNow()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
    },
    syncNow,
  }
}
