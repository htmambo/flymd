import { getCurrentWindow } from '@tauri-apps/api/window'
import { getLibraryScope } from '../core/libraryConfig'

// 老 key（v1）：所有窗口共享一份快照，多窗口会互相覆盖。仅保留用于一次性迁移。
export const SESSION_KEY_LEGACY = 'flymd:tabSession:v1'
// 新 key 前缀（v2）：按 库id + 窗口 label 隔离（main / main-xxxx）。
export const SESSION_KEY_PREFIX = 'flymd:tabSession:v2:'

// 最近一次处于持久化库时的 libId：临时库（打开库外文件）不改变会话归属，
// 避免把当前库的标签快照写进 global 命名空间造成污染。
let _lastPersistedLibId: string | null = null

export function setSessionLibraryScope(libId: string | null): void {
  _lastPersistedLibId = libId || null
}

function currentLibPart(): string {
  try {
    const s = getLibraryScope()
    if (s.persisted && s.id) {
      _lastPersistedLibId = s.id
      return s.id
    }
  } catch {}
  return _lastPersistedLibId || 'global'
}

/**
 * 取当前窗口 label。非 Tauri 环境或异常时退回 'browser'，避免污染 'main' 命名空间。
 */
export function getCurrentWindowLabel(): string {
  try {
    const w = getCurrentWindow()
    return w?.label || 'main'
  } catch {
    return 'browser'
  }
}

export function getSessionStorageKey(): string {
  return SESSION_KEY_PREFIX + currentLibPart() + ':' + getCurrentWindowLabel()
}

// 迁移前的旧 v2 key（无库段）：仅用于一次性迁移
export function getUnscopedSessionKey(): string {
  return SESSION_KEY_PREFIX + getCurrentWindowLabel()
}

/**
 * 老会话 key 一次性迁移：仅 main 窗口把 v1 快照迁到新 key 并删除 v1；其他窗口
 * （main-xxxx）一律用自己的新 key，不抢占 v1。返回被迁移的内容，未迁移则返回 null。
 *
 * 抽成依赖注入 storage + label 的纯函数以便单测；运行时由 restoreTabSession 注入
 * 真实 localStorage 与 {@link getCurrentWindowLabel} 的结果，并在外层做新 key 是否
 * 已存在的判断与 try/catch 日志。
 */
export function migrateLegacySessionKey(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  targetKey: string,
  label: string,
): string | null {
  if (label !== 'main') return null
  const legacy = storage.getItem(SESSION_KEY_LEGACY)
  if (!legacy) return null
  storage.setItem(targetKey, legacy)
  storage.removeItem(SESSION_KEY_LEGACY)
  return legacy
}
