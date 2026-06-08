// 平台相关的 init:platform class + window drag。
// 抽离自 main.ts。

interface Deps {
  isCompactTitlebarEnabled: () => boolean
  isFocusModeEnabled: () => boolean
  getStickyNoteMode: () => boolean
  getStickyNoteLocked: () => boolean
  getCurrentWindow: () => { startDragging: () => Promise<void> } | null
}

export interface PlatformInitApi {
  initPlatformClass: () => void
  initWindowDrag: () => void
}

export function createPlatformInit(deps: Deps): PlatformInitApi {
  function initPlatformClass() {
    const platform = (navigator.platform || '').toLowerCase()
    if (platform.includes('win')) {
      document.body.classList.add('platform-windows')
    } else if (platform.includes('mac')) {
      document.body.classList.add('platform-mac')
    } else if (platform.includes('linux')) {
      document.body.classList.add('platform-linux')
    }
  }

  function initWindowDrag() {
    const platform = (navigator.platform || '').toLowerCase()
    const isMac = platform.includes('mac')
    const isLinux = platform.includes('linux')
    // Windows 上原生 + -webkit-app-region 已足够。
    // macOS / Linux：webview 对 -webkit-app-region 支持不一致,且 macOS 上还可能吞点击,这里统一用 startDragging 兜底。
    if (!isMac && !isLinux) return

    // 当前主布局使用 tabbar-row;titlebar 仅为旧布局兼容
    const titlebar = document.querySelector('.tabbar-row, .titlebar') as HTMLElement | null
    if (!titlebar) return

    const shouldIgnoreTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el) return false
      // 标签栏/窗口控制等可交互区域必须排除,否则会把点击/拖拽排序等交互变成拖动窗口
      return !!el.closest(
        '.window-controls, .menu-item, button, a, input, textarea, [data-tauri-drag-ignore], .tabbar-tab, .tabbar-new-btn',
      )
    }

    titlebar.addEventListener('mousedown', (ev: MouseEvent) => {
      if (ev.button !== 0) return
      // 便签锁定或未开启紧凑/专注标题栏时,不处理拖动
      if (deps.getStickyNoteLocked()) return
      if (!(deps.isCompactTitlebarEnabled() || deps.isFocusModeEnabled() || deps.getStickyNoteMode())) return
      if (shouldIgnoreTarget(ev.target)) return
      try {
        const win = deps.getCurrentWindow()
        void win?.startDragging()
      } catch {}
    })
  }

  return { initPlatformClass, initWindowDrag }
}
