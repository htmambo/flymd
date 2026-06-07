// 最近文件 store helper
// 抽离自 main.ts:5119-5139(getRecent + pushRecent)+ line 223(RECENT_MAX 常量)。
// 抽离理由:这两个函数只依赖 main.ts 模块级 `store` 全局,加一行 `getRecentFiles(store)` 即可消除闭包;
// 同时把 RECENT_MAX 与函数放一起,语义内聚。
// 参数化:`store` 改为显式 first param(允许 null,null 时静默降级),`RECENT_MAX` 也作为参数,
// 提升可测性——无需 mock 模块全局。

import type { Store } from '@tauri-apps/plugin-store'

export const RECENT_MAX = 5

const RECENT_KEY = 'recent'

/**
 * 读取最近文件列表(空 store/损坏值/无 store 全部静默降级为 [])
 */
export async function getRecentFiles(store: Store | null): Promise<string[]> {
  if (!store) return []
  try {
    const value = (await store.get(RECENT_KEY)) as string[] | undefined
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/**
 * 推入一个新文件到最近列表(去重 + 移到首位 + 截断到 max)
 * store 为 null 时静默忽略
 */
export async function pushRecentFile(
  store: Store | null,
  path: string,
  max: number = RECENT_MAX
): Promise<void> {
  if (!store) return
  try {
    const list = await getRecentFiles(store)
    const filtered = [path, ...list.filter((p) => p !== path)].slice(0, max)
    await store.set(RECENT_KEY, filtered)
    await store.save()
  } catch (e) {
    console.warn('保存最近文件失败:', e)
  }
}
