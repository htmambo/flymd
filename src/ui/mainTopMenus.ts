// 顶部"文件"和"模式"两个下拉菜单的 items 构造
// 抽离自 main.ts:7237-7340。
// 抽离理由:showFileMenu / showModeMenu 是两个具体下拉菜单,核心逻辑(items 构造 + 异步依赖)与
// main.ts 其他状态耦合度高(16+ 闭包),适合用 factory 模式参数化。
// ui/topMenu.ts 是通用下拉容器(可复用),mainTopMenus 是具体菜单内容构造器,职责分离。
//
// showFileMenu 依赖:getAutoSave / isPortableModeEnabled / openFile2 / renderRecentPanel / saveFile /
// saveAs / handleExportConfigFromMenu / handleImportConfigFromMenu / togglePortableModeFromMenu /
// openFileWatchPrefsDialog + t(翻译)
// showModeMenu 依赖:saveScrollPosition / restoreScrollPosition / setWysiwygEnabled / notifyModeChange /
// preview / editor / mode 读写 / syncToggleButton / updateChromeColorsForMode / renderPreview /
// flymdGetSplitPreviewEnabled + t

import { showTopMenu, type TopMenuItemSpec } from './topMenu'

export interface MainTopMenusDeps {
  // 翻译
  t: (key: string) => string
  // 工具函数
  getAutoSave: () => { isEnabled: () => boolean; toggle: () => void }
  isPortableModeEnabled: () => Promise<boolean>
  // 文件操作
  openFile2: () => Promise<void> | void
  saveFile: () => Promise<void> | void
  saveAs: () => Promise<void> | void
  renderRecentPanel: (open: boolean) => Promise<void> | void
  handleExportConfigFromMenu: () => Promise<void> | void
  handleImportConfigFromMenu: () => Promise<void> | void
  togglePortableModeFromMenu: () => Promise<void> | void
  openFileWatchPrefsDialog: () => Promise<void> | void
  // 模式/滚动
  saveScrollPosition: () => void
  restoreScrollPosition: () => void
  setWysiwygEnabled: (v: boolean) => Promise<void> | void
  notifyModeChange: () => void
  syncToggleButton: () => void
  updateChromeColorsForMode: (mode: 'edit' | 'preview') => void
  renderPreview: () => Promise<void> | void
  // DOM 引用
  preview: HTMLDivElement
  editor: HTMLTextAreaElement
  // 状态 getter/setter
  getMode: () => 'edit' | 'preview'
  setMode: (m: 'edit' | 'preview') => void
  getWysiwyg: () => boolean
  // 全局钩子
  flymdGetSplitPreviewEnabled?: () => boolean
}

export interface MainTopMenus {
  showFileMenu: () => void
  showModeMenu: () => void
}

export function createMainTopMenus(deps: MainTopMenusDeps): MainTopMenus {
  function showFileMenu(): void {
    const anchor = document.getElementById('btn-open') as HTMLDivElement | null
    if (!anchor) return
    void (async () => {
      const autoSave = deps.getAutoSave()
      const autoSaveEnabled = autoSave.isEnabled()
      let portableEnabled = false
      try {
        portableEnabled = await deps.isPortableModeEnabled()
      } catch {}
      const items: TopMenuItemSpec[] = [
        { label: deps.t('file.open'), accel: 'Ctrl+O', action: () => { void deps.openFile2() } },
        // "最近文件"入口移入 文件 菜单
        { label: deps.t('menu.recent'), accel: 'Ctrl+Shift+R', action: () => { void deps.renderRecentPanel(true) } },
        {
          // 启用时在前面加上对勾
          label: `${autoSaveEnabled ? '✔ ' : ''}${deps.t('file.autosave')}`,
          accel: '60s',
          action: () => { autoSave.toggle() },
        },
        { label: deps.t('file.save'), accel: 'Ctrl+S', action: () => { void deps.saveFile() } },
        { label: deps.t('file.saveas'), accel: 'Ctrl+Shift+S', action: () => { void deps.saveAs() } },
      ]
      // 配置相关操作移动到"文件"菜单
      items.push({
        label: deps.t('menu.exportConfig') || '导出配置',
        accel: '',
        action: () => { void deps.handleExportConfigFromMenu() },
      })
      items.push({
        label: deps.t('menu.importConfig') || '导入配置',
        accel: '',
        action: () => { void deps.handleImportConfigFromMenu() },
      })
      items.push({
        label: `${portableEnabled ? '✔ ' : ''}${deps.t('menu.portableMode') || '便携模式'}`,
        accel: '',
        action: () => { void deps.togglePortableModeFromMenu() },
      })
      items.push({
        label: deps.t('menu.filewatchPrefs') || '文件监听设置…',
        accel: '',
        action: () => { void deps.openFileWatchPrefsDialog() },
      })
      showTopMenu(anchor, items)
    })()
  }

  function showModeMenu(): void {
    const anchor = document.getElementById('btn-mode') as HTMLDivElement | null
    if (!anchor) return
    const splitEnabled = !!(deps.flymdGetSplitPreviewEnabled?.())
    showTopMenu(anchor, [
      { label: deps.t('mode.edit'), accel: 'Ctrl+E', action: async () => {
        deps.saveScrollPosition()
        if (deps.getWysiwyg()) {
          try { await deps.setWysiwygEnabled(false) } catch {}
          deps.restoreScrollPosition()
          try { deps.notifyModeChange() } catch {}
          return
        }
        if (deps.getMode() !== 'edit') {
          deps.setMode('edit')
          try { deps.preview.classList.add('hidden') } catch {}
          try { deps.editor.focus() } catch {}
          try { deps.syncToggleButton() } catch {}
          try { deps.updateChromeColorsForMode('edit') } catch {}
          deps.restoreScrollPosition()
          try { deps.notifyModeChange() } catch {}
        }
      } },
      { label: deps.t('mode.read'), accel: 'Ctrl+R', action: async () => {
        deps.saveScrollPosition()
        const wasWysiwyg = deps.getWysiwyg()
        if (wasWysiwyg) { try { await deps.setWysiwygEnabled(false) } catch {} }
        deps.setMode('preview')
        try { deps.preview.classList.remove('hidden') } catch {}
        try { await deps.renderPreview() } catch {}
        try { deps.syncToggleButton() } catch {}
        try { deps.updateChromeColorsForMode('preview') } catch {}
        deps.restoreScrollPosition()
        try { deps.notifyModeChange() } catch {}
      } },
      { label: deps.t('mode.wysiwyg'), accel: 'Ctrl+W', action: async () => {
        try { await deps.setWysiwygEnabled(true) } catch {}
        try { deps.notifyModeChange() } catch {}
      } },
      {
        label: `${splitEnabled ? '✓ ' : ''}源码 + 阅读分屏`,
        accel: 'Ctrl+Shift+E',
        action: () => {
          try {
            const fm = (window as any)
            if (typeof fm.flymdToggleSplitPreview === 'function') {
              fm.flymdToggleSplitPreview()
            } else {
              alert('当前环境不支持分屏功能')
            }
          } catch {}
        }
      },
    ])
  }

  return { showFileMenu, showModeMenu }
}
