/**
 * 库面板偏好持久化(localStorage)
 * 从 main.ts 抽离,只依赖 localStorage 全局
 */

export const LIBRARY_DOCKED_LS_KEY = 'flymd:libraryDocked'
export const LIBRARY_SIDE_LS_KEY = 'flymd:librarySide'

export type LibrarySide = 'left' | 'right'

/** 读库面板停靠状态,true=固定/false=覆盖式/null=未设置 */
export function readLibraryDockedFromLocalStorage(): boolean | null {
  try {
    const raw = localStorage.getItem(LIBRARY_DOCKED_LS_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {}
  return null
}

/** 写库面板停靠状态 */
export function writeLibraryDockedToLocalStorage(v: boolean): void {
  try { localStorage.setItem(LIBRARY_DOCKED_LS_KEY, v ? '1' : '0') } catch {}
}

/** 读库面板位置 */
export function readLibrarySideFromLocalStorage(): LibrarySide | null {
  try {
    const raw = localStorage.getItem(LIBRARY_SIDE_LS_KEY)
    if (raw === 'left' || raw === 'right') return raw
  } catch {}
  return null
}

/** 写库面板位置 */
export function writeLibrarySideToLocalStorage(v: LibrarySide): void {
  try { localStorage.setItem(LIBRARY_SIDE_LS_KEY, v) } catch {}
}
