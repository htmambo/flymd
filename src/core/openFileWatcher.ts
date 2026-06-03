/**
 * 打开文件外部更改监听(核心层)
 *
 * 职责:
 * 1. 维护"已打开文件 -> file snapshot + 回调 + 抑制窗口"映射
 * 2. 订阅 plugin-fs 的 watchPathsAbs,仅在精确匹配注册路径时派发
 * 3. 自循环抑制:saveFile 完成后 markSelfWrite,2s 内事件直接丢弃
 * 4. 二级 stat:首次失败延迟 400ms 重试,覆盖 rename 中间态
 * 5. 浏览器/不支持环境自我降级为 no-op
 *
 * 策略层(自动重载/弹模态/转草稿)在 openFileWatcherIntegration 中实现。
 */

import { stat as fsStat, readFile as fsReadFile } from '@tauri-apps/plugin-fs'
import { logDebug, logWarn } from './logger'
import { watchPathsAbs } from '../extensions/libraryWatch'

// ============================================================
// 公共类型
// ============================================================

/**
 * 文件 snapshot,用于精确判断"是否真的变了"
 * mtimeMs + size 已足以覆盖大多数情况;contentHash 仅在 ≤1MB 时可选计算
 */
export type FileSnapshot = {
  mtimeMs: number
  size: number
  contentHashOpt?: string
}

export type ExternalChangeKind = 'modified' | 'removed'

export type ExternalChangeHandler = (
  filePath: string,
  kind: ExternalChangeKind,
  next: FileSnapshot | null,
) => void

/** 不透明句柄,内部以 "wt_<counter>" 形式存在 */
export type WatchToken = string

export type RevalidateResult = 'unchanged' | 'changed' | 'missing'

