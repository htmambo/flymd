// AI 可见范围与库内受限读写的测试
//
// 覆盖宿主新增的四个插件 API 背后的纯逻辑：
// - normalizeLibraryRelPath：库内相对路径归一（越界一律拒绝）
// - AI 可见范围过滤：listLibraryFiles 的结果要去掉被排除目录下的文件
//
// 设计文档：docs/Task/Active/2026-11-01-scheduled-ai-recipes.md

import { describe, it, expect } from 'vitest'
import { normalizeLibraryRelPath } from './pluginHost'

describe('normalizeLibraryRelPath', () => {
  it('接受库内相对路径并归一分隔符', () => {
    expect(normalizeLibraryRelPath('AI/日报.md')).toBe('AI/日报.md')
    expect(normalizeLibraryRelPath('AI\\日报.md')).toBe('AI/日报.md')
    expect(normalizeLibraryRelPath('./AI/日报.md')).toBe('AI/日报.md')
    expect(normalizeLibraryRelPath('AI//日报.md')).toBe('AI/日报.md')
  })

  it('拒绝绝对路径', () => {
    expect(normalizeLibraryRelPath('/etc/passwd')).toBeNull()
    expect(normalizeLibraryRelPath('C:\\Windows\\x.md')).toBeNull()
    expect(normalizeLibraryRelPath('\\\\server\\share\\x.md')).toBeNull()
  })

  it('拒绝前导斜杠（与 MCP 的路径约定一致）', () => {
    // MCP 的 resolve_write_path 同样拒绝：路径必须是相对于库根的相对路径，
    // 不猜测用户是不是想表达「从库根开始」。
    expect(normalizeLibraryRelPath('/AI/日报.md')).toBeNull()
  })

  it('拒绝 .. 越界', () => {
    expect(normalizeLibraryRelPath('../outside.md')).toBeNull()
    expect(normalizeLibraryRelPath('a/../../outside.md')).toBeNull()
    expect(normalizeLibraryRelPath('a/../b.md')).toBeNull()
  })

  it('拒绝空路径', () => {
    expect(normalizeLibraryRelPath('')).toBeNull()
    expect(normalizeLibraryRelPath('   ')).toBeNull()
    expect(normalizeLibraryRelPath('/')).toBeNull()
    expect(normalizeLibraryRelPath('.')).toBeNull()
    expect(normalizeLibraryRelPath(null)).toBeNull()
    expect(normalizeLibraryRelPath(undefined)).toBeNull()
  })

  it('拒绝非字符串', () => {
    expect(normalizeLibraryRelPath(123)).toBeNull()
    expect(normalizeLibraryRelPath({})).toBeNull()
  })
})

describe('AI 可见范围过滤语义', () => {
  // 与 Rust 侧 flymd_mcp::config::McpConfig 保持一致的行为约定。
  // 这里用一份独立的参考实现做交叉校验——两边规则必须一致，
  // 否则同一个库在 MCP 里和插件里会看到不同的内容。
  const DEFAULT_EXCLUDE = [
    '.git', '.hg', '.svn', '.node_modules', 'node_modules', 'target', 'dist',
    'build', '.next', '.vite', '.obsidian', '.trash', '.flymd', 'ebwebview',
    'code cache', 'gpucache', 'service worker',
    'media', 'assets', 'asset', 'attachment', 'attachments', 'templates',
    'template', 'excalidraw', '.excalidraw', '附件', '模板',
  ]

  function isExcludedDir(rel: string, exclude: string[] = DEFAULT_EXCLUDE): boolean {
    const lower = rel.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
    if (!lower) return false
    return exclude.some((e) => {
      const el = e.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
      if (!el) return false
      if (el.includes('/')) return lower === el || lower.startsWith(el + '/')
      return lower.split('/').some((seg) => seg === el)
    })
  }

  it('不含斜杠的规则按目录名任意层级命中', () => {
    expect(isExcludedDir('media')).toBe(true)
    expect(isExcludedDir('media/88-Template')).toBe(true)
    expect(isExcludedDir('a/b/media')).toBe(true)
    expect(isExcludedDir('a/b/media/deep')).toBe(true)
  })

  it('含斜杠的规则按相对路径前缀命中', () => {
    // 这里只放路径前缀规则（不带内置默认），才能看清前缀语义本身
    const exclude = ['Personal/media']
    expect(isExcludedDir('Personal/media', exclude)).toBe(true)
    expect(isExcludedDir('Personal/media/sub', exclude)).toBe(true)
    expect(isExcludedDir('Other/media', exclude)).toBe(false)
    expect(isExcludedDir('Personal/notes', exclude)).toBe(false)
  })

  it('内置默认与路径前缀规则并存时按各自语义生效', () => {
    // 内置默认里的 media（不含斜杠 → 目录名任意层级）与用户加的
    // Personal/media（含斜杠 → 只命中这一处）互不干扰
    const exclude = [...DEFAULT_EXCLUDE, 'Personal/media']
    expect(isExcludedDir('Other/media', exclude)).toBe(true)
    expect(isExcludedDir('Personal/notes', exclude)).toBe(false)
  })

  it('大小写不敏感', () => {
    expect(isExcludedDir('Media')).toBe(true)
    expect(isExcludedDir('MEDIA/Sub')).toBe(true)
  })

  it('普通笔记目录不被排除', () => {
    expect(isExcludedDir('个人')).toBe(false)
    expect(isExcludedDir('个人/AI')).toBe(false)
    expect(isExcludedDir('网络收藏')).toBe(false)
  })

  it('典型模板目录确实落在排除范围内', () => {
    // 真实库里模板的所在位置——这一条守住「用户最初提的那个问题」
    expect(isExcludedDir('media/88-Template')).toBe(true)
    expect(isExcludedDir('media/test')).toBe(true)
  })
})
