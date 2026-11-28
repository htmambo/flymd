// 配置备份恢复路径解析：只允许 appdata / applocal / 设置文件 / flymd 前缀，
// 且拒绝盘符、ADS、控制字符（Windows 上绝对路径段会替换 baseDir）。

import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: async () => [],
  readFile: async () => new Uint8Array(),
  mkdir: async () => {},
  remove: async () => {},
  exists: async () => false,
  BaseDirectory: { AppData: 7, AppConfig: 8, AppLocalData: 9 },
}))

import { normalizeBackupPath, resolveBackupPath, SETTINGS_FILE_NAME } from './configBackup'

describe('normalizeBackupPath', () => {
  it('归一化分隔符并丢弃 . / .. 与空段', () => {
    expect(normalizeBackupPath('applocal/../../x')).toBe('applocal/x')
    expect(normalizeBackupPath('\\appdata//a\\b.json')).toBe('appdata/a/b.json')
    expect(normalizeBackupPath('./a/./b')).toBe('a/b')
    expect(normalizeBackupPath('')).toBe('')
  })
})

describe('resolveBackupPath', () => {
  it('接受合法备份路径', () => {
    expect(resolveBackupPath('appdata/flymd-settings.json')).toEqual({
      baseDir: 7,
      relPath: 'flymd-settings.json',
    })
    expect(resolveBackupPath('applocal/flymd/plugins/p/main.js')).toEqual({
      baseDir: 9,
      relPath: 'flymd/plugins/p/main.js',
    })
    expect(resolveBackupPath('flymd/plugins/p/main.js')).toEqual({
      baseDir: 9,
      relPath: 'flymd/plugins/p/main.js',
    })
    expect(resolveBackupPath(SETTINGS_FILE_NAME)).toEqual({
      baseDir: 7,
      relPath: 'flymd-settings.json',
    })
  })

  it('相对路径穿越被折叠回前缀内，不会逃出 baseDir', () => {
    expect(resolveBackupPath('applocal/../../evil.txt')).toEqual({
      baseDir: 9,
      relPath: 'evil.txt',
    })
    expect(resolveBackupPath('appdata/a/../../../x.json')).toEqual({
      baseDir: 7,
      relPath: 'a/x.json',
    })
  })

  it('拒绝盘符 / ADS / 控制字符 / 绝对路径 / 未知前缀', () => {
    for (const bad of [
      'applocal/C:/Windows/System32/drivers/etc/hosts',
      'applocal/c:/x',
      'applocal/a:b',
      'applocal/a\0b',
      'applocal/a\nb',
      '/etc/passwd',
      'appdata/..',
      'libraryConfig:lib1/config.json',
      'unknown/x',
      '',
    ]) {
      expect(resolveBackupPath(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
