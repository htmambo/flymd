// 库私有配置 v2 通道 C 框架（库私有化 v2 第三个 PR）
//
// 背景：库语义配置分两个通道
//   通道 A（库内共享）：<库根>/.flymd/config.json —— recent / currentFile / librarySort /
//     folderOrder / defaultPasteDir / pluginEnable。随库目录走，可被 WebDAV 同步。
//   通道 C（本模块，库内私有）：<库根>/.flymd/local.json —— docPos / uploader 凭据 /
//     ASR 偏好 / manualTranscribe / officePreview 等设备私有或敏感数据。随库目录走，
//     **不** 被 WebDAV 同步（PR-1 默认排除）。
//   通道 B（系统层按库命名空间）：Store / localStorage key 追加 `:<libId>` ——
//     tabSession 等。保持原状，不入库。
//
// 与通道 A 关键差异：
//   - 写带锁（PR-2 文件锁基础设施）：多窗口/多进程不丢写
//   - 500ms 防抖：高频 docPos 写合并
//   - 滚动 3 个 .bak：损坏可回退
//   - 数据全含敏感字段，UI 不暴露
//
// 跨设备 / WebDAV：local.json 不会被 WebDAV 上传（PR-1 默认 exclude）。
//
// 沿用模式：与 src/core/libraryConfig.ts 的 factory + 模块级状态 + mtime 轮询 + 写时合并一致。
//
// 详见 docs/Task/Archive/2026-09/2026-09-11-library-private-v2-pr3-libraryprivate.md

import { rename, remove } from '@tauri-apps/plugin-fs'
import { getLibraryScope, invalidateLibraryConfigCache, LIBRARY_CHANGED_EVENT } from './libraryConfig'
import { ensureDir, readTextFileAnySafe, statFileAnySafe } from './fsSafe'
import { writeFileLockedSafe, readModifyWriteLockedSafe } from './fsSafe'

/** 通道 C 数据 schema 版本。v2 时按段迁移。 */
export const LIBRARY_PRIVATE_SCHEMA_VERSION = 1

/** 备份文件数量（滚动 N 个 .bak）。损坏时可回退。 */
const BACKUP_ROTATIONS = 3
/** 写防抖窗口（毫秒）。docPos 高频写合并。 */
const WRITE_DEBOUNCE_MS = 500
/** 写锁超时（毫秒）。 */
const WRITE_LOCK_TIMEOUT_MS = 5000
/** mtime 外部变更轮询间隔（毫秒）。 */
const MTIME_POLL_INTERVAL_MS = 3000

/** 单文档光标位置 + 滚动状态（与 DocPos 类型同构）。 */
export interface PrivateDocPos {
  pos: number
  end?: number
  scroll: number
  pscroll: number
  mode: 'edit' | 'preview' | 'wysiwyg'
  ts: number
}

/** 图床配置（AnyUploaderConfig 由消费方注入，这里仅给宽松 any 兼容）。 */
export interface PrivateUploader {
  enabled?: boolean
  provider?: string
  [k: string]: any
}

/**
 * local.json 顶层数据结构。
 * - version: schema 版本号（必填，缺失视为 v1）
 * - docPos: 文件路径 -> 光标/滚动位置
 * - uploader: 图床凭据（null 表示未配置）
 * - prefs: 其他 per-library 偏好（asr / manualTranscribe / officePreview / 插件扩展）
 */
export interface LibraryPrivateData {
  version: number
  docPos?: Record<string, PrivateDocPos>
  uploader?: PrivateUploader | null
  prefs?: {
    asr?: any
    manualTranscribe?: any
    officePreview?: { enabled?: boolean }
    [k: string]: any
  }
}

/** 外部变更事件名。 */
export const LIBRARY_PRIVATE_CHANGED_EVENT = 'flymd:libraryPrivate:changed'

// ===== 模块级状态 =====

interface CacheEntry {
  root: string
  data: LibraryPrivateData
}

let _cache: CacheEntry | null = null
let _loading: Promise<LibraryPrivateData | null> | null = null
let _writeQueue: Promise<void> = Promise.resolve()
let _debounceTimer: number | null = null
let _pendingPatch: Partial<LibraryPrivateData> | null = null
let _pendingResolvers: Array<{ resolve: (v: boolean) => void; reject: (e: any) => void }> = []
let _lastKnownMtime: number | null = null
let _watchTimer: number | null = null

// ===== 内部 helper =====

/** local.json 文件绝对路径。 */
export function libraryPrivateFilePath(root: string): string {
  return root.replace(/[\\/]+$/, '') + '/.flymd/local.json'
}

/** 备份文件路径：local.json.bak1 / .bak2 / .bak3 */
function backupPath(root: string, n: number): string {
  return libraryPrivateFilePath(root) + '.bak' + n
}

async function refreshMtimeBaseline(path: string): Promise<void> {
  try {
    const snap = await statFileAnySafe(path)
    _lastKnownMtime = snap ? snap.mtimeMs : null
  } catch {
    _lastKnownMtime = null
  }
}

