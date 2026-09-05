// 文档库排序偏好（纯 Store 读写，不依赖 UI）
// 按库隔离：有库根（持久化库或临时库）时读写库内 .flymd/config.json 的 librarySort 字段；
// 无库回落全局 Store 的 librarySort key（保持旧行为）。

import type { Store } from '@tauri-apps/plugin-store'
import { getLibraryScope, readLibraryConfig, writeLibraryConfig } from './libraryConfig'

export type LibSortMode = 'name_asc' | 'name_desc' | 'mtime_asc' | 'mtime_desc'

const ALLOWED: LibSortMode[] = ['name_asc', 'name_desc', 'mtime_asc', 'mtime_desc']

function normalize(val: unknown): LibSortMode | null {
  const s = typeof val === 'string' ? val : ''
  return ALLOWED.includes(s as any) ? (s as LibSortMode) : null
}

// 从 Store 中读取库排序偏好，非法值回退到 name_asc
export async function getLibrarySort(store: Store | null): Promise<LibSortMode> {
  try {
    const scope = getLibraryScope()
    if (scope.root) {
      const cfg = await readLibraryConfig()
      if (cfg) {
        const v = normalize(cfg.librarySort)
        if (v) return v
        // 播种全局值到库内
        const global = normalize(store ? await store.get('librarySort') : null)
        if (global) {
          try { await writeLibraryConfig({ librarySort: global }) } catch {}
          return global
        }
        return 'name_asc'
      }
    }
    if (!store) return 'name_asc'
    return normalize(await store.get('librarySort')) || 'name_asc'
  } catch {
    return 'name_asc'
  }
}

// 将库排序偏好写入库内配置（有库根时）或全局 Store（无库）
export async function setLibrarySort(
  store: Store | null,
  mode: LibSortMode,
): Promise<void> {
  try {
    const scope = getLibraryScope()
    if (scope.root) {
      if (await writeLibraryConfig({ librarySort: mode })) return
    }
    if (!store) return
    await store.set('librarySort', mode)
    await store.save()
  } catch {}
}
