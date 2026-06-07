/**
 * fileTree 路径工具单元测试
 *
 * 覆盖库文件树跨平台路径处理的纯函数:
 * - sep / norm / join / base / nameOf / isInside
 */

import { describe, it, expect } from 'vitest'
import { pathUtils } from './fileTree'

describe('fileTree 路径工具 - Unix 风格 (/)', () => {
  it('sep: 包含反斜杠 → \\, 否则 → /', () => {
    expect(pathUtils.sep('/home/user')).toBe('/')
    expect(pathUtils.sep('C:\\Users')).toBe('\\')
    expect(pathUtils.sep('mixed/path\\here')).toBe('\\')
  })

  it('norm: 折叠连续 /', () => {
    expect(pathUtils.norm('/a//b///c')).toBe('/a/b/c')
    expect(pathUtils.norm('/a/b/c')).toBe('/a/b/c')
  })

  it('join: 自动补分隔符(不折叠重复 /)', () => {
    expect(pathUtils.join('/a', 'b')).toBe('/a/b')
    expect(pathUtils.join('/a/', 'b')).toBe('/a/b')
    // join 不调用 norm,重复 / 由调用方在后续 norm 步骤处理
    expect(pathUtils.join('/a', '/b')).toBe('/a//b')
  })

  it('base: 取父目录', () => {
    expect(pathUtils.base('/a/b/c.md')).toBe('/a/b')
    expect(pathUtils.base('c.md')).toBe('')
  })

  it('nameOf: 取文件名', () => {
    expect(pathUtils.nameOf('/a/b/c.md')).toBe('c.md')
    expect(pathUtils.nameOf('c.md')).toBe('c.md')
    expect(pathUtils.nameOf('/a/b/')).toBe('/a/b/') // 末尾 / 时 pop() 返回空字符串,回退原 p
  })

  it('isInside: 大小写不敏感 + 边界判断', () => {
    expect(pathUtils.isInside('/home', '/home/user')).toBe(true)
    expect(pathUtils.isInside('/home/', '/home/user/doc.md')).toBe(true)
    expect(pathUtils.isInside('/home', '/other/user')).toBe(false)
    expect(pathUtils.isInside('/HOME', '/home/user')).toBe(true) // 大小写不敏感
    expect(pathUtils.isInside('/home', '/homestead')).toBe(false) // 边界:不是子目录
  })
})

describe('fileTree 路径工具 - Windows 风格 (\\)', () => {
  it('sep: 检测到 \\ → 返回 \\', () => {
    expect(pathUtils.sep('C:\\Users\\foo')).toBe('\\')
  })

  it('norm: 折叠 \\ 和 / 混合', () => {
    expect(pathUtils.norm('C:\\a\\b\\c')).toBe('C:\\a\\b\\c')
    // 包含 \\ → 全部转 \\
    expect(pathUtils.norm('C:/a\\b/c')).toBe('C:\\a\\b\\c')
  })

  it('join: Windows 风格', () => {
    expect(pathUtils.join('C:\\a', 'b')).toBe('C:\\a\\b')
  })

  it('base: Windows 路径', () => {
    expect(pathUtils.base('C:\\a\\b\\c.md')).toBe('C:\\a\\b')
  })

  it('nameOf: Windows 路径', () => {
    expect(pathUtils.nameOf('C:\\a\\b\\c.md')).toBe('c.md')
  })

  it('isInside: Windows 大小写不敏感', () => {
    expect(pathUtils.isInside('C:\\Users', 'C:\\Users\\foo\\bar.md')).toBe(true)
    expect(pathUtils.isInside('C:\\USERS', 'C:\\users\\foo')).toBe(true)
    expect(pathUtils.isInside('C:\\Users', 'C:\\Other\\foo')).toBe(false)
  })
})