/** 滚动备份：bak3 删除，bak2 -> bak3，bak1 -> bak2，current -> bak1 */
async function rotateBackups(path: string): Promise<void> {
  const root = path.replace(/[\\/][^\\/]*$/, '')
  try { await remove(backupPath(root, BACKUP_ROTATIONS)) } catch {}
  for (let i = BACKUP_ROTATIONS - 1; i >= 1; i--) {
    try { await rename(backupPath(root, i), backupPath(root, i + 1)) } catch {}
  }
  try { await rename(path, backupPath(root, 1)) } catch {}
}

async function pollExternalChange(): Promise<void> {
  const scope = getLibraryScope()
  if (!scope.root) return
  // 缓存尚未加载时不做检测
  if (!_cache || _cache.root !== scope.root) return
  try {
    const snap = await statFileAnySafe(libraryPrivateFilePath(scope.root))
    const mtime = snap ? snap.mtimeMs : null
    if (mtime === _lastKnownMtime) return
    _lastKnownMtime = mtime
    _cache = null
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(LIBRARY_PRIVATE_CHANGED_EVENT, { detail: { root: scope.root } }),
        )
      }
    } catch {}
  } catch {}
}

function ensureConfigWatcher(): void {
  if (typeof window === 'undefined') return
  if (_watchTimer != null) return
  _watchTimer = window.setInterval(() => { void pollExternalChange() }, MTIME_POLL_INTERVAL_MS)
}

// ===== 公共 API =====

/** 读取当前库内私有配置。无库根返回 null（调用方回落）。 */
export async function readLibraryPrivate(): Promise<LibraryPrivateData | null> {
  const scope = getLibraryScope()
  if (!scope.root) return null
  if (_cache && _cache.root === scope.root) return _cache.data
  if (_loading) return await _loading

  const root = scope.root
  _loading = (async () => {
    const path = libraryPrivateFilePath(root)
    try {
      const text = await readTextFileAnySafe(path)
      const parsed = JSON.parse(text)
      const data: LibraryPrivateData = (parsed && typeof parsed === 'object')
        ? { version: parsed.version ?? LIBRARY_PRIVATE_SCHEMA_VERSION, ...parsed }
        : { version: LIBRARY_PRIVATE_SCHEMA_VERSION }
      _cache = { root, data }
      return data
    } catch {
      // 文件不存在/损坏：视为空配置（后续写入会创建）
      _cache = { root, data: { version: LIBRARY_PRIVATE_SCHEMA_VERSION } }
      return _cache.data
    } finally {
      _loading = null
      try { await refreshMtimeBaseline(path) } catch {}
      try { ensureConfigWatcher() } catch {}
    }
  })()
  return await _loading
}

/** 合并写入库内私有配置。
 *  默认走 500ms 防抖（高频 docPos 写合并）；opts.immediate = true 跳过防抖。
 *  无库根返回 false（调用方应回落）。 */
export async function writeLibraryPrivate(
  patch: Partial<LibraryPrivateData>,
  opts?: { immediate?: boolean },
): Promise<boolean> {
  const scope = getLibraryScope()
  if (!scope.root) return false

  if (opts?.immediate) {
    return await doWrite(patch)
  }

  // 合并到 pending patch。
  // 关键: docPos / prefs 是 Record 字段,需按 key 合并而非整体替换,
  // 否则 3 次连续 writeLibraryPrivate({docPos:{a}}) + ({docPos:{b}}) + ({docPos:{c}})
  // 会丢失 a/b/c 中前两个。
  const prev = _pendingPatch || {}
  const next: Partial<LibraryPrivateData> = { ...prev }
  if (patch.version != null) next.version = patch.version
  if (patch.uploader !== undefined) next.uploader = patch.uploader
  if (patch.docPos) {
    next.docPos = { ...(prev.docPos || {}), ...patch.docPos }
  }
  if (patch.prefs) {
    next.prefs = { ...(prev.prefs || {}), ...patch.prefs }
  }
  _pendingPatch = next

  return new Promise<boolean>((resolve, reject) => {
    _pendingResolvers.push({ resolve, reject })
    if (_debounceTimer != null) {
      clearTimeout(_debounceTimer)
      _debounceTimer = null
    }
    // 使用全局 setTimeout (node + browser 都可用,vi.useFakeTimers 可 mock)
    _debounceTimer = setTimeout(() => {
      void flushPending()
    }, WRITE_DEBOUNCE_MS) as unknown as number
  })
}

async function flushPending(): Promise<void> {
  const patch = _pendingPatch
  const resolvers = _pendingResolvers
  _pendingPatch = null
  _pendingResolvers = []
  _debounceTimer = null
  if (!patch) {
    for (const r of resolvers) r.resolve(true)
    return
  }
  try {
    const ok = await doWrite(patch)
    for (const r of resolvers) r.resolve(ok)
  } catch (e) {
    for (const r of resolvers) r.reject(e)
  }
}

