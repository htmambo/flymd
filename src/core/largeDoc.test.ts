// 超大文档判定测试（perf 批次 I）
//
// 锁定三件事：
// 1. 阈值判定在边界上精确（字节数 / 行数，含"恰好等于阈值"）
// 2. UTF-8 字节数对中英文混排正确（不能用 length 近似）
// 3. 行数统计与体积格式化正确

import { describe, it, expect } from 'vitest'
import {
  isOversizedDocument,
  isOversizedDocumentSize,
  describeDocumentSize,
  utf8ByteLength,
  countLines,
  formatDocumentSize,
  createOversizedNoticeDedup,
  WYSIWYG_AUTO_ENABLE_MAX_BYTES,
  WYSIWYG_AUTO_ENABLE_MAX_LINES,
} from './largeDoc'

describe('utf8ByteLength', () => {
  it('ASCII 按 1 字节计', () => {
    expect(utf8ByteLength('')).toBe(0)
    expect(utf8ByteLength('abc')).toBe(3)
  })

  it('中文按 3 字节计', () => {
    expect(utf8ByteLength('中文')).toBe(6)
  })

  it('emoji（代理对）按 4 字节计', () => {
    expect(utf8ByteLength('😀')).toBe(4)
  })

  it('混合文本与 TextEncoder 结果一致', () => {
    const s = 'Hello 世界 😀 混排\n第二行'
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length)
  })
})

describe('countLines', () => {
  it('空串为 0 行', () => {
    expect(countLines('')).toBe(0)
  })

  it('无换行符为 1 行', () => {
    expect(countLines('abc')).toBe(1)
  })

  it('按换行符计数', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\nb\nc\n')).toBe(4)
  })

  it('CRLF 只算一行（\\r 不重复计数）', () => {
    expect(countLines('a\r\nb\r\nc')).toBe(3)
  })

  it('孤立 \\r 也计为换行（经典 Mac 行尾）', () => {
    expect(countLines('a\rb')).toBe(2)
    expect(countLines('a\rb\rc')).toBe(3)
  })

  it('结尾的孤立 \\r 也算一行', () => {
    expect(countLines('abc\r')).toBe(2)
  })
})

