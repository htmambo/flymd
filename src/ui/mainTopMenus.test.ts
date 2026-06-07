// @vitest-environment jsdom
// 测试 mainTopMenus:覆盖 showFileMenu / showModeMenu 构造的 menu items
// 关注点:
// 1) 文件菜单包含 9 项(打开/最近/自动保存/保存/另存为/导出/导入/便携模式/文件监听)
// 2) 自动保存启用时 label 加 ✔ 前缀
// 3) 便携模式启用时 label 加 ✔ 前缀
// 4) 模式菜单包含 4 项(编辑/阅读/所见/分屏)
// 5) 分屏开关启用时 label 加 ✓ 前缀
// 6) 翻译键缺失时回退到硬编码文案
// 7) 模式菜单的 mode/edit 切换调用正确 deps

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMainTopMenus, type MainTopMenusDeps } from './mainTopMenus'

// 捕获 showTopMenu 调用时的 items
let lastItems: any[] = []
let lastAnchor: HTMLElement | null = null
vi.mock('./topMenu', () => ({
  showTopMenu: (anchor: HTMLElement, items: any[]) => {
    lastAnchor = anchor
    lastItems = items
  },
}))

function makeDeps(overrides: Partial<MainTopMenusDeps> = {}): MainTopMenusDeps {
  return {
    t: overrides.t ?? ((k: string) => k),
    getAutoSave: overrides.getAutoSave ?? (() => ({ isEnabled: () => false, toggle: () => {} })),
    isPortableModeEnabled: overrides.isPortableModeEnabled ?? (async () => false),
    openFile2: overrides.openFile2 ?? (vi.fn() as any),
    saveFile: overrides.saveFile ?? (vi.fn() as any),
    saveAs: overrides.saveAs ?? (vi.fn() as any),
    renderRecentPanel: overrides.renderRecentPanel ?? (vi.fn() as any),
    handleExportConfigFromMenu: overrides.handleExportConfigFromMenu ?? (vi.fn() as any),
    handleImportConfigFromMenu: overrides.handleImportConfigFromMenu ?? (vi.fn() as any),
    togglePortableModeFromMenu: overrides.togglePortableModeFromMenu ?? (vi.fn() as any),
    openFileWatchPrefsDialog: overrides.openFileWatchPrefsDialog ?? (vi.fn() as any),
    saveScrollPosition: overrides.saveScrollPosition ?? (vi.fn() as any),
    restoreScrollPosition: overrides.restoreScrollPosition ?? (vi.fn() as any),
    setWysiwygEnabled: overrides.setWysiwygEnabled ?? (vi.fn() as any),
    notifyModeChange: overrides.notifyModeChange ?? (vi.fn() as any),
    syncToggleButton: overrides.syncToggleButton ?? (vi.fn() as any),
    updateChromeColorsForMode: overrides.updateChromeColorsForMode ?? (vi.fn() as any),
    renderPreview: overrides.renderPreview ?? (vi.fn() as any),
    preview: overrides.preview ?? (document.createElement('div')),
    editor: overrides.editor ?? (document.createElement('textarea')),
    getMode: overrides.getMode ?? (() => 'edit'),
    setMode: overrides.setMode ?? (vi.fn() as any),
    getWysiwyg: overrides.getWysiwyg ?? (() => false),
    flymdGetSplitPreviewEnabled: overrides.flymdGetSplitPreviewEnabled,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  lastItems = []
  lastAnchor = null
  // 创建一个 #btn-open 锚点(默认)
  const btn = document.createElement('div')
  btn.id = 'btn-open'
  document.body.appendChild(btn)
})

afterEach(() => {
  document.body.innerHTML = ''
})

