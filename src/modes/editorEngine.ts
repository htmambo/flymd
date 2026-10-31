import { isOversizedDocumentSize, type DocumentSize } from '../core/largeDoc'

/**
 * CM6 源码视图在容器上的标记类。
 * 挂载（enableCm6Mode）与卸载（destroyCm6Mode）同生共死——
 * 切到阅读/源码模式时一并移除，因此它可以作为"当前处于 CM6 源码视图"的可靠信号。
 * 共享常量：避免 DOM 标记与读取方各自手写字符串而漂移。
 */
export const CM6_VIEW_CLASS = 'wysiwyg-cm6'

export type LargeDocEnginePreference = 'auto' | 'cm6' | 'milkdown'
export type EditorEngine = 'cm6' | 'milkdown'

export function getLargeDocEnginePreference(storage?: Pick<Storage, 'getItem'>): LargeDocEnginePreference {
  try {
    const value = storage?.getItem('flymd:largeDocEngine') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('flymd:largeDocEngine') : null)
    return value === 'cm6' || value === 'milkdown' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function resolveEditorEngine(size: DocumentSize, preference: LargeDocEnginePreference): EditorEngine {
  if (preference === 'cm6') return 'cm6'
  if (preference === 'milkdown') return 'milkdown'
  return isOversizedDocumentSize(size) ? 'cm6' : 'milkdown'
}
