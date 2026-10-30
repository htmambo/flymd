import { isOversizedDocumentSize, type DocumentSize } from '../core/largeDoc'

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