function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('showFileMenu', () => {
  it('builds 9 items with expected labels', async () => {
    const menus = createMainTopMenus(makeDeps())
    menus.showFileMenu()
    await flushAsync()
    expect(lastItems.length).toBe(9)
    const labels = lastItems.map(it => it.label)
    expect(labels[0]).toBe('file.open')
    expect(labels[1]).toBe('menu.recent')
    expect(labels[2]).toBe('file.autosave') // no ✔ when disabled
    expect(labels[3]).toBe('file.save')
    expect(labels[4]).toBe('file.saveas')
  })

  it('prepends ✔ to autosave label when enabled', async () => {
    const menus = createMainTopMenus(makeDeps({
      getAutoSave: () => ({ isEnabled: () => true, toggle: () => {} }),
    }))
    menus.showFileMenu()
    await flushAsync()
    const autosaveItem = lastItems.find(it => it.label.includes('autosave'))
    expect(autosaveItem?.label).toBe('✔ file.autosave')
  })

  it('prepends ✔ to portable mode label when enabled', async () => {
    const menus = createMainTopMenus(makeDeps({
      isPortableModeEnabled: async () => true,
    }))
    menus.showFileMenu()
    await flushAsync()
    const portableItem = lastItems.find(it => it.label.includes('portableMode'))
    expect(portableItem?.label).toBe('✔ menu.portableMode')
  })

  it('falls back to hardcoded label when t() returns empty', async () => {
    const menus = createMainTopMenus(makeDeps({
      t: (k: string) => (k === 'menu.exportConfig' ? '' : k),
    }))
    menus.showFileMenu()
    await flushAsync()
    const exportItem = lastItems.find(it => it.label === '导出配置')
    expect(exportItem).toBeTruthy()
  })

  it('uses anchor #btn-open', async () => {
    const menus = createMainTopMenus(makeDeps())
    menus.showFileMenu()
    await flushAsync()
    expect(lastAnchor?.id).toBe('btn-open')
  })

  it('does nothing if anchor missing', () => {
    document.body.innerHTML = ''
    const menus = createMainTopMenus(makeDeps())
    menus.showFileMenu()
    expect(lastItems.length).toBe(0)
  })

  it('toggling autosave calls autoSave.toggle()', async () => {
    const toggle = vi.fn()
    const menus = createMainTopMenus(makeDeps({
      getAutoSave: () => ({ isEnabled: () => false, toggle }),
    }))
    menus.showFileMenu()
    await flushAsync()
    const autosaveItem = lastItems.find(it => it.label.includes('autosave'))
    autosaveItem?.action()
    expect(toggle).toHaveBeenCalledOnce()
  })
})

describe('showModeMenu', () => {
  beforeEach(() => {
    const btn = document.createElement('div')
    btn.id = 'btn-mode'
    document.body.appendChild(btn)
  })

  it('builds 4 items', () => {
    const menus = createMainTopMenus(makeDeps())
    menus.showModeMenu()
    expect(lastItems.length).toBe(4)
  })

  it('uses anchor #btn-mode', () => {
    const menus = createMainTopMenus(makeDeps())
    menus.showModeMenu()
    expect(lastAnchor?.id).toBe('btn-mode')
  })

  it('prepends ✓ to split item when flymdGetSplitPreviewEnabled returns true', () => {
    const menus = createMainTopMenus(makeDeps({
      flymdGetSplitPreviewEnabled: () => true,
    }))
    menus.showModeMenu()
    const splitItem = lastItems.find(it => it.label.includes('分屏'))
    expect(splitItem?.label).toBe('✓ 源码 + 阅读分屏')
  })

  it('edit action: when already in edit mode, no setMode call', async () => {
    const setMode = vi.fn()
    const menus = createMainTopMenus(makeDeps({
      getMode: () => 'edit',
      setMode,
    }))
    menus.showModeMenu()
    const editItem = lastItems.find(it => it.label === 'mode.edit')
    await editItem?.action()
    expect(setMode).not.toHaveBeenCalled()
  })

  it('edit action: when in preview mode, calls setMode("edit") + chain', async () => {
    const setMode = vi.fn()
    const syncToggleButton = vi.fn()
    const menus = createMainTopMenus(makeDeps({
      getMode: () => 'preview',
      setMode,
      syncToggleButton,
    }))
    menus.showModeMenu()
    const editItem = lastItems.find(it => it.label === 'mode.edit')
    await editItem?.action()
    expect(setMode).toHaveBeenCalledWith('edit')
    expect(syncToggleButton).toHaveBeenCalled()
  })

  it('read action switches to preview mode and renders', async () => {
    const setMode = vi.fn()
    const renderPreview = vi.fn()
    const menus = createMainTopMenus(makeDeps({
      getMode: () => 'edit',
      setMode,
      renderPreview,
    }))
    menus.showModeMenu()
    const readItem = lastItems.find(it => it.label === 'mode.read')
    await readItem?.action()
    expect(setMode).toHaveBeenCalledWith('preview')
    expect(renderPreview).toHaveBeenCalled()
  })

  it('split action falls back to alert when window.flymdToggleSplitPreview missing', () => {
    const alertSpy = vi.fn()
    ;(globalThis as any).alert = alertSpy
    const menus = createMainTopMenus(makeDeps())
    menus.showModeMenu()
    const splitItem = lastItems.find(it => it.label.includes('分屏'))
    splitItem?.action()
    expect(alertSpy).toHaveBeenCalledWith('当前环境不支持分屏功能')
  })
})