async function doWrite(patch: Partial<LibraryPrivateData>): Promise<boolean> {
  const scope = getLibraryScope()
  if (!scope.root) return false
  const root = scope.root
  const path = libraryPrivateFilePath(root)

  const task = _writeQueue.then(async () => {
    // 写时合并磁盘最新值（避免过期内存覆盖外部变更）。
    // PR-2 复审反馈：把"读 base"也放入文件锁作用域内（read-modify-write 原子），
    // 防止多窗口/多进程并发"读 base → 另一进程写 → 写回覆盖"丢数据。
    await ensureDir(root.replace(/[\\/]+$/, '') + '/.flymd')
    // 滚动备份放在锁内（在原子写之前,确保 .bakN 反映旧版本）。
    // 备份与写入都在同一锁内，避免并发写入相互踩 .bakN。
    const next = await readModifyWriteLockedSafe(
      path,
      (current) => {
        let base: LibraryPrivateData = { version: LIBRARY_PRIVATE_SCHEMA_VERSION }
        try {
          const parsed = JSON.parse(current)
          if (parsed && typeof parsed === 'object') {
            base = { ...base, ...parsed }
            if (!base.version) base.version = LIBRARY_PRIVATE_SCHEMA_VERSION
          }
        } catch {}
        if (!base.version) base.version = LIBRARY_PRIVATE_SCHEMA_VERSION

        // 深合并：docPos / prefs 这种 Record 字段需要按 key 合并而非整体替换
        const merged: LibraryPrivateData = { ...base, ...patch }
        if (patch.docPos && base.docPos) {
          merged.docPos = { ...base.docPos, ...patch.docPos }
        }
        if (patch.prefs && base.prefs) {
          merged.prefs = { ...base.prefs, ...patch.prefs }
        }
        return JSON.stringify(merged, null, 2)
      },
      WRITE_LOCK_TIMEOUT_MS,
    )
    // 解析 next 反向同步到 _cache（基于锁内读到的 base，避免后续读漏更新）
    try {
      const parsed = JSON.parse(next)
      if (parsed && typeof parsed === 'object') {
        _cache = { root, data: { version: LIBRARY_PRIVATE_SCHEMA_VERSION, ...parsed } as LibraryPrivateData }
      }
    } catch {}
    // 旋转备份（在原子写完成后），保证 .bak1 是上一稳定版本
    await rotateBackups(path)
    // 自身写入后刷新 mtime 基线
    await refreshMtimeBaseline(path)
  })
  _writeQueue = task.catch((e) => {
    try { console.warn('[libraryPrivate] doWrite 失败:', e) } catch {}
  })
  try {
    await task
    return true
  } catch {
    return false
  }
}

/** 强制立即 flush pending 写（退出 / 切库时调用）。 */
export async function flushLibraryPrivate(): Promise<void> {
  if (_debounceTimer != null) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  await flushPending()
}

/** 失效缓存（外部变更 / 主动重置）。 */
export function invalidateLibraryPrivateCache(): void {
  _cache = null
  _loading = null
}

/** 订阅外部变更事件。返回取消订阅函数。 */
export function subscribeLibraryPrivateChange(cb: (root: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (ev: Event) => {
    try {
      const d = (ev as CustomEvent).detail || {}
      if (d.root) cb(d.root)
    } catch {}
  }
  window.addEventListener(LIBRARY_PRIVATE_CHANGED_EVENT, handler)
  return () => {
    try { window.removeEventListener(LIBRARY_PRIVATE_CHANGED_EVENT, handler) } catch {}
  }
}

/** 库切换时联动：清缓存 + 重建轮询。 */
export function onLibraryChangedForPrivate(): void {
  invalidateLibraryPrivateCache()
  _lastKnownMtime = null
  invalidateLibraryConfigCache()  // 通道 A 缓存也清
  try {
    const scope = getLibraryScope()
    if (scope.root) ensureConfigWatcher()
  } catch {}
}

// ===== 启动时一次性挂载：订阅 library:changed 事件 =====
// 把"库切换"事件桥接到 private 通道：切库前 flush 旧数据，切库后清缓存 + 启轮询。
// 仅在浏览器/Tauri 环境挂载，测试/Node 环境跳过。
let _bridgeInstalled = false
export function installLibraryChangedBridge(): void {
  if (_bridgeInstalled) return
  if (typeof window === 'undefined') return
  _bridgeInstalled = true
  // 切库前 flush（同步的微任务，确保旧库数据落盘）
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    try { void flushLibraryPrivate() } catch {}
  })
  // 切库后清缓存（用 microtask 让 flush 先完成）
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    queueMicrotask(() => {
      try { onLibraryChangedForPrivate() } catch {}
    })
  })
  // PR-4: 切库后异步触发迁移（fire-and-forget, 不阻塞切库）
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    queueMicrotask(async () => {
      try {
        const { runMigrationForScope } = await import('./libraryMigration')
        // 动态 import 避免循环依赖
        runMigrationForScope(getLibraryScope().id, getStoreForMigration)
      } catch {}
    })
  })
}

/** 注入 store getter（PR-4 迁移用）。main.ts 启动时调用一次。 */
let _getStoreForMigration: (() => any) | null = null
export function setStoreForMigration(fn: () => any): void {
  _getStoreForMigration = fn
}
function getStoreForMigration(): any {
  return _getStoreForMigration ? _getStoreForMigration() : null
}
