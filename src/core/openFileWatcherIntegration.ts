/**
 * 打开文件外部更改监听 — 策略层
 *
 * 与核心层(openFileWatcher.ts)解耦:
 * - 模态、reload、通知、确认窗口均由 deps 注入(由 main.ts 装配)
 * - 业务策略:dirty=false 时按偏好静默重载;dirty=true 时弹三选一模态
 * - 删除场景复用 dispatchPathDeleted 走既有 detach 流程
 *
 * 一期范围:仅对当前激活标签(filePath)响应事件,后台标签事件主动忽略
 */

import { dispatchPathDeleted } from './pathEvents'
import { logDebug, logWarn } from './logger'
import { t } from '../i18n'
import type { OpenFileWatcher, WatchToken } from './openFileWatcher'
import type { FileWatchConflictChoice } from '../dialog'

/** 对话框返回值(由 dialog.ts 装配);此处 re-export 以便 main.ts 仍可从本模块 import */
export type ConflictChoice = FileWatchConflictChoice
export type RevalidateResult = 'unchanged' | 'changed' | 'missing'

export interface OpenFileWatcherIntegrationDeps {
  /** 核心层 watcher 实例(由 createOpenFileWatcher 构造) */
  watcher: OpenFileWatcher

  // ---- 状态读取 ----
  isDirty: () => boolean
  getCurrentFilePath: () => string | null
  /** PDF/二进制文件不进入监听(由 reader 自行管理) */
  isSkippablePath?: (p: string) => boolean

  // ---- 操作 ----
  /** 实际从磁盘重读 + 写回 editor.value + 恢复光标/滚动(由 main.ts 提供) */
  reloadCurrentFile: () => Promise<void>

  // ---- UI 回调(由 main.ts 装配) ----
  /** 自动重载完成后的 toast */
  notifyAutoReloaded: (filePath: string) => void
  /** 干净标签检测到外部修改,但偏好要求"不自动重载" — 仅通知,不重载 */
  notifyExternalChangedNoReload: (filePath: string) => void
  /** 删除/不可访问的提示 */
  notifyMissing: (filePath: string) => void
  /** 脏标签弹三选一模态 */
  askConflictChoice: (filePath: string) => Promise<ConflictChoice>
  /** keep / reload 后的成功提示 */
  notifyKept: (filePath: string) => void
  notifyReloadedAfterConflict: (filePath: string) => void

  // ---- 偏好 ----
  /** 总开关:关闭后整个策略层不响应事件 */
  enabled: () => boolean
  /** dirty=false 时是否自动重载(true:静默;false:仅提示,等用户操作) */
  autoReloadCleanEnabled: () => boolean
}

export interface OpenFileWatcherIntegration {
  /** openFile2 / tab-switched 时调用,注册激活标签 */
  registerFor(filePath: string): void
  /** close / saveAs / newFile 时调用 */
  unregisterFor(filePath: string): void
  /** saveFile / saveAs 写入完成后调用(向后兼容) */
  markSelfWriteCurrent(): void
  /** 自写入开始 — write 之前调用,设抑制窗口(无 stat,用于 race 防护)。可选 path 用于 saveAs 切路径场景 */
  beginSelfWriteCurrent(path?: string | null): void
  /** 自写入完成 — write 之后调用,刷新 snapshot */
  finishSelfWriteCurrent(): void
  /** 切回标签时 stat 复检(命中后自动跑策略) */
  revalidateCurrent(): Promise<RevalidateResult>
  /** 偏好切换 */
  setEnabled(on: boolean): void
  /** 卸载 */
  dispose(): void
}

