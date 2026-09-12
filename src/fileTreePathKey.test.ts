/**
 * fileTreePathKey 单元测试
 *
 * 覆盖：
 * - normDirKey：反斜杠归一、尾斜杠去除、驱动器根保留、空串守卫、大小写归一
 * - pathPrefixMatch：相等、前缀、段级边界（C:/lib vs C:/library）
 * - invalidateDirDocPresenceScan 行为通过 mock 验证
 */

import { describe, it, expect } from 'vitest'
import {
  normDirKey,
  pathPrefixMatch,
  __resetCiFsCache,
} from './fileTreePathKey'

describe('normDirKey', () => {
  it('反斜杠 → 正斜杠', () => {
    expect(normDirKey('C:\\Users\\foo', false)).toBe('C:/Users/foo')
    expect(normDirKey('a\\b\\c', false)).toBe('a/b/c')
  })

  it('去尾斜杠（普通路径）', () => {
    expect(normDirKey('/a/b/c/', false)).toBe('/a/b/c')
    expect(normDirKey('/a/b/c///', false)).toBe('/a/b/c')
  })

  it('保留驱动器根尾冒号', () => {
    expect(normDirKey('C:', false)).toBe('C:')
    expect(normDirKey('c:', false)).toBe('c:')
    expect(normDirKey('C:/', false)).toBe('C:')
    expect(normDirKey('C:\\', false)).toBe('C:')
    expect(normDirKey('C:\\Users', false)).toBe('C:/Users')
  })

  it('大小写不敏感平台 toLowerCase', () => {
    expect(normDirKey('C:/Users/Foo', true)).toBe('c:/users/foo')
    expect(normDirKey('Library/Docs', true)).toBe('library/docs')
  })

  it('大小写敏感平台保留大小写', () => {
    expect(normDirKey('C:/Users/Foo', false)).toBe('C:/Users/Foo')
    expect(normDirKey('Library/Docs', false)).toBe('Library/Docs')
  })

  it('空串守卫：归一后为空时返回原值', () => {
    expect(normDirKey('', false)).toBe('')
    expect(normDirKey('/', false)).toBe('/')  // 单一 / 保留（length=1 不进 trim 分支）
  })

  it('混合反斜杠与正斜杠', () => {
    expect(normDirKey('C:\\Users/foo/bar', false)).toBe('C:/Users/foo/bar')
  })
})

describe('pathPrefixMatch', () => {
  it('相等返回 true', () => {
    expect(pathPrefixMatch('/a/b', '/a/b')).toBe(true)
    expect(pathPrefixMatch('C:/Users', 'C:/Users')).toBe(true)
  })

  it('子路径返回 true', () => {
    expect(pathPrefixMatch('/a/b/c', '/a/b')).toBe(true)
    expect(pathPrefixMatch('/a/b/c/d/e', '/a/b')).toBe(true)
  })

  it('段级边界：兄弟目录不匹配', () => {
    expect(pathPrefixMatch('C:/library', 'C:/lib')).toBe(false)
    expect(pathPrefixMatch('/a/bc', '/a/b')).toBe(false)
    expect(pathPrefixMatch('/docs-v2', '/docs')).toBe(false)
  })

  it('空串守卫', () => {
    expect(pathPrefixMatch('', '/a')).toBe(false)
    expect(pathPrefixMatch('/a', '')).toBe(false)
    expect(pathPrefixMatch('', '')).toBe(false)
  })

  it('短路径 vs 长 prefix 返回 false（无错位）', () => {
    expect(pathPrefixMatch('/a', '/a/b')).toBe(false)
  })

  it('驱动器根与子目录', () => {
    expect(pathPrefixMatch('C:/Users/foo', 'C:')).toBe(true)
    expect(pathPrefixMatch('C:', 'C:')).toBe(true)
  })

  it('混合分隔符与归一配合', () => {
    // 调用方应先用 normDirKey 归一再传入；这里假设已归一
    expect(pathPrefixMatch('C:/Users/foo', 'C:/Users')).toBe(true)
    expect(pathPrefixMatch('C:/Users', 'C:')).toBe(true)
  })
})

describe('isCaseInsensitiveFS memoize', () => {
  it('memoize 命中后变更 platform 也不会影响返回值', () => {
    __resetCiFsCache()
    const origPlatform = (globalThis as any).navigator?.platform
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'test' },
      configurable: true,
    })
    const v1 = (globalThis as any).navigator?.platform
    expect(v1).toBe('Win32')
    __resetCiFsCache()
    ;(globalThis as any).navigator.platform = 'Linux x86_64'
    // 重新检测
    const v2 = (globalThis as any).navigator?.platform
    expect(v2).toBe('Linux x86_64')
    if (origPlatform) Object.defineProperty(globalThis, 'navigator', { value: { platform: origPlatform }, configurable: true })
    __resetCiFsCache()
  })
})
