// @vitest-environment jsdom
// 「源码行号」偏好单测：默认开启、脏值语义、写入即派发事件。
// 这条偏好同时驱动 textarea 行号列与大文件 CM6 视图的行号栏，
// 取值语义一旦漂移，两个视图会各行其是，故在此锁死。

import { beforeEach, describe, expect, it } from 'vitest'
import { lsRemoveCached, lsSetStringCached } from './lsCache'
import {
  SOURCE_LINE_NUMBERS_CHANGED_EVENT,
  SOURCE_LINE_NUMBERS_KEY,
  getSourceLineNumbersEnabled,
  setSourceLineNumbersEnabled,
} from './sourceLineNumbersPref'

beforeEach(() => {
  try { localStorage.clear() } catch {}
  lsRemoveCached(SOURCE_LINE_NUMBERS_KEY)
})

describe('「源码行号」偏好', () => {
  it('key 不存在时默认开启', () => {
    expect(getSourceLineNumbersEnabled()).toBe(true)
  })

  it('只有字符串 false 视为关闭，其余脏值一律视为开启', () => {
    const cases: Array<[string, boolean]> = [
      ['false', false],
      ['true', true],
      ['0', true],
      ['off', true],
      ['', true],
      ['FALSE', true],
    ]
    for (const [value, expected] of cases) {
      // 走真实写入路径（内存缓存 + localStorage 同时更新），读的就是缓存里的值
      lsSetStringCached(SOURCE_LINE_NUMBERS_KEY, value)
      expect(getSourceLineNumbersEnabled(), `value=${JSON.stringify(value)}`).toBe(expected)
    }
  })

  it('写入后读取一致，并派发带 enabled 的变更事件', () => {
    const seen: boolean[] = []
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ enabled: boolean }>).detail.enabled)
    }
    window.addEventListener(SOURCE_LINE_NUMBERS_CHANGED_EVENT, listener)
    try {
      setSourceLineNumbersEnabled(false)
      expect(getSourceLineNumbersEnabled()).toBe(false)
      setSourceLineNumbersEnabled(true)
      expect(getSourceLineNumbersEnabled()).toBe(true)
    } finally {
      window.removeEventListener(SOURCE_LINE_NUMBERS_CHANGED_EVENT, listener)
    }
    expect(seen).toEqual([false, true])
  })

  it('事件名与键名是导出的常量，不靠字符串字面量在多处手写', () => {
    expect(SOURCE_LINE_NUMBERS_KEY).toBe('flymd:sourceLineNumbers:enabled')
    expect(SOURCE_LINE_NUMBERS_CHANGED_EVENT).toBe('flymd:sourceLineNumbers:changed')
  })
})
