import { describe, it, expect } from 'vitest'
import {
  sanitizePluginEntryName,
  sanitizePluginId,
  sanitizePluginRelPath,
} from './pluginPath'

describe('sanitizePluginId', () => {
  it('接受现有官方 id 形态（含大写与点）', () => {
    expect(sanitizePluginId('ai-assistant')).toBe('ai-assistant')
    expect(sanitizePluginId('flymd-RAG')).toBe('flymd-RAG')
    expect(sanitizePluginId('note.templates_2')).toBe('note.templates_2')
    expect(sanitizePluginId('  spaced  ')).toBe('spaced')
  })

  it('拒绝路径穿越、分隔符、空值与超长 id', () => {
    for (const bad of [
      '', '..', '../evil', 'a/b', 'a\\b', '.hidden', '-dash', 'a'.repeat(65), 'a..b',
      // Windows 目录别名 / 设备名 / 百分号编码
      'ai-assistant.', 'CON', 'nul', 'com1', 'a%2e%2e',
    ]) {
      expect(() => sanitizePluginId(bad), bad).toThrow()
    }
  })
})

describe('sanitizePluginRelPath', () => {
  it('归一化分隔符与前导斜杠', () => {
    expect(sanitizePluginRelPath('main.js')).toBe('main.js')
    expect(sanitizePluginRelPath('js\\main.js')).toBe('js/main.js')
    expect(sanitizePluginRelPath('/js/main.js')).toBe('js/main.js')
    expect(sanitizePluginRelPath('assets//图 片.png')).toBe('assets/图 片.png')
  })

  it('空值回退到 fallback', () => {
    expect(sanitizePluginRelPath('', 'main.js')).toBe('main.js')
    expect(sanitizePluginRelPath('   ', 'main.js')).toBe('main.js')
    expect(sanitizePluginRelPath('', '')).toBe('')
  })

  it('拒绝穿越、盘符/ADS 与 NUL', () => {
    for (const bad of [
      '..', '../x.js', 'a/../../b.js', 'C:/x.js', 'a:b', 'a\0b', 'a/./b.js',
      'a?.js', 'a#b', 'a|b.js', 'a*b.js',
      'a%2e%2e/b.js', 'a%2fb.js', 'foo./b.js', 'foo /b.js', 'CON.js', 'a\u0001b',
    ]) {
      expect(() => sanitizePluginRelPath(bad), bad).toThrow()
    }
  })
})

describe('sanitizePluginEntryName', () => {
  it('接受普通文件名与 Unicode', () => {
    expect(sanitizePluginEntryName('main.js')).toBe('main.js')
    expect(sanitizePluginEntryName('图片.png')).toBe('图片.png')
    expect(sanitizePluginEntryName('a..b')).toBe('a..b')
  })

  it('拒绝空、点、分隔符、冒号与 NUL', () => {
    for (const bad of [
      '', '.', '..', 'a/b', 'a\\b', 'a:b', 'a\0b', 'a?.js', 'a|b',
      'CON', 'foo.', 'foo ', 'a\u0001b',
    ]) {
      expect(() => sanitizePluginEntryName(bad), bad).toThrow()
    }
  })
})