export function attachExternalChangeWatcher(
  deps: OpenFileWatcherIntegrationDeps,
): OpenFileWatcherIntegration {
  /** filePath -> token(用于精确 unregister) */
  const tokenByPath = new Map<string, WatchToken>()
  let disposed = false
  let enabled = true

  function isActivePath(p: string): boolean {
    const cur = deps.getCurrentFilePath()
    return !!cur && cur === p
  }

  /**
   * 统一处理外部变更事件。
   * 注意:此函数是 watchPathsAbs 回调路径上同步触发的入口,
   *       不能 throw,异常需内部 try/catch。
   */
  function handleExternalChange(filePath: string, kind: 'modified' | 'removed'): void {
    if (disposed || !enabled || !deps.enabled()) return
    if (!isActivePath(filePath)) return
    if (deps.isSkippablePath && deps.isSkippablePath(filePath)) return

    if (kind === 'removed') {
      try {
        deps.notifyMissing(filePath)
      } catch (e) {
        logWarn('[openFileWatcherIntegration] notifyMissing throw', String(e))
      }
      try {
        dispatchPathDeleted(filePath, false)
      } catch (e) {
        logWarn('[openFileWatcherIntegration] dispatchPathDeleted throw', String(e))
      }
      unregisterFor(filePath)
      return
    }

    // kind === 'modified'
    const dirty = !!deps.isDirty()
    if (!dirty) {
      if (deps.autoReloadCleanEnabled()) {
        void doAutoReload(filePath)
      } else {
        // 不自动重载:仅提示用户磁盘已变,需要手动决定;刷新 snapshot 已由 watcher 内部完成
        try {
          deps.notifyExternalChangedNoReload(filePath)
        } catch (e) {
          logWarn('[openFileWatcherIntegration] notifyExternalChangedNoReload throw', String(e))
        }
      }
      return
    }

    // 脏标签:弹模态
    void doConflictDialog(filePath)
  }

  async function doAutoReload(filePath: string): Promise<void> {
    try {
      await deps.reloadCurrentFile()
      try { deps.notifyAutoReloaded(filePath) } catch (e) {
        logWarn('[openFileWatcherIntegration] notifyAutoReloaded throw', String(e))
      }
    } catch (e) {
      logWarn('[openFileWatcherIntegration] auto-reload failed', { filePath, err: String(e) })
    }
  }

  async function doConflictDialog(filePath: string): Promise<void> {
    let choice: ConflictChoice = 'cancel'
    try {
      choice = await deps.askConflictChoice(filePath)
    } catch (e) {
      logWarn('[openFileWatcherIntegration] askConflictChoice throw', String(e))
      choice = 'cancel'
    }

    if (choice === 'reload') {
      try {
        await deps.reloadCurrentFile()
        // 同步 dirty=false:这里假定 reloadCurrentFile 内部已同步设置
        // 局部捕获异常,避免 reload 失败时吞噬错误
        try { deps.notifyReloadedAfterConflict(filePath) } catch (e) {
          logWarn('[openFileWatcherIntegration] notifyReloaded throw', String(e))
        }
      } catch (e) {
        logWarn('[openFileWatcherIntegration] reload after conflict failed', {
          filePath,
          err: String(e),
        })
      }
      return
    }

    if (choice === 'keep') {
      // 保留本地:不动作;但 watcher 内的 snapshot 已被事件刷新过,
      // 下次再检测到 mtime 不变时会被丢弃(false positive 防护)
      try { deps.notifyKept(filePath) } catch (e) {
        logWarn('[openFileWatcherIntegration] notifyKept throw', String(e))
      }
      return
    }

    // cancel / 默认:暂不动作,等用户下次保存或手动决定
    logDebug('[openFileWatcherIntegration] user cancel conflict dialog', { filePath })
  }

  function registerFor(filePath: string): void {
    if (disposed) return
    const fp = String(filePath || '').trim()
    if (!fp) return
    if (tokenByPath.has(fp)) return
    if (deps.isSkippablePath && deps.isSkippablePath(fp)) {
      logDebug('[openFileWatcherIntegration] 跳过监听(规则匹配)', { filePath: fp })
      return
    }
    try {
      const token = deps.watcher.register(fp, (path, kind /*, _next */) => {
        // 内部回调路径上不可 await;转换 async 由 doXxx 函数负责
        handleExternalChange(path, kind)
      })
      if (token) tokenByPath.set(fp, token)
    } catch (e) {
      logWarn('[openFileWatcherIntegration] register failed', { filePath: fp, err: String(e) })
    }
  }

  function unregisterFor(filePath: string): void {
    const fp = String(filePath || '').trim()
    if (!fp) return
    const token = tokenByPath.get(fp)
    if (!token) return
    try { deps.watcher.unregister(token) } catch (e) {
      logWarn('[openFileWatcherIntegration] unregister failed', { filePath: fp, err: String(e) })
    }
    tokenByPath.delete(fp)
  }

  function markSelfWriteCurrent(): void {
    const fp = deps.getCurrentFilePath()
    if (!fp) return
    try { deps.watcher.markSelfWrite(fp) } catch (e) {
      logWarn('[openFileWatcherIntegration] markSelfWrite failed', { filePath: fp, err: String(e) })
    }
  }

  function beginSelfWriteCurrent(path?: string | null): void {
    const fp = (path != null && path !== '') ? path : deps.getCurrentFilePath()
    if (!fp) return
    try { deps.watcher.beginSelfWrite(fp) } catch (e) {
      logWarn('[openFileWatcherIntegration] beginSelfWrite failed', { filePath: fp, err: String(e) })
    }
  }

  function finishSelfWriteCurrent(): void {
    const fp = deps.getCurrentFilePath()
    if (!fp) return
    try { deps.watcher.finishSelfWrite(fp) } catch (e) {
      logWarn('[openFileWatcherIntegration] finishSelfWrite failed', { filePath: fp, err: String(e) })
    }
  }

  async function revalidateCurrent(): Promise<RevalidateResult> {
    const fp = deps.getCurrentFilePath()
    if (!fp) return 'unchanged'
    let result: RevalidateResult = 'unchanged'
    try {
      result = await deps.watcher.revalidate(fp)
    } catch (e) {
      logWarn('[openFileWatcherIntegration] revalidate failed', { filePath: fp, err: String(e) })
      return 'unchanged'
    }
    if (result === 'unchanged') return 'unchanged'
    // 命中差异或缺失:走完整策略
    handleExternalChange(fp, result === 'missing' ? 'removed' : 'modified')
    return result
  }

  function setEnabled(on: boolean): void {
    enabled = !!on
    try { deps.watcher.setEnabled(enabled) } catch {}
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const [, token] of tokenByPath) {
      try { deps.watcher.unregister(token) } catch {}
    }
    tokenByPath.clear()
  }

  return {
    registerFor,
    unregisterFor,
    markSelfWriteCurrent,
    beginSelfWriteCurrent,
    finishSelfWriteCurrent,
    revalidateCurrent,
    setEnabled,
    dispose,
  }
}

