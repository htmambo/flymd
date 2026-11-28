import { describe, it, expect } from 'vitest'
import {
  isAbsoluteNonLocalHref,
  isExternalWebUrl,
  normalizeExternalWebUrl,
} from './externalLink'

describe('normalizeExternalWebUrl', () => {
  it('接受 http/https/mailto/tel', () => {
    expect(normalizeExternalWebUrl('https://example.test/a')).toBe('https://example.test/a')
    expect(normalizeExternalWebUrl('http://example.test')).toBe('http://example.test')
    expect(normalizeExternalWebUrl('HTTPS://EXAMPLE.TEST')).toBe('HTTPS://EXAMPLE.TEST')
    expect(normalizeExternalWebUrl('mailto:a@example.test')).toBe('mailto:a@example.test')
    expect(normalizeExternalWebUrl('tel:+10000000000')).toBe('tel:+10000000000')
  })

  it('协议相对地址规范化为 https', () => {
    expect(normalizeExternalWebUrl('//evil.example/a')).toBe('https://evil.example/a')
    expect(isExternalWebUrl('//evil.example/a')).toBe(true)
  })

  it('拒绝相对路径、锚点、空值与其它 scheme', () => {
    expect(normalizeExternalWebUrl('')).toBeNull()
    expect(normalizeExternalWebUrl('#section')).toBeNull()
    expect(normalizeExternalWebUrl('./other.md')).toBeNull()
    expect(normalizeExternalWebUrl('../img/a.png')).toBeNull()
    expect(normalizeExternalWebUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeExternalWebUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeExternalWebUrl('ftp://example.test/a')).toBeNull()
  })
})

describe('isAbsoluteNonLocalHref', () => {
  it('识别需要阻止 WebView 导航的绝对/协议相对地址', () => {
    expect(isAbsoluteNonLocalHref('//evil.example/a')).toBe(true)
    expect(isAbsoluteNonLocalHref('ftp://evil.example/a')).toBe(true)
    expect(isAbsoluteNonLocalHref('javascript:alert(1)')).toBe(true)
    expect(isAbsoluteNonLocalHref('file:///etc/passwd')).toBe(true)
    expect(isAbsoluteNonLocalHref('custom-scheme:payload')).toBe(true)
  })

  it('不把锚点与相对路径当绝对地址', () => {
    expect(isAbsoluteNonLocalHref('')).toBe(false)
    expect(isAbsoluteNonLocalHref('#section')).toBe(false)
    expect(isAbsoluteNonLocalHref('./other.md')).toBe(false)
    expect(isAbsoluteNonLocalHref('images/a.png')).toBe(false)
  })
})
