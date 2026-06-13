// 扩展管理面板异步门面
// 避免启动时加载整个 extensionsPanel chunk

import type {
  initExtensionsPanel,
  refreshExtensionsUI,
  showExtensionsOverlay,
  prewarmExtensionsPanel,
  ExtensionsPanelHost,
} from './extensionsPanel'

type ExtensionsPanelMod = {
  initExtensionsPanel: typeof initExtensionsPanel
  refreshExtensionsUI: typeof refreshExtensionsUI
  showExtensionsOverlay: typeof showExtensionsOverlay
  prewarmExtensionsPanel: typeof prewarmExtensionsPanel
}

let _modPromise: Promise<ExtensionsPanelMod> | null = null

function loadMod(): Promise<ExtensionsPanelMod> {
  if (!_modPromise) {
    _modPromise = import('./extensionsPanel') as Promise<ExtensionsPanelMod>
  }
  return _modPromise
}

export async function initExtensionsPanel(host: ExtensionsPanelHost): Promise<void> {
  const mod = await loadMod()
  return mod.initExtensionsPanel(host)
}

export async function refreshExtensionsUI(): Promise<void> {
  const mod = await loadMod()
  return mod.refreshExtensionsUI()
}

export async function showExtensionsOverlay(show: boolean): Promise<void> {
  const mod = await loadMod()
  return mod.showExtensionsOverlay(show)
}

export async function prewarmExtensionsPanel(): Promise<void> {
  const mod = await loadMod()
  return mod.prewarmExtensionsPanel()
}
