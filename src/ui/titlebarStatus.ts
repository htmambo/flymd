// 顶栏标题/状态栏/滚动位置同步层
// 抽离自 main.ts:2853-2901 + 3617-3630 + 3850-3902 + 4669-4674
// 抽离理由:8 个状态镜像函数共享 main-local 引用(editor/preview/mode/wysiwyg/...),
// 但自身不挂 DOM 事件,纯 getter/setter 注入即可独立测试。factory 内部封装 3 个
// 上一帧缓存(标题/提示/OS 标题),避免重复写入。
// 工厂模式:createTitlebarStatus(deps) → {refreshTitle, refreshStatus, syncToggleButton, setUpdateBadge,
//   getScrollPercent, setScrollPercent, saveScrollPosition, restoreScrollPosition}

export interface TitlebarStatusDeps {
  /** 当前文件路径(可能为 null) */
  getCurrentFilePath: () => string | null
  /** 是否脏 */
  getDirty: () => boolean
  /** 顶栏文件名显示元素 */
  filenameLabel: HTMLElement
  /** 底部状态栏显示元素 */
  status: HTMLElement
  /** 编辑器(用于状态栏行列字 + 滚动,需 textarea 接口) */
  editor: HTMLTextAreaElement
  /** 预览面板(用于滚动) */
  preview: HTMLElement
  /** 模式 getter */
  getMode: () => 'edit' | 'preview'
  /** WYSIWYG 启用态 getter */
  getWysiwyg: () => boolean
  /** 上次保存的滚动百分比 读写器(由外部缓存) */
  getLastScrollPercent: () => number
  setLastScrollPercent: (p: number) => void
  /** WYSIWYG 提供的快速位置查询(可选) */
  flymdGetSourceEditorPositionInfo?: (pos: number) => { row?: number; col?: number; chars?: number } | null
  /** Tauri getCurrentWindow(用于 setTitle) */
  getCurrentWindow?: () => any
  /** 标题文本 i18n(未命名) */
  t: (key: string) => string
  /** 格式化状态栏(行,列)的纯函数 */
  fmtStatus: (row: number, col: number) => string
  /** 触发大纲更新(标题变时) */
  scheduleOutlineUpdate: () => void
}

export interface TitlebarStatusApi {
  refreshTitle: () => void
  refreshStatus: () => void
  syncToggleButton: () => void
  setUpdateBadge: (on: boolean, tip?: string) => void
  getScrollPercent: () => number
  setScrollPercent: (percent: number) => void
  saveScrollPosition: () => void
  restoreScrollPosition: (retries?: number, delay?: number) => void
}

const APP_TITLE_SUFFIX = ' - 飞速MarkDown'
const OS_TITLE_FALLBACK = '飞速MarkDown'

export function createTitlebarStatus(deps: TitlebarStatusDeps): TitlebarStatusApi {
  let lastTitleLabel = ''
  let lastTitleTooltip = ''
  let lastOsTitle = ''

  function refreshTitle(): void {
    const full = deps.getCurrentFilePath() || ''
    const name = full
      ? (full.split(/[/\\]/).pop() || deps.t('filename.untitled'))
      : deps.t('filename.untitled')
    const label = name + (deps.getDirty() ? ' *' : '')
    const titleTip = full || name
    if (lastTitleLabel !== label) {
      deps.filenameLabel.textContent = label
      document.title = label
      lastTitleLabel = label
    }
    if (lastTitleTooltip !== titleTip) {
      try { deps.filenameLabel.title = titleTip } catch {}
      lastTitleTooltip = titleTip
    }
    const osTitle = `${label}${APP_TITLE_SUFFIX}`
    if (lastOsTitle !== osTitle) {
      try { void deps.getCurrentWindow?.().setTitle(osTitle).catch(() => {}) } catch {}
      lastOsTitle = osTitle
    }
    try { deps.scheduleOutlineUpdate() } catch {}
  }

  function refreshStatus(): void {
    const ed = deps.editor as any as HTMLTextAreaElement
    const pos = ed.selectionStart >>> 0
    const fastInfo = (() => {
      try { return deps.flymdGetSourceEditorPositionInfo?.(pos) || null } catch { return null }
    })()
    let row = fastInfo?.row ?? 0
    let col = fastInfo?.col ?? 0
    if (!fastInfo) {
      const until = ed.value.slice(0, pos)
      const parts = until.split('\n')
      row = parts.length
      col = (parts[parts.length - 1]?.length ?? 0) + 1
    }
    if (row < 1) row = 1
    if (col < 1) col = 1
    const chars = fastInfo?.chars ?? ed.value.length
    deps.status.textContent = deps.fmtStatus(row, col) + `, 字 ${chars}`
  }

  function syncToggleButton(): void {
    try {
      const btn = document.getElementById('btn-toggle') as HTMLButtonElement | null
      if (btn) btn.textContent = deps.getMode() === 'edit' ? '预览' : '编辑'
    } catch {}
  }

  function setUpdateBadge(on: boolean, tip?: string): void {
    try {
      const btn = document.getElementById('btn-update') as HTMLDivElement | null
      if (!btn) return
      if (on) {
        btn.classList.add('has-update')
        if (tip) btn.title = tip
      } else {
        btn.classList.remove('has-update')
      }
    } catch {}
  }

  function getScrollPercent(): number {
    try {
      if (deps.getWysiwyg()) {
        const el = (document.querySelector('#md-wysiwyg-root .scrollView') || document.getElementById('md-wysiwyg-root')) as HTMLElement | null
        if (!el) return 0
        const max = el.scrollHeight - el.clientHeight
        return max > 0 ? el.scrollTop / max : 0
      }
      if (deps.getMode() === 'preview') {
        const max = deps.preview.scrollHeight - deps.preview.clientHeight
        return max > 0 ? deps.preview.scrollTop / max : 0
      }
      const max = deps.editor.scrollHeight - deps.editor.clientHeight
      return max > 0 ? deps.editor.scrollTop / max : 0
    } catch {
      return 0
    }
  }

  function setScrollPercent(percent: number): void {
    try {
      const p = Math.max(0, Math.min(1, percent))
      if (deps.getWysiwyg()) {
        const el = (document.querySelector('#md-wysiwyg-root .scrollView') || document.getElementById('md-wysiwyg-root')) as HTMLElement | null
        if (el) el.scrollTop = p * (el.scrollHeight - el.clientHeight)
      } else if (deps.getMode() === 'preview') {
        deps.preview.scrollTop = p * (deps.preview.scrollHeight - deps.preview.clientHeight)
      } else {
        deps.editor.scrollTop = p * (deps.editor.scrollHeight - deps.editor.clientHeight)
      }
      try { document.documentElement.scrollTop = 0 } catch {}
      try { document.body.scrollTop = 0 } catch {}
    } catch {}
  }

  function saveScrollPosition(): void {
    deps.setLastScrollPercent(getScrollPercent())
  }

  function restoreScrollPosition(retries = 3, delay = 50): void {
    const apply = () => setScrollPercent(deps.getLastScrollPercent())
    apply()
    if (retries > 0) {
      setTimeout(() => apply(), delay)
      if (retries > 1) setTimeout(() => apply(), delay * 2)
      if (retries > 2) setTimeout(() => apply(), delay * 4)
    }
  }

  return {
    refreshTitle,
    refreshStatus,
    syncToggleButton,
    setUpdateBadge,
    getScrollPercent,
    setScrollPercent,
    saveScrollPosition,
    restoreScrollPosition,
  }
}
