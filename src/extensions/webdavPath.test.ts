import { describe, it, expect } from 'vitest'
import {
  resolveLocalSyncPath,
  sanitizeRemoteEntryName,
  sanitizeSyncRelPath,
} from './webdavPath'

describe('sanitizeRemoteEntryName', () => {
  it('接受普通文件名（含 Unicode / 空格 / 点）', () => {
    expect(sanitizeRemoteEntryName('note.md')).toBe('note.md')
    expect(sanitizeRemoteEntryName('图 片.png')).toBe('图 片.png')
    expect(sanitizeRemoteEntryName('.flymd')).toBe('.flymd')
    expect(sanitizeRemoteEntryName('a.b.c.pdf')).toBe('a.b.c.pdf')
  })

  it('拒绝分隔符 / 穿越 / 控制字符 / 空值', () => {
    for (const bad of [
      '',
      '.',
      '..',
      '../evil.md',
      'a/b.md',
      // 远端 href 解码后可能带反斜杠：Windows 上就是分隔符
      '..\\..\\evil.md',
      'a\\b.md',
      'a\0b.md',
      'a\nb.md',
      // Windows ADS
      'note.md:hidden',
    ]) {
      expect(sanitizeRemoteEntryName(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('sanitizeSyncRelPath', () => {
  it('归一化反斜杠与多余斜杠', () => {
    expect(sanitizeSyncRelPath('a\\b.md')).toBe('a/b.md')
    expect(sanitizeSyncRelPath('//a//b.md')).toBe('a/b.md')
    expect(sanitizeSyncRelPath('./a/./b.md')).toBe('a/b.md')
  })

  it('拒绝任何 .. 段，而不是折叠到根内', () => {
    for (const bad of ['..', '../x.md', 'a/../../x.md', 'a\\..\\x.md', 'x/..']) {
      expect(sanitizeSyncRelPath(bad), bad).toBeNull()
    }
  })

  it('拒绝控制字符与冒号，空结果返回 null', () => {
    expect(sanitizeSyncRelPath('')).toBeNull()
    expect(sanitizeSyncRelPath('/')).toBeNull()
    expect(sanitizeSyncRelPath('a\0b.md')).toBeNull()
    expect(sanitizeSyncRelPath('a:b.md')).toBeNull()
  })
})

describe('resolveLocalSyncPath', () => {
  it('POSIX 根：拼接并保持路径在根内', () => {
    expect(resolveLocalSyncPath('/library', 'sub/a.md')).toBe('/library/sub/a.md')
    expect(resolveLocalSyncPath('/library', './a.md')).toBe('/library/a.md')
  })

  it('Windows 根：统一使用反斜杠', () => {
    expect(resolveLocalSyncPath('C:\\library', 'sub/a.md')).toBe(
      'C:\\library\\sub\\a.md',
    )
    // 反斜杠形式的穿越必须被拒绝，不能落到根外
    expect(resolveLocalSyncPath('C:\\library', '..\\..\\evil.md')).toBeNull()
    expect(resolveLocalSyncPath('C:\\library', 'a\\..\\..\\evil.md')).toBeNull()
  })

  it('不安全 rel 或空根返回 null', () => {
    expect(resolveLocalSyncPath('/library', '..')).toBeNull()
    expect(resolveLocalSyncPath('/library', '')).toBeNull()
    expect(resolveLocalSyncPath('', 'a.md')).toBeNull()
  })
})