describe('isOversizedDocument', () => {
  it('空文档不算超大', () => {
    expect(isOversizedDocument('')).toBe(false)
  })

  it('普通小文档不算超大', () => {
    expect(isOversizedDocument('# 标题\n\n正文\n')).toBe(false)
  })

  it('字节数恰好等于阈值时判为超大', () => {
    const text = 'a'.repeat(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(utf8ByteLength(text)).toBe(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(isOversizedDocument(text)).toBe(true)
  })

  it('字节数差 1 字节时不算超大', () => {
    const text = 'a'.repeat(WYSIWYG_AUTO_ENABLE_MAX_BYTES - 1)
    expect(isOversizedDocument(text)).toBe(false)
  })

  it('中文文档按字节判定：字符数不足但字节数超阈值 → 超大', () => {
    // 每字 3 字节，200KB 阈值约需 69906 个汉字
    const text = '中'.repeat(70000)
    expect(text.length).toBeLessThan(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(utf8ByteLength(text)).toBeGreaterThan(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(isOversizedDocument(text)).toBe(true)
  })

  it('行数恰好等于阈值时判为超大', () => {
    const text = Array.from({ length: WYSIWYG_AUTO_ENABLE_MAX_LINES }, () => 'x').join('\n')
    expect(countLines(text)).toBe(WYSIWYG_AUTO_ENABLE_MAX_LINES)
    expect(isOversizedDocument(text)).toBe(true)
  })

  it('行数差 1 时不算超大', () => {
    const text = Array.from({ length: WYSIWYG_AUTO_ENABLE_MAX_LINES - 1 }, () => 'x').join('\n')
    expect(isOversizedDocument(text)).toBe(false)
  })

  it('行数超阈值但体积很小 → 仍判为超大（长行文档）', () => {
    const text = Array.from({ length: WYSIWYG_AUTO_ENABLE_MAX_LINES + 1 }, () => '').join('\n')
    expect(utf8ByteLength(text)).toBeLessThan(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(isOversizedDocument(text)).toBe(true)
  })
})

describe('describeDocumentSize', () => {
  it('返回字节数与行数', () => {
    const s = '中文\nabc'
    expect(describeDocumentSize(s)).toEqual({ bytes: 10, lines: 2 })
  })

  it('与逐项统计一致（单遍扫描不得改变语义）', () => {
    const s = 'Hello 世界 😀 混排\r\n第二行\r第三行\n'
    const size = describeDocumentSize(s)
    expect(size.bytes).toBe(utf8ByteLength(s))
    expect(size.lines).toBe(countLines(s))
  })
})

describe('isOversizedDocumentSize', () => {
  it('与 isOversizedDocument 对同一文本结论一致', () => {
    const small = '# 标题\n\n正文\n'
    expect(isOversizedDocumentSize(describeDocumentSize(small))).toBe(isOversizedDocument(small))

    const big = 'a'.repeat(WYSIWYG_AUTO_ENABLE_MAX_BYTES)
    expect(isOversizedDocumentSize(describeDocumentSize(big))).toBe(isOversizedDocument(big))
  })

  it('按字节与行数任一超限即判为超大', () => {
    expect(isOversizedDocumentSize({ bytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES, lines: 1 })).toBe(true)
    expect(isOversizedDocumentSize({ bytes: 1, lines: WYSIWYG_AUTO_ENABLE_MAX_LINES })).toBe(true)
    expect(isOversizedDocumentSize({
      bytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES - 1,
      lines: WYSIWYG_AUTO_ENABLE_MAX_LINES - 1,
    })).toBe(false)
  })
})

describe('formatDocumentSize', () => {
  it('按量级格式化', () => {
    expect(formatDocumentSize(0)).toBe('0 B')
    expect(formatDocumentSize(512)).toBe('512 B')
    expect(formatDocumentSize(2048)).toBe('2 KB')
    expect(formatDocumentSize(553496)).toBe('541 KB')
    expect(formatDocumentSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('GB 量级', () => {
    expect(formatDocumentSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB')
  })

  it('KB 分级不出现 "1024 KB"（收口后直接进 MB）', () => {
    expect(formatDocumentSize(1024 * 1024 - 1)).toBe('1.0 MB')
    expect(formatDocumentSize(1024 * 1024 - 1024)).toBe('1023 KB')
  })
})

describe('createOversizedNoticeDedup', () => {
  it('同一路径只提示一次', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('/a.md')).toBe(true)
    expect(dedup.consume('/a.md')).toBe(false)
    expect(dedup.consume('/a.md')).toBe(false)
  })

  it('换文档会再次提示', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('/a.md')).toBe(true)
    expect(dedup.consume('/b.md')).toBe(true)
  })

  it('回到先前的文档不会重复提示（一次会话内每份文档只提示一次）', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('/a.md')).toBe(true)
    expect(dedup.consume('/b.md')).toBe(true)
    expect(dedup.consume('/a.md')).toBe(false)
  })

  it('未保存文档（空路径）也只提示一次（不会反复弹）', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('', '100:10')).toBe(true)
    expect(dedup.consume('', '100:10')).toBe(false)
  })

  it('多份未保存文档按内容指纹区分，互不抑制', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('', '100:10')).toBe(true)
    expect(dedup.consume('', '200:20')).toBe(true)
    // 指纹相同的另一份（极端同尺寸）会被视为同一份，属于可接受的取舍
    expect(dedup.consume('', '200:20')).toBe(false)
  })

  it('reset() 后重新提示', () => {
    const dedup = createOversizedNoticeDedup()
    expect(dedup.consume('/a.md')).toBe(true)
    dedup.reset()
    expect(dedup.consume('/a.md')).toBe(true)
  })
})
