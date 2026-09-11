// 库私有化 v2 - PR-1 测试
// 覆盖 .flymd/local.json 默认排除项 + shouldSyncRelativePath 基础行为。
// 详见 docs/Task/Archive/2026-09/2026-09-11-library-private-v2-pr1-webdav-exclude.md

import { describe, it, expect } from 'vitest'
import { shouldSyncRelativePath, DEFAULT_EXCLUDE_GLOBS } from './webdavSync'

describe('PR-1: DEFAULT_EXCLUDE_GLOBS reserved patterns', () => {
  it('contains the four legacy excludes', () => {
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/.git/**')
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/.trash/**')
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/.DS_Store')
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/Thumbs.db')
  })

  it('contains the new reserved exclude: .flymd/local.json (PR-1)', () => {
    // 这是关键断言:库私有配置 v2 的 local.json 必须默认排除,
    // 否则图床凭据 / 光标位置 / ASR 偏好会被同步到 WebDAV 远端
    expect(DEFAULT_EXCLUDE_GLOBS).toContain('**/.flymd/local.json')
  })

  it('is a readonly array (frozen shape, accidental mutation guard)', () => {
    // `readonly string[]` 类型仅编译期生效,运行时仍是普通数组。
    // 这里不验证运行时不可变,只确认它是数组且有序
    expect(Array.isArray(DEFAULT_EXCLUDE_GLOBS)).toBe(true)
    expect(DEFAULT_EXCLUDE_GLOBS.length).toBeGreaterThanOrEqual(5)
  })
})

describe('shouldSyncRelativePath - reserved excludes (PR-1)', () => {
  it('allows .flymd/library-id.json (channel A, shareable)', () => {
    // 库内共享配置 (.flymd/config.json / library-id.json) 必须可同步
    expect(shouldSyncRelativePath('.flymd/library-id.json')).toBe(true)
  })

  it('allows regular markdown files', () => {
    expect(shouldSyncRelativePath('notes/foo.md')).toBe(true)
    expect(shouldSyncRelativePath('README.markdown')).toBe(true)
  })

  it('allows regular image files', () => {
    expect(shouldSyncRelativePath('images/pic.png')).toBe(true)
    expect(shouldSyncRelativePath('images/pic.jpg')).toBe(true)
    expect(shouldSyncRelativePath('images/pic.svg')).toBe(true)
  })

  it('allows PDF files', () => {
    expect(shouldSyncRelativePath('docs/manual.pdf')).toBe(true)
  })

  it('blocks empty path', () => {
    expect(shouldSyncRelativePath('')).toBe(false)
  })

  it('handles leading slashes in path', () => {
    // 路径清洗: 去掉前导 / 后判断
    expect(shouldSyncRelativePath('/notes/foo.md')).toBe(true)
    expect(shouldSyncRelativePath('//notes/foo.md')).toBe(true)
  })

  it('is case-insensitive for extension check', () => {
    expect(shouldSyncRelativePath('notes/FOO.MD')).toBe(true)
    expect(shouldSyncRelativePath('notes/FOO.Png')).toBe(true)
  })
})

describe('PR-1: regression - exclusion logic integrity', () => {
  it('legacy excludes still recognized (sanity check)', () => {
    // 旧 glob 字符串本身不进 shouldSyncRelativePath(那个检查走 excludeGlobs 数组
    // 由调用方做 glob 匹配);这里只验证 shouldSyncRelativePath 不会误把合法文件
    // 当成"非白名单"而拒绝同步
    expect(shouldSyncRelativePath('foo.txt')).toBe(true)
    expect(shouldSyncRelativePath('bar.md')).toBe(true)
  })

  it('library-id.json is specifically allowed (not just by extension)', () => {
    // .json 扩展名不在白名单里,需要靠特殊判断放行
    expect(shouldSyncRelativePath('config.json')).toBe(false)
    expect(shouldSyncRelativePath('.flymd/library-id.json')).toBe(true)
  })
})
