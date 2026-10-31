// 「源码行号」偏好的唯一事实源。
//
// 三个消费方共用同一份读取、写入与变更事件：
//   - 主题面板开关（src/theme.ts）
//   - textarea 行号列（src/modes/sourceLineNumbers.ts）
//   - CM6 大文件源码视图的行号栏（src/modes/cm6Editor.ts / cm6ModeHost.ts）
//
// 取值语义与原实现逐字等价：只有字符串 'false' 视为关闭，
// 其余（含 key 不存在、脏值）一律视为开启——不改变老用户既有行为。

import { lsGetStringCached, lsSetStringCached } from './lsCache'

export const SOURCE_LINE_NUMBERS_KEY = 'flymd:sourceLineNumbers:enabled'
export const SOURCE_LINE_NUMBERS_CHANGED_EVENT = 'flymd:sourceLineNumbers:changed'

export interface SourceLineNumbersChangedDetail {
  enabled: boolean
}

export function getSourceLineNumbersEnabled(): boolean {
  try {
    return lsGetStringCached(SOURCE_LINE_NUMBERS_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setSourceLineNumbersEnabled(enabled: boolean): void {
  try {
    lsSetStringCached(SOURCE_LINE_NUMBERS_KEY, enabled ? 'true' : 'false')
  } catch {}
  try {
    const ev = new CustomEvent<SourceLineNumbersChangedDetail>(SOURCE_LINE_NUMBERS_CHANGED_EVENT, {
      detail: { enabled },
    })
    window.dispatchEvent(ev)
  } catch {}
}
