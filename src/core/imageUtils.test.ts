// @vitest-environment jsdom
// 测试 imageUtils:extIsImage + fileToDataUrl
// 关注点:
// 1) extIsImage: 常见扩展名 png/jpg/jpeg/gif/svg/webp/bmp/avif 识别
// 2) extIsImage: 大小写不敏感
// 3) extIsImage: 非图片扩展名返回 false
// 4) fileToDataUrl: File 转换为 data URL 格式

import { describe, it, expect } from 'vitest'
import { extIsImage, fileToDataUrl } from './imageUtils'

describe('extIsImage', () => {
  it('returns true for common image extensions', () => {
    expect(extIsImage('a.png')).toBe(true)
    expect(extIsImage('a.jpg')).toBe(true)
    expect(extIsImage('a.jpeg')).toBe(true)
    expect(extIsImage('a.gif')).toBe(true)
    expect(extIsImage('a.svg')).toBe(true)
    expect(extIsImage('a.webp')).toBe(true)
    expect(extIsImage('a.bmp')).toBe(true)
    expect(extIsImage('a.avif')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(extIsImage('a.PNG')).toBe(true)
    expect(extIsImage('a.JPG')).toBe(true)
    expect(extIsImage('a.JPEG')).toBe(true)
    expect(extIsImage('a.Svg')).toBe(true)
  })

  it('returns false for non-image extensions', () => {
    expect(extIsImage('a.txt')).toBe(false)
    expect(extIsImage('a.md')).toBe(false)
    expect(extIsImage('a.pdf')).toBe(false)
    expect(extIsImage('a')).toBe(false)
    expect(extIsImage('')).toBe(false)
  })

  it('handles paths with directories', () => {
    expect(extIsImage('path/to/file.png')).toBe(true)
    expect(extIsImage('a.b.txt')).toBe(false)
  })
})

describe('fileToDataUrl', () => {
  it('converts a File to a data URL', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })
    const url = await fileToDataUrl(file)
    expect(url).toMatch(/^data:text\/plain;base64,/)
  })

  it('produces different output for different content', async () => {
    const a = new File(['AAA'], 'a.txt', { type: 'text/plain' })
    const b = new File(['BBB'], 'b.txt', { type: 'text/plain' })
    const ua = await fileToDataUrl(a)
    const ub = await fileToDataUrl(b)
    expect(ua).not.toBe(ub)
  })

  it('returns non-empty string for image file', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    const url = await fileToDataUrl(file)
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })
})