/** 依赖注入:便于单测/浏览器环境降级 */
export interface OpenFileWatcherDeps {
  /** 注入 watchPathsAbs;默认走 extensions/libraryWatch 的实现 */
  watchPathsAbs?: typeof watchPathsAbs
  /** 注入 stat;默认走 @tauri-apps/plugin-fs 的 stat */
  stat?: (p: string) => Promise<FileSnapshot | null>
  /** 注入 readFile;默认走 @tauri-apps/plugin-fs 的 readFile(用于小文件 SHA-1) */
  readFile?: (p: string) => Promise<Uint8Array>
  /** 注入 crypto;默认 globalThis.crypto.subtle(用于 SHA-1) */
  crypto?: { subtle: { digest(alg: string, buf: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> } }
  /** 注入 now;默认 () => Date.now() */
  now?: () => number
  /** 注入 logger;默认 ./logger 的 logDebug/logWarn */
  logger?: {
    debug: (msg: string, details?: unknown) => void
    warn: (msg: string, details?: unknown) => void
  }
  /** 总开关;默认 () => true。可在偏好面板里替换 */
  enabled?: () => boolean
}

export interface OpenFileWatcher {
  register(filePath: string, onChange: ExternalChangeHandler): WatchToken
  unregister(token: WatchToken): void
  unregisterByPath(filePath: string): void
  markSelfWrite(filePath: string): void
  beginSelfWrite(filePath: string): void
  finishSelfWrite(filePath: string): void
  revalidate(filePath: string): Promise<RevalidateResult>
  setEnabled(on: boolean): void
  dispose(): void
}

// ============================================================
// 内部实现
// ============================================================

const SUPPRESS_WINDOW_MS = 2000
const RENAME_RETRY_DELAY_MS = 400
const HASH_THRESHOLD_BYTES = 1024 * 1024
let _tokenCounter = 0

type Entry = {
  token: WatchToken
  filePath: string         // 规范化后的绝对路径
  originalPath: string     // 首次注册时的原始路径(回调用)
  parentDir: string
  snapshot: FileSnapshot | null
  suppressUntil: number    // 在此时间戳之前的事件直接丢弃
  onChange: ExternalChangeHandler
  unwatch: (() => void) | null
  /** 用于 revalidate 期间防止 self-write 反向重入 */
  inFlight: boolean
  /** 异步 watch 句柄 race 防护:unregister/dispose 时设 true,resolve 后检查 */
  cancelled: boolean
  /** SHA-1 计算并发去重:同一 entry 同一时刻只算一个 hash */
  hashInFlight: boolean
}

function defaultNow(): number {
  return Date.now()
}

function defaultStat(): (p: string) => Promise<FileSnapshot | null> {
  return async (p: string) => {
    try {
      const raw = await fsStat(p as any)
      if (!raw) return null
      const mtimeMs = (raw as any).mtimeMs ?? (raw as any).mtime ?? (raw as any).modifiedAt
      const size = (raw as any).size
      const mtimeNum = Number(mtimeMs)
      const sizeNum = Number(size)
      if (!Number.isFinite(mtimeNum) || !Number.isFinite(sizeNum)) return null
      return { mtimeMs: mtimeNum, size: sizeNum }
    } catch {
      return null
    }
  }
}

function defaultLogger() {
  return { debug: logDebug, warn: logWarn }
}

/**
 * 路径规范化:
 * - 反斜杠统一为正斜杠
 * - Windows 盘符路径额外做大小写归一
 */
function normalizePath(p: string): string {
  let s = String(p || '').replace(/[\\]+/g, '/')
  // 去除重复斜杠(保留跨盘符的 "C:/" 双斜杠)
  s = s.replace(/(?<!:)\/{2,}/g, '/')
  // Windows 不敏感
  if (/^[a-zA-Z]:\//.test(s)) s = s.toLowerCase()
  return s
}

function snapshotEqual(a: FileSnapshot | null, b: FileSnapshot | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.mtimeMs !== b.mtimeMs) return false
  if (a.size !== b.size) return false
  // contentHashOpt 可选:任一侧缺失时按 mtime+size 判定(降级零影响)
  //   - 双 null / 双 undefined:都视为缺失,按上一步已通过
  //   - 一侧有、一侧无:hash 算失败或并发去重路径;不视为不同
  //   - 双有且不等:hash 真变,视为不同
  const aH = a.contentHashOpt || null
  const bH = b.contentHashOpt || null
  if (aH && bH) return aH === bH
  return true
}

function makeToken(): WatchToken {
  _tokenCounter += 1
  return `wt_${_tokenCounter.toString(36)}`
}

function parentDirOf(filePath: string): string {
  const s = filePath.replace(/[\\/]+/g, '/')
  const idx = s.lastIndexOf('/')
  if (idx < 0) return s
  if (idx === 0) return '/'
  return s.slice(0, idx)
}

export function createOpenFileWatcher(deps: OpenFileWatcherDeps = {}): OpenFileWatcher {
  const watchImpl = deps.watchPathsAbs ?? watchPathsAbs
  const statImpl = deps.stat ?? defaultStat()
  const readImpl = deps.readFile ?? ((p: string) => fsReadFile(p as any) as Promise<Uint8Array>)
  const cryptoImpl = deps.crypto ?? (globalThis as any).crypto
  const now = deps.now ?? defaultNow
  const logger = deps.logger ?? defaultLogger()
  const enabledFn = deps.enabled ?? (() => true)

  /** 规范化路径 -> entry */
  const entriesByPath = new Map<string, Entry>()
  /** token -> entry,用于 unregister(token) 反查 */
  const entriesByToken = new Map<WatchToken, Entry>()
  /** 全局开关 */
  let enabled = true
  /** dispose 标记 */
  let disposed = false

  /**
   * 小文件 SHA-1 助手。
   * - 已知 size > maxBytes:早返回 null(不读字节)
   * - 失败/不支持:返回 null(降级为 mtime+size 比对)
   * - 二进制/非文本内容也算 SHA-1(哈希对内容是同构的)
   */
  async function computeSha1Hex(filePath: string, knownSize: number, maxBytes: number): Promise<string | null> {
    try {
      if (knownSize > maxBytes) return null
      if (!cryptoImpl?.subtle?.digest) return null
      const bytes = await readImpl(filePath)
      // 防御:readFile 返回的字节数可能与 stat size 略有差异
      if (bytes.byteLength > maxBytes) return null
      const digest = await cryptoImpl.subtle.digest('SHA-1', bytes)
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      logger.warn('[openFileWatcher] computeSha1Hex failed', { filePath, err: String(e) })
      return null
    }
  }

  /**
   * 在已有 stat snapshot 上**尝试**追加 SHA-1。
   * - 大于阈值:直接返回原 snapshot(无 hash 字段)
   * - 已被取消:返回 null,调用方应保留原 snapshot
   * - 已有 hash 计算在飞:返回原 snapshot(去 hash)
   * - 算完后再检查 cancelled:返回 null
   * - 算成功:返回带 hash 的 snapshot
   * - 算失败:返回原 snapshot(去 hash) — 降级
   */
  async function tryFillHash(entry: Entry, snapshot: FileSnapshot | null): Promise<FileSnapshot | null> {
    if (!snapshot) return null
    if (snapshot.size > HASH_THRESHOLD_BYTES) return snapshot
    if (entry.cancelled) return null
    if (entry.hashInFlight) return snapshot
    entry.hashInFlight = true
    try {
      const hash = await computeSha1Hex(entry.originalPath, snapshot.size, HASH_THRESHOLD_BYTES)
      if (entry.cancelled) return null
      return { mtimeMs: snapshot.mtimeMs, size: snapshot.size, contentHashOpt: hash ?? undefined }
    } finally {
      entry.hashInFlight = false
    }
  }

  /**
   * 启动对 entry 的 watch;幂等。
   * 失败不抛出(浏览器/网盘降级),仅 logWarn。
   */
  function startWatch(entry: Entry): void {
    if (disposed || entry.unwatch) return
    // 每次 startWatch 重置 cancelled(新启动);后续 await 期间 unregister 会再次设 true
    entry.cancelled = false
    void (async () => {
      let unwatch: (() => void) | null = null
      try {
        unwatch = await watchImpl(
          entry.parentDir,                 // 充当 libraryRoot 占位
          [entry.originalPath],            // 监听单一文件
          (ev) => {
            try {
              // race 检查:若期间被取消,忽略后续事件
              if (entry.cancelled) return
              handleEvent(entry, ev)
            } catch (e) {
              logger.warn('[openFileWatcher] event handler error', e)
            }
          },
          { recursive: false, immediate: false, delayMs: 200 },
        )
        // resolve 后再次 race 检查
        if (entry.cancelled) {
          // 已被 unregister/dispose:立即释放,避免孤儿监听
          try { unwatch() } catch (e) {
            logger.warn('[openFileWatcher] race-released unwatch failed', { err: String(e) })
          }
          return
        }
        entry.unwatch = unwatch
        logger.debug('[openFileWatcher] watch started', { filePath: entry.filePath })
      } catch (e) {
        // 浏览器/不支持环境 -> 自我降级
        logger.warn('[openFileWatcher] watchPathsAbs failed,降级为 no-op', {
          filePath: entry.filePath,
          err: String(e),
        })
        entry.unwatch = null
      }
    })()
  }

  /**
   * watchPathsAbs 回调统一入口。
   * 仅当 event.paths 中**精确包含** entry.filePath 时才处理。
   */
  function handleEvent(entry: Entry, ev: any): void {
    if (!enabled || !enabledFn()) return
    const paths: string[] = Array.isArray(ev?.paths)
      ? ev.paths.map((x: any) => normalizePath(String(x || '')))
      : []
    if (!paths.includes(entry.filePath)) return

    const t = now()
    if (t < entry.suppressUntil) {
      logger.debug('[openFileWatcher] 抑制自循环事件', {
        filePath: entry.filePath,
        suppressRemaining: entry.suppressUntil - t,
      })
      return
    }

    // 二级 stat:首次失败 400ms 后重试
    void checkChange(entry)
  }

  async function checkChange(entry: Entry): Promise<void> {
    if (entry.inFlight) return
    entry.inFlight = true
    try {
      let s1 = await statImpl(entry.originalPath)
      if (!s1) {
        await new Promise((r) => setTimeout(r, RENAME_RETRY_DELAY_MS))
        s1 = await statImpl(entry.originalPath)
      }
      if (!s1) {
        // 真删除 / 不可访问:派发 removed,snapshot 置 null
        // 取消检查:unregister/dispose 后不应再触发旧 entry 的回调
        if (entry.cancelled || entriesByToken.get(entry.token) !== entry) return
        if (entry.snapshot != null) {
          entry.snapshot = null
          safeInvoke(entry, 'removed', null)
        }
        return
      }
      // 小文件附带 SHA-1 精确比对(降 false positive)
      s1 = await tryFillHash(entry, s1)
      if (s1 == null) return  // 已被取消
      if (!snapshotEqual(entry.snapshot, s1)) {
        entry.snapshot = s1
        safeInvoke(entry, 'modified', s1)
      } else {
        logger.debug('[openFileWatcher] 事件命中但 snapshot 一致,丢弃', {
          filePath: entry.filePath,
        })
      }
    } catch (e) {
      logger.warn('[openFileWatcher] checkChange 失败', { filePath: entry.filePath, err: String(e) })
    } finally {
      entry.inFlight = false
    }
  }

  function safeInvoke(entry: Entry, kind: ExternalChangeKind, next: FileSnapshot | null): void {
    try {
      entry.onChange(entry.originalPath, kind, next)
    } catch (e) {
      logger.warn('[openFileWatcher] onChange 回调抛错', { filePath: entry.filePath, err: String(e) })
    }
  }

  function register(filePath: string, onChange: ExternalChangeHandler): WatchToken {
    if (disposed) return ''
    const fp = String(filePath || '').trim()
    if (!fp) return ''

    const norm = normalizePath(fp)
    // 同路径二次注册:取消旧 token
    const existed = entriesByPath.get(norm)
    if (existed) {
      logger.debug('[openFileWatcher] 同路径重复注册,清理旧 token', { filePath: fp })
      // 关键:与 unregister 一样设 cancelled,防 startWatch / hash 计算的
      //   await resolve 后回调到旧 entry 继续污染新 entry
      existed.cancelled = true
      if (existed.unwatch) {
        try { existed.unwatch() } catch {}
      }
      entriesByPath.delete(norm)
      entriesByToken.delete(existed.token)
    }

    const entry: Entry = {
      token: makeToken(),
      filePath: norm,
      originalPath: fp,
      parentDir: parentDirOf(fp),
      snapshot: null,
      suppressUntil: 0,
      onChange,
      unwatch: null,
      inFlight: false,
      cancelled: false,
      hashInFlight: false,
    }
    entriesByPath.set(norm, entry)
    entriesByToken.set(entry.token, entry)

    // 初始 snapshot 异步填充(失败不阻塞)
    void (async () => {
      const s0 = await statImpl(fp)
      // 竞态:若已被 unregister,tryFillHash 内部会观察到 cancelled
      const s = await tryFillHash(entry, s0)
      if (s == null) return  // cancelled 或失败,保持 snapshot=null
      if (!entry.cancelled && entriesByToken.has(entry.token)) {
        entry.snapshot = s
        logger.debug('[openFileWatcher] 初始 snapshot 就绪', {
          filePath: fp,
          hasSnapshot: true,
          hasHash: !!s.contentHashOpt,
        })
      }
    })()

    if (enabled && enabledFn()) {
      startWatch(entry)
    }
    return entry.token
  }

  function unregister(token: WatchToken): void {
    const e = entriesByToken.get(token)
    if (!e) return
    // 标记取消(防止 startWatch resolve 后留下孤儿监听)
    e.cancelled = true
    if (e.unwatch) {
      try { e.unwatch() } catch {}
    }
    entriesByPath.delete(e.filePath)
    entriesByToken.delete(token)
    logger.debug('[openFileWatcher] unregister', { filePath: e.originalPath })
  }

  function unregisterByPath(filePath: string): void {
    const norm = normalizePath(String(filePath || ''))
    const e = entriesByPath.get(norm)
    if (!e) return
    e.cancelled = true
    if (e.unwatch) {
      try { e.unwatch() } catch {}
    }
    entriesByPath.delete(norm)
    entriesByToken.delete(e.token)
    logger.debug('[openFileWatcher] unregisterByPath', { filePath: e.originalPath })
  }

  function markSelfWrite(filePath: string): void {
    const norm = normalizePath(String(filePath || ''))
    const e = entriesByPath.get(norm)
    if (!e) return
    e.suppressUntil = now() + SUPPRESS_WINDOW_MS
    // 立即刷新 snapshot,不依赖 watch 事件
    void (async () => {
      const s0 = await statImpl(e.originalPath)
      const s = await tryFillHash(e, s0)
      if (s == null) return
      if (!e.cancelled && entriesByPath.has(norm)) {
        e.snapshot = s
        logger.debug('[openFileWatcher] markSelfWrite,刷新 snapshot', {
          filePath: e.originalPath,
          mtimeMs: s.mtimeMs,
          hasHash: !!s.contentHashOpt,
        })
      }
    })()
  }

  /**
   * 自写入开始:在 write 之前调用,设抑制窗口。不刷新 snapshot(此时磁盘还没新数据)。
   * 用于 race 防护:防止 watch 事件在 write 期间先到,被误识别为外部变更。
   */
  function beginSelfWrite(filePath: string): void {
    const norm = normalizePath(String(filePath || ''))
    const e = entriesByPath.get(norm)
    if (!e) return
    e.suppressUntil = now() + SUPPRESS_WINDOW_MS
    logger.debug('[openFileWatcher] beginSelfWrite', { filePath: e.originalPath })
  }

  /**
   * 自写入完成:在 write 之后调用,刷新 snapshot 到最新。
   * 配套 beginSelfWrite 使用。
   */
  function finishSelfWrite(filePath: string): void {
    const norm = normalizePath(String(filePath || ''))
    const e = entriesByPath.get(norm)
    if (!e) return
    void (async () => {
      const s0 = await statImpl(e.originalPath)
      const s = await tryFillHash(e, s0)
      if (s == null) return
      if (!e.cancelled && entriesByPath.has(norm)) {
        e.snapshot = s
        logger.debug('[openFileWatcher] finishSelfWrite,刷新 snapshot', {
          filePath: e.originalPath,
          mtimeMs: s.mtimeMs,
          hasHash: !!s.contentHashOpt,
        })
      }
    })()
  }

  async function revalidate(filePath: string): Promise<RevalidateResult> {
    const norm = normalizePath(String(filePath || ''))
    const e = entriesByPath.get(norm)
    if (!e) return 'unchanged'
    const s0 = await statImpl(e.originalPath)
    if (!s0) return 'missing'
    const s = await tryFillHash(e, s0)
    if (s == null) return 'unchanged'  // 取消/失败:不更新
    if (!snapshotEqual(e.snapshot, s)) {
      if (!e.cancelled) e.snapshot = s
      return 'changed'
    }
    return 'unchanged'
  }

  function setEnabled(on: boolean): void {
    const next = !!on
    if (next === enabled) return
    enabled = next
    logger.debug('[openFileWatcher] setEnabled', { enabled })
    if (!enabled) {
      // 关闭:释放所有已激活的 watch 句柄(set cancelled 防 race)
      for (const e of entriesByToken.values()) {
        e.cancelled = true
        if (e.unwatch) {
          try { e.unwatch() } catch {}
          e.unwatch = null
        }
      }
    } else {
      // 重新开启:对所有已存在 entry 重新启动 watch
      for (const e of entriesByToken.values()) {
        if (e.unwatch) continue
        startWatch(e)
      }
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const e of entriesByToken.values()) {
      // 标记取消(防止 startWatch resolve 后留下孤儿监听)
      e.cancelled = true
      if (e.unwatch) {
        try { e.unwatch() } catch {}
      }
    }
    entriesByPath.clear()
    entriesByToken.clear()
  }

  return {
    register,
    unregister,
    unregisterByPath,
    markSelfWrite,
    beginSelfWrite,
    finishSelfWrite,
    revalidate,
    setEnabled,
    dispose,
  }
}
