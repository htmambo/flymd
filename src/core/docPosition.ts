// 文档阅读/编辑位置持久化
// 抽离自 main.ts:1192-1280。
// 抽离理由:本块原 89 行,有 7 个 main-local 闭包依赖(store/currentFilePath/editor/
// preview/mode/wysiwyg/refreshStatus),通过 factory 模式(传 getter 函数)封装,
// 状态量(_docPosSaveTimer / _docPosMapCache / _docPosMapLoading)随实例封闭,模块自包含。
// mode 字段扩到 'edit' | 'preview' | 'wysiwyg'(主态 Mode = 'edit'|'preview'),
// 故使用本地 DocPosMode 类型避免污染主类型。
//
// PR-4: 读优先走 libraryPrivate.docPos（新通道,库内 local.json）,
// fallback 到旧 Store key（v1.4.4 及之前的 `docPos:<libId>`）确保升级期平滑。
// 写只走 libraryPrivate —— 迁移完成后不再写旧 Store key。

import type { Store } from '@tauri-apps/plugin-store'
import { libraryScopedKey, LIBRARY_CHANGED_EVENT, getLibraryScope } from './libraryConfig'
import { isInside } from './fsSafe'
import { readLibraryPrivate, writeLibraryPrivate } from './libraryPrivate'

export type DocPosMode = 'edit' | 'preview' | 'wysiwyg'

export type DocPos = {
  pos: number
  end?: number
  scroll: number
  pscroll: number
  mode: DocPosMode
  ts: number
}

export interface DocPositionStoreDeps {
  getStore: () => Store | null
  getCurrentFilePath: () => string | null
  getEditor: () => HTMLTextAreaElement
  getPreview: () => HTMLDivElement
  getMode: () => DocPosMode
  refreshStatus: () => void
}

export interface DocPositionStore {
  saveNow: () => Promise<void>
  scheduleSave: () => void
  restore: (path?: string) => Promise<void>
}

export function createDocPositionStore(deps: DocPositionStoreDeps): DocPositionStore {
  let saveTimer: number | null = null
  let mapCache: Record<string, DocPos> | null = null
  let mapLoading: Promise<Record<string, DocPos>> | null = null

  // 旧通道 Store key（fallback 用,迁移完成后新写不再写这里）
  const storeKey = () => libraryScopedKey('docPos')
  try {
    window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
      mapCache = null
      mapLoading = null
    })
  } catch {}

  const getMap = async (): Promise<Record<string, DocPos>> => {
    try {
      if (mapCache) return mapCache
      if (mapLoading) return await mapLoading
      mapLoading = (async () => {
        let map: Record<string, DocPos> = {}
        // PR-4: 优先读新通道 libraryPrivate.docPos。
        // 注释（PR-2 复审反馈）：libraryPrivate 是 per-libRoot 文件隔离，
        // 理论上不会混入其他库数据；保留原始行为不过滤主路径，只在
        // 下方的"旧全局 docPos 种子化"中用 isInside 过滤（这是真正的跨库迁移）。
        try {
          const priv = await readLibraryPrivate()
          if (priv?.docPos && typeof priv.docPos === 'object') {
            map = { ...priv.docPos } as Record<string, DocPos>
          }
        } catch {}
        // Fallback: 旧 Store key (兼容 v1.4.4 及之前数据;PR-4 迁移后会写入新通道)
        if (Object.keys(map).length === 0) {
          try {
            const store = deps.getStore()
            if (store) {
              const key = storeKey()
              const m = await store.get(key)
              if (m && typeof m === 'object') map = m as Record<string, DocPos>
              // 旧库首次读不到时,种子化:从全局 docPos 复制本库路径下的条目
              if (Object.keys(map).length === 0 && key !== 'docPos') {
                const g = await store.get('docPos')
                if (g && typeof g === 'object') {
                  const scope = getLibraryScope()
                  const seeded: Record<string, DocPos> = {}
                  if (scope.root) {
                    for (const [p, v] of Object.entries(g as Record<string, DocPos>)) {
                      if (isInside(scope.root, p)) seeded[p] = v
                    }
                  }
                  if (Object.keys(seeded).length > 0) {
                    map = seeded
                    // 触发迁移:旧值复制到新通道
                    try { await writeLibraryPrivate({ docPos: seeded }, { immediate: true }) } catch {}
                  }
                }
              }
            }
          } catch {}
        }
        mapCache = map
        return map
      })()
      return await mapLoading
    } catch { return {} }
    finally { mapLoading = null }
  }

  const saveNow = async (): Promise<void> => {
    try {
      const currentFilePath = deps.getCurrentFilePath()
      if (!currentFilePath) return
      // PR-4: 无库根 / 临时库场景不写新通道(写到无库根也没意义)
      // 临时库/无库 docPos 行为:无库根 = libraryPrivate.writeLibraryPrivate 返回 false,
      // 此处短路避免无效调用
      const scope = getLibraryScope()
      if (!scope.root) return
      const editor = deps.getEditor()
      const preview = deps.getPreview()
      const map = await getMap()
      map[currentFilePath] = {
        pos: editor.selectionStart >>> 0,
        end: editor.selectionEnd >>> 0,
        scroll: editor.scrollTop >>> 0,
        pscroll: preview.scrollTop >>> 0,
        mode: deps.getMode(),
        ts: Date.now(),
      }
      // PR-4: 写只走新通道 libraryPrivate
      // 留 debounce 默认 500ms(libraryPrivate 内部),与本模块的 400ms scheduleSave 叠加 = ~900ms 总延迟
      try { await writeLibraryPrivate({ docPos: map }) } catch {}
    } catch {}
  }

  const scheduleSave = (): void => {
    try {
      if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null }
      saveTimer = window.setTimeout(() => {
        // 这个保存会触发 store 序列化/IO,放到空闲时做,避免滚动/大文档场景偶发卡顿。
        try {
          const ric: any = (globalThis as any).requestIdleCallback
          if (typeof ric === 'function') {
            ric(() => { void saveNow() }, { timeout: 2000 })
          } else {
            setTimeout(() => { void saveNow() }, 0)
          }
        } catch {
          void saveNow()
        }
      }, 400)
    } catch {}
  }

  const restore = async (path?: string): Promise<void> => {
    try {
      const p = (path || deps.getCurrentFilePath() || '') as string
      if (!p) return
      const map = await getMap()
      const s = map[p]
      if (!s) return
      const editor = deps.getEditor()
      const preview = deps.getPreview()
      // 恢复编辑器光标与滚动
      try {
        const st = Math.max(0, Math.min(editor.value.length, s.pos >>> 0))
        const ed = Math.max(0, Math.min(editor.value.length, (s.end ?? st) >>> 0))
        editor.selectionStart = st
        editor.selectionEnd = ed
        editor.scrollTop = Math.max(0, s.scroll >>> 0)
        deps.refreshStatus()
      } catch {}
      // 恢复预览滚动(需在预览渲染后调用)
      try { preview.scrollTop = Math.max(0, s.pscroll >>> 0) } catch {}
    } catch {}
  }

  return { saveNow, scheduleSave, restore }
}
