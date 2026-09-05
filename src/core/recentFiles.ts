// 最近文件 store helper
// 抽离自 main.ts:5119-5139(getRecent + pushRecent)+ line 223(RECENT_MAX 常量)。
// 抽离理由:这两个函数只依赖 main.ts 模块级 `store` 全局,加一行 `getRecentFiles(store)` 即可消除闭包;
// 同时把 RECENT_MAX 与函数放一起,语义内聚。
// 参数化:`store` 改为显式 first param(允许 null,null 时静默降级),`RECENT_MAX` 也作为参数,
// 提升可测性——无需 mock 模块全局。
//
// 按库隔离：只要有库根（持久化库或临时库），最近文件读写库根下 .flymd/config.json
// 的 recent 字段；首次访问若库内无 recent 字段，从全局列表播种（仅取位于库根内的路径）。
// 仅无库状态回落全局 Store 的 recent key（保持旧行为）。
//
// 跨机器兼容：库内存储一律为相对库根路径（不同机器库根位置不同）；
// 对调用方暴露的仍是绝对路径。旧版绝对路径数据读取时兼容，下次写回自动转相对。

import type { Store } from '@tauri-apps/plugin-store'
import {
  getLibraryScope,
  readLibraryConfig,
  writeLibraryConfig,
  toLibraryRelativePath,
  resolveStoredLibraryPath,
} from './libraryConfig'
import { isInside, normSep } from './fsSafe'

export const RECENT_MAX = 5

const RECENT_KEY = 'recent'

async function getGlobalRecentFiles(store: Store | null): Promise<string[]> {
  if (!store) return []
  try {
    const value = (await store.get(RECENT_KEY)) as string[] | undefined
    return Array.isArray(value) ? value.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

/**
 * 读取最近文件列表(空 store/损坏值/无 store 全部静默降级为 [])
 * 有库根时优先读库内配置（无 recent 字段则从全局播种）
 */
export async function getRecentFiles(store: Store | null): Promise<string[]> {
  const scope = getLibraryScope()
  if (scope.root) {
    const root = scope.root
    try {
      const cfg = await readLibraryConfig()
      if (cfg) {
        if (Array.isArray(cfg.recent)) {
          // 相对路径解析回绝对；旧版绝对路径原样返回
          return cfg.recent
            .filter((p) => typeof p === 'string' && p)
            .map((p) => resolveStoredLibraryPath(root, p))
        }
        // 播种：全局列表中属于本库的路径（存相对）
        const seeded = (await getGlobalRecentFiles(store))
          .filter((p) => isInside(root, normSep(p)))
          .map((p) => toLibraryRelativePath(root, p))
          .filter((p): p is string => typeof p === 'string')
        await writeLibraryConfig({ recent: seeded })
        return seeded.map((p) => resolveStoredLibraryPath(root, p))
      }
    } catch {}
  }
  return await getGlobalRecentFiles(store)
}

/**
 * 推入一个新文件到最近列表(去重 + 移到首位 + 截断到 max)
 * store 为 null 时静默忽略；有库根时写入库内配置（相对路径）
 */
export async function pushRecentFile(
  store: Store | null,
  path: string,
  max: number = RECENT_MAX
): Promise<void> {
  const scope = getLibraryScope()
  if (scope.root) {
    const root = scope.root
    const rel = toLibraryRelativePath(root, path)
    // 库外路径不入库内配置，回落全局
    if (rel != null) {
      try {
        const cfg = await readLibraryConfig()
        const cur = Array.isArray(cfg?.recent) ? cfg!.recent.filter((p) => typeof p === 'string') : []
        const filtered = [rel, ...cur.filter((p) => p !== rel)].slice(0, max)
        if (await writeLibraryConfig({ recent: filtered })) return
      } catch {}
    }
  }
  if (!store) return
  try {
    const list = await getGlobalRecentFiles(store)
    const filtered = [path, ...list.filter((p) => p !== path)].slice(0, max)
    await store.set(RECENT_KEY, filtered)
    await store.save()
  } catch (e) {
    console.warn('保存最近文件失败:', e)
  }
}

// ===== 库内"当前文件"标识（通道A） =====
// 记录关闭应用/切库时最后激活标签对应的文件（库内相对路径存储，随库走）。
// 用途：启动无有效会话时全量打开 recent，并以它作为激活标签——它比 recent[0]
// 更准确（recent 是"打开顺序"，切回旧标签不会改变 recent 顺序）。

let _currentFileTimer: ReturnType<typeof setTimeout> | null = null
let _pendingCurrentFile: string | null = null
let _lastWrittenCurrentFile: string | null = null

/** 读取库内记录的"当前文件"（库内相对路径解析回绝对；无库/无记录/旧数据兼容） */
export async function getLibraryCurrentFile(): Promise<string | null> {
  let root: string | null = null
  try { root = getLibraryScope().root || null } catch {}
  if (!root) return null
  try {
    const cfg = await readLibraryConfig()
    const v = cfg?.currentFile
    if (typeof v !== 'string' || !v) return null
    return resolveStoredLibraryPath(root, v)
  } catch {
    return null
  }
}

/**
 * 记录"当前文件"（绝对路径）。防抖 + 值变化才写：切标签很频繁，
 * 避免每次切换都写 config.json / 触发 WebDAV 同步与跨窗口刷新抖动。
 * 无库根/库外路径/空路径（空白草稿标签）一律忽略，保留库内已有记录。
 */
export function setLibraryCurrentFile(path: string | null): void {
  let root: string | null = null
  try { root = getLibraryScope().root || null } catch {}
  if (!root) return
  if (!path) return
  const rel = toLibraryRelativePath(root, path)
  if (rel == null) return
  if (rel === _pendingCurrentFile || rel === _lastWrittenCurrentFile) return
  _pendingCurrentFile = rel
  if (_currentFileTimer != null) clearTimeout(_currentFileTimer)
  _currentFileTimer = setTimeout(() => { void flushLibraryCurrentFile() }, 500)
}

/** 立即落盘待写的 currentFile（退出/切库前调用，避免防抖未触发就销毁导致丢失） */
export async function flushLibraryCurrentFile(): Promise<void> {
  if (_currentFileTimer != null) {
    clearTimeout(_currentFileTimer)
    _currentFileTimer = null
  }
  const rel = _pendingCurrentFile
  _pendingCurrentFile = null
  if (rel == null) return
  if (rel === _lastWrittenCurrentFile) return
  try {
    if (await writeLibraryConfig({ currentFile: rel })) {
      _lastWrittenCurrentFile = rel
    }
  } catch {}
}
