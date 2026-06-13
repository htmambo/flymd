// WebDAV 同步模块异步门面
// 避免启动时加载整个 webdavSync chunk

import type {
  initWebdavSync,
  openWebdavSyncDialog,
  getWebdavSyncConfig,
  isWebdavConfiguredForActiveLibrary,
  syncNow,
  setOnSyncComplete,
  openSyncLog,
  appendSyncLog,
} from './webdavSync'

type WebdavMod = {
  initWebdavSync: typeof initWebdavSync
  openWebdavSyncDialog: typeof openWebdavSyncDialog
  getWebdavSyncConfig: typeof getWebdavSyncConfig
  isWebdavConfiguredForActiveLibrary: typeof isWebdavConfiguredForActiveLibrary
  syncNow: typeof syncNow
  setOnSyncComplete: typeof setOnSyncComplete
  openSyncLog: typeof openSyncLog
  appendSyncLog: typeof appendSyncLog
}

let _modPromise: Promise<WebdavMod> | null = null

function loadMod(): Promise<WebdavMod> {
  if (!_modPromise) {
    _modPromise = import('./webdavSync') as Promise<WebdavMod>
  }
  return _modPromise
}

export async function initWebdavSync(): Promise<void> {
  const mod = await loadMod()
  return mod.initWebdavSync()
}

export async function openWebdavSyncDialog(): Promise<void> {
  const mod = await loadMod()
  return mod.openWebdavSyncDialog()
}

export async function getWebdavSyncConfig(): Promise<ReturnType<typeof getWebdavSyncConfig>> {
  const mod = await loadMod()
  return mod.getWebdavSyncConfig()
}

export async function isWebdavConfiguredForActiveLibrary(): Promise<boolean> {
  const mod = await loadMod()
  return mod.isWebdavConfiguredForActiveLibrary()
}

export async function syncNow(reason: Parameters<typeof syncNow>[0]): Promise<ReturnType<typeof syncNow>> {
  const mod = await loadMod()
  return mod.syncNow(reason)
}

export async function setOnSyncComplete(callback: Parameters<typeof setOnSyncComplete>[0]): Promise<void> {
  const mod = await loadMod()
  mod.setOnSyncComplete(callback)
}

export async function openSyncLog(): Promise<void> {
  const mod = await loadMod()
  return mod.openSyncLog()
}

export async function appendSyncLog(msg: string): Promise<void> {
  const mod = await loadMod()
  return mod.appendSyncLog(msg)
}
