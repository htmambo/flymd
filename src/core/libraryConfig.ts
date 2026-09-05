// 库私有配置读写层
// 背景：应用级偏好（主题/字号/行为开关等）保持全局；库语义配置按库隔离。
// 两个通道：
//   通道A（库内共享）：<库根>/.flymd/config.json —— 最近文件、库树排序、文件夹
//     排序、粘贴默认目录、扩展启用状态等，随库目录走（可被 WebDAV 同步携带）。
//   通道B（系统层按库命名空间）：Store/localStorage key 追加 `:<libId>` —— 标签
//     会话、光标位置、图床配置（含凭据）等设备私有或敏感数据，不进库目录。
// 临时库（打开库外文件时的父目录）与无库状态一律回落全局行为，不写库目录。
//
// 作用域解析：main.ts 在库激活/切换/临时库变化时调用 setLibraryScopeCache 保持
// 同步缓存温暖，各模块通过 getLibraryScope() 同步读取；变化时派发
// flymd:library:changed 事件（detail: LibraryScope）。

import { ensureDir, moveFileSafe, readTextFileAnySafe, writeTextFileAnySafe } from './fsSafe'

export interface LibraryScope {
  /** 持久化库 id；临时库/无库为 null */
  id: string | null
  /** 库根目录（临时库也有 root）；无库为 null */
  root: string | null
  /** true=持久化库（可写库内配置）；false=临时库或无库（回落全局） */
  persisted: boolean
}

export const LIBRARY_CHANGED_EVENT = 'flymd:library:changed'

const NO_SCOPE: LibraryScope = { id: null, root: null, persisted: false }

let _scope: LibraryScope = NO_SCOPE

export function getLibraryScope(): LibraryScope {
  return _scope
}

export function setLibraryScopeCache(scope: LibraryScope): void {
  const next: LibraryScope = {
    id: scope?.id || null,
    root: scope?.root || null,
    persisted: !!scope?.persisted,
  }
  const changed = next.id !== _scope.id || next.root !== _scope.root || next.persisted !== _scope.persisted
  _scope = next
  if (changed) {
    invalidateLibraryConfigCache()
    try {
      window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT, { detail: { ...next } }))
    } catch {}
  }
}

// ===== 通道A：库内 .flymd/config.json =====

const CONFIG_DIR = '.flymd'
const CONFIG_FILE = 'config.json'

export type LibrarySharedConfig = {
  /** 最近文件（按库） */
  recent?: string[]
  /** 库树排序偏好 */
  librarySort?: string
  /** 文件夹手动排序：父目录 -> 子目录 -> 顺序 */
  folderOrder?: Record<string, Record<string, number>>
  /** 无打开文件时粘贴图片的默认目录 */
  defaultPasteDir?: string
  /** 扩展启用状态快照：插件 id -> 是否启用（该库的覆盖值） */
  pluginEnable?: Record<string, boolean>
}

let _cache: { root: string; data: LibrarySharedConfig } | null = null
let _loading: Promise<LibrarySharedConfig | null> | null = null
let _writeQueue: Promise<void> = Promise.resolve()

export function invalidateLibraryConfigCache(): void {
  _cache = null
  _loading = null
}

function configFilePath(root: string): string {
  return root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR + '/' + CONFIG_FILE
}

/** 读取当前库内共享配置；非持久化库/读取失败返回 null（调用方回落全局） */
export async function readLibraryConfig(): Promise<LibrarySharedConfig | null> {
  const scope = getLibraryScope()
  if (!scope.persisted || !scope.root) return null
  if (_cache && _cache.root === scope.root) return _cache.data
  if (_loading) return await _loading
  const root = scope.root
  _loading = (async () => {
    try {
      const text = await readTextFileAnySafe(configFilePath(root))
      const parsed = JSON.parse(text)
      const data: LibrarySharedConfig = (parsed && typeof parsed === 'object') ? parsed : {}
      _cache = { root, data }
      return data
    } catch {
      // 文件不存在/损坏：视为空配置（仍属于该库，后续写入会创建）
      _cache = { root, data: {} }
      return _cache.data
    } finally {
      _loading = null
    }
  })()
  return await _loading
}

/**
 * 合并写入库内共享配置（原子写：临时文件 + rename；写串行化防并发截断）。
 * 非持久化库返回 false，调用方应回落全局存储。
 */
export async function writeLibraryConfig(patch: Partial<LibrarySharedConfig>): Promise<boolean> {
  const scope = getLibraryScope()
  if (!scope.persisted || !scope.root) return false
  const root = scope.root
  const task = _writeQueue.then(async () => {
    const cur = (await readLibraryConfig()) || {}
    const next: LibrarySharedConfig = { ...cur, ...patch }
    _cache = { root, data: next }
    const path = configFilePath(root)
    await ensureDir(root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR)
    const tmp = path + '.tmp'
    await writeTextFileAnySafe(tmp, JSON.stringify(next, null, 2))
    await moveFileSafe(tmp, path)
  })
  _writeQueue = task.catch(() => {})
  try {
    await task
    return true
  } catch {
    return false
  }
}

// ===== 通道B：系统层按库命名空间 =====

/**
 * 生成按库隔离的 Store/localStorage key：持久化库返回 `base:<libId>`，
 * 临时库/无库返回 base 原 key（全局回落，保持旧行为）。
 */
export function libraryScopedKey(base: string): string {
  const scope = getLibraryScope()
  return scope.persisted && scope.id ? `${base}:${scope.id}` : base
}
