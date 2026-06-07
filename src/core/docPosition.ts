// 文档阅读/编辑位置持久化
// 抽离自 main.ts:1192-1280。
// 抽离理由:本块原 89 行,有 7 个 main-local 闭包依赖(store/currentFilePath/editor/
// preview/mode/wysiwyg/refreshStatus),通过 factory 模式(传 getter 函数)封装,
// 状态量(_docPosSaveTimer / _docPosMapCache / _docPosMapLoading)随实例封闭,模块自包含。
// mode 字段扩到 'edit' | 'preview' | 'wysiwyg'(主态 Mode = 'edit'|'preview'),
// 故使用本地 DocPosMode 类型避免污染主类型。

import type { Store } from '@tauri-apps/plugin-store'

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

  const getMap = async (): Promise<Record<string, DocPos>> => {
    try {
      const store = deps.getStore()
      if (!store) return {}
      if (mapCache) return mapCache
      if (mapLoading) return await mapLoading
      mapLoading = (async () => {
        try {
          const m = await store.get('docPos')
          const map = (m && typeof m === 'object') ? (m as Record<string, DocPos>) : {}
          mapCache = map
          return map
        } catch {
          mapCache = {}
          return {}
        } finally {
          mapLoading = null
        }
      })()
      return await mapLoading
    } catch { return {} }
  }

  const saveNow = async (): Promise<void> => {
    try {
      const currentFilePath = deps.getCurrentFilePath()
      if (!currentFilePath) return
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
      const store = deps.getStore()
      if (store) {
        await store.set('docPos', map)
        await store.save()
      }
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
