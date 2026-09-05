// 库私有配置读写层
// 背景：应用级偏好（主题/字号/行为开关等）保持全局；库语义配置按库隔离。
// 两个通道：
//   通道A（库内共享）：<库根>/.flymd/config.json —— 最近文件、库树排序、文件夹
//     排序、粘贴默认目录、扩展启用状态等，随库目录走（可被 WebDAV 同步携带）。
//   通道B（系统层按库命名空间）：Store/localStorage key 追加 `:<libId>` —— 标签
//     会话、光标位置、图床配置（含凭据）等设备私有或敏感数据，不进库目录。
// 通道A 生效条件=当前有库根（持久化库或临时库均可），无库才回落全局；
// 通道B 仅持久化库使用，临时库/无库一律回落全局行为。
//
// 作用域解析：main.ts 在库激活/切换/临时库变化时调用 setLibraryScopeCache 保持
// 同步缓存温暖，各模块通过 getLibraryScope() 同步读取；变化时派发
// flymd:library:changed 事件（detail: LibraryScope）。

import { ensureDir, normSep, readTextFileAnySafe, statFileAnySafe, writeTextFileAnySafe } from './fsSafe'
import { invoke } from '@tauri-apps/api/core'

export interface LibraryScope {
  /** 持久化库 id；临时库/无库为 null */
  id: string | null
  /** 库根目录（临时库也有 root）；无库为 null */
  root: string | null
  /** true=持久化库；false=临时库或无库（通道B 按库 key 回落全局） */
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
    // 库切换后旧库的 mtime 基线作废；新库首次读取/写入时重建
    _lastKnownMtime = null
    try { if (next.root) ensureConfigWatcher() } catch {}
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
  /** 最后激活标签对应的文件（"当前文件"标识，库内相对路径；启动无会话时优先激活它） */
  currentFile?: string
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

/** 配置被外部修改（WebDAV 同步下载/另一窗口写入）时派发，消费方应重载 */
export const LIBRARY_CONFIG_CHANGED_EVENT = 'flymd:libraryConfig:changed'

// 外部变更检测：以已知 mtime 为基线轮询（3s）。基线在每次自身读/写后更新，
// 因此自身写入不会误报；检测通过后失效缓存并派发事件，实现"内存为准 +
// 外部变更可进入"的语义（后变的一方赢，而非永远本机赢）。
let _lastKnownMtime: number | null = null
let _watchTimer: number | null = null

async function refreshMtimeBaseline(path: string): Promise<void> {
  try {
    const snap = await statFileAnySafe(path)
    _lastKnownMtime = snap ? snap.mtimeMs : null
  } catch {}
}

async function pollExternalChange(): Promise<void> {
  const scope = getLibraryScope()
  if (!scope.root) return
  // 缓存尚未加载时不做检测（首次读取会建立基线）
  if (!_cache || _cache.root !== scope.root) return
  try {
    const snap = await statFileAnySafe(configFilePath(scope.root))
    const mtime = snap ? snap.mtimeMs : null
    if (mtime === _lastKnownMtime) return
    _lastKnownMtime = mtime
    invalidateLibraryConfigCache()
    try {
      window.dispatchEvent(new CustomEvent(LIBRARY_CONFIG_CHANGED_EVENT, { detail: { root: scope.root } }))
    } catch {}
  } catch {}
}

function ensureConfigWatcher(): void {
  if (typeof window === 'undefined') return
  if (_watchTimer != null) return
  _watchTimer = window.setInterval(() => { void pollExternalChange() }, 3000)
}

export function invalidateLibraryConfigCache(): void {
  _cache = null
  _loading = null
}

function configFilePath(root: string): string {
  return root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR + '/' + CONFIG_FILE
}

/** 读取当前库内共享配置；无库根（无库状态）/读取失败返回 null（调用方回落全局） */
export async function readLibraryConfig(): Promise<LibrarySharedConfig | null> {
  const scope = getLibraryScope()
  if (!scope.root) return null
  if (_cache && _cache.root === scope.root) return _cache.data
  if (_loading) return await _loading
  const root = scope.root
  _loading = (async () => {
    const path = configFilePath(root)
    try {
      const text = await readTextFileAnySafe(path)
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
      // 建立外部变更检测基线并启动轮询（自身读取不计为外部变更）
      try { await refreshMtimeBaseline(path) } catch {}
      try { ensureConfigWatcher() } catch {}
    }
  })()
  return await _loading
}

/**
 * 合并写入库内共享配置（写串行化防并发截断）。
 * 直接写 config.json：writeTextFileAnySafe 自带后端兜底（库根常在 Tauri fs
 * scope 之外）；tmp+rename 的原子写在该场景下 rename 必然失败并残留 .tmp，
 * 故不使用。历史遗留的 config.json.tmp 在每次写入时尽力清理。
 * 写时合并：先读磁盘最新值作为合并基座（多窗口/同步工具可能已改动），再叠加
 * 本次 patch，避免用过期的内存缓存覆盖外部变更。
 * 无库根返回 false，调用方应回落全局存储。
 */
export async function writeLibraryConfig(patch: Partial<LibrarySharedConfig>): Promise<boolean> {
  const scope = getLibraryScope()
  if (!scope.root) return false
  const root = scope.root
  const task = _writeQueue.then(async () => {
    const path = configFilePath(root)
    // 写时合并磁盘最新值；磁盘不可读（不存在/损坏）时回落内存缓存
    let base: LibrarySharedConfig | null = null
    try {
      const text = await readTextFileAnySafe(path)
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') base = parsed
    } catch {}
    if (!base) base = (_cache && _cache.root === root) ? _cache.data : {}
    const next: LibrarySharedConfig = { ...base, ...patch }
    _cache = { root, data: next }
    await ensureDir(root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR)
    await writeTextFileAnySafe(path, JSON.stringify(next, null, 2))
    // 自身写入后刷新外部变更检测基线（避免误报），并清理早期版本残留的 .tmp
    try { await refreshMtimeBaseline(path) } catch {}
    try { ensureConfigWatcher() } catch {}
    try { await invoke('force_remove_path', { path: path + '.tmp' }) } catch {}
  })
  _writeQueue = task.catch(() => {})
  try {
    await task
    return true
  } catch {
    return false
  }
}

// ===== 库内相对路径（跨机器兼容：不同机器库根位置不同，入库路径一律相对） =====

export function isAbsolutePath(p: string): boolean {
  const s = String(p || '')
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')
}

/** 绝对路径 → 库内相对路径（统一 / 分隔）；库外路径返回 null */
export function toLibraryRelativePath(root: string, p: string): string | null {
  try {
    const rn = normSep(root).replace(/[\\/]+$/, '').replace(/\\/g, '/')
    const qn = normSep(p).replace(/\\/g, '/')
    if (!rn) return null
    if (qn.toLowerCase() === rn.toLowerCase()) return ''
    const prefix = rn + '/'
    if (!qn.toLowerCase().startsWith(prefix.toLowerCase())) return null
    return qn.slice(prefix.length)
  } catch {
    return null
  }
}

/** 库内相对路径 → 绝对路径（按当前库根的分隔符风格） */
export function resolveLibraryPath(root: string, rel: string): string {
  const r = String(root || '').replace(/[\\/]+$/, '')
  const sep = r.includes('\\') ? '\\' : '/'
  const cleaned = String(rel || '').replace(/^[\\/]+/, '').replace(/[\\/]+/g, sep)
  return cleaned ? r + sep + cleaned : r
}

/**
 * 读取入库路径（兼容旧版绝对路径数据）：相对路径按当前库根解析为绝对；
 * 绝对路径原样返回（下次写回时会被转为相对）。
 */
export function resolveStoredLibraryPath(root: string, stored: string): string {
  const s = String(stored || '')
  if (!s) return s
  return isAbsolutePath(s) ? normSep(s) : resolveLibraryPath(root, s)
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
