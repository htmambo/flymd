// @vitest-environment jsdom
// 测试 previewAnchor 工具:6 个 preview 锚点解析函数
// 关注点:
// 1) normalizePreviewAnchorText: URI 解码 + 失败兜底
// 2) makePreviewHeadingId: 文本 → id,中文/特殊字符/空 fallback
// 3) ensurePreviewHeadingIds: 为缺失 id 的 heading 补 id,冲突时加序号
// 4) isPreviewHashLink: #hash 格式
// 5) findPreviewAnchorTarget: 通过 id 找 + fallback 文本匹配
// 6) scrollPreviewAnchorIntoView: 找目标并 scrollIntoView

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizePreviewAnchorText,
  makePreviewHeadingId,
  ensurePreviewHeadingIds,
  isPreviewHashLink,
  findPreviewAnchorTarget,
  scrollPreviewAnchorIntoView,
} from './previewAnchor'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('normalizePreviewAnchorText', () => {
  it('URI-decodes valid encoded strings', () => {
    expect(normalizePreviewAnchorText('hello%20world')).toBe('hello world')
    expect(normalizePreviewAnchorText('中文')).toBe('中文')
  })

  it('returns input on decode failure', () => {
    expect(normalizePreviewAnchorText('%')).toBe('%')
    expect(normalizePreviewAnchorText('%E0%A4')).toBe('%E0%A4')
  })

  it('handles empty/null-ish input', () => {
    expect(normalizePreviewAnchorText('')).toBe('')
  })
})

describe('makePreviewHeadingId', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(makePreviewHeadingId('Hello World', 0)).toBe('hello-world')
  })

  it('keeps Chinese characters', () => {
    expect(makePreviewHeadingId('标题', 0)).toBe('标题')
  })

  it('removes special characters but keeps letters/digits/dash', () => {
    expect(makePreviewHeadingId('A!B@C#', 0)).toBe('abc')
    expect(makePreviewHeadingId('a-b-c', 0)).toBe('a-b-c')
  })

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    const id = makePreviewHeadingId(long, 0)
    expect(id.length).toBe(64)
  })

  it('returns toc-${index} for empty input', () => {
    expect(makePreviewHeadingId('', 3)).toBe('toc-3')
    expect(makePreviewHeadingId('   ', 5)).toBe('toc-5')
  })
})

describe('ensurePreviewHeadingIds', () => {
  it('assigns id to h1-h6 without id', () => {
    const root = document.createElement('div')
    const h1 = document.createElement('h1')
    h1.textContent = 'Title'
    const h2 = document.createElement('h2')
    h2.textContent = 'Sub'
    root.appendChild(h1)
    root.appendChild(h2)
    ensurePreviewHeadingIds(root)
    expect(h1.id).toBe('title')
    expect(h2.id).toBe('sub')
  })

  it('preserves existing id', () => {
    const root = document.createElement('div')
    const h1 = document.createElement('h1')
    h1.textContent = 'Title'
    h1.setAttribute('id', 'custom-id')
    root.appendChild(h1)
    ensurePreviewHeadingIds(root)
    expect(h1.id).toBe('custom-id')
  })

  it('appends numeric suffix for duplicate generated ids', () => {
    const root = document.createElement('div')
    const h1 = document.createElement('h1')
    h1.textContent = 'Same'
    const h2 = document.createElement('h1')
    h2.textContent = 'Same'
    const h3 = document.createElement('h1')
    h3.textContent = 'Same'
    root.appendChild(h1)
    root.appendChild(h2)
    root.appendChild(h3)
    ensurePreviewHeadingIds(root)
    expect(h1.id).toBe('same')
    expect(h2.id).toBe('same-1')
    expect(h3.id).toBe('same-2')
  })
})

describe('isPreviewHashLink', () => {
  it('returns true for #hash links', () => {
    expect(isPreviewHashLink('#section')).toBe(true)
    expect(isPreviewHashLink('#a')).toBe(true)
  })

  it('returns false for non-hash links', () => {
    expect(isPreviewHashLink('http://example.com')).toBe(false)
    expect(isPreviewHashLink('page.md')).toBe(false)
    expect(isPreviewHashLink('##double')).toBe(false)
    expect(isPreviewHashLink('')).toBe(false)
  })
})

describe('findPreviewAnchorTarget', () => {
  it('returns null for non-hash input', () => {
    expect(findPreviewAnchorTarget('not-hash', null)).toBeNull()
  })

  it('finds heading by id', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    const h1 = document.createElement('h1')
    h1.id = 'existing'
    h1.textContent = 'Existing'
    body.appendChild(h1)
    preview.appendChild(body)
    document.body.appendChild(preview)
    expect(findPreviewAnchorTarget('#existing', null)).toBe(h1)
  })

  it('falls back to text match when id not found', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    const h1 = document.createElement('h1')
    h1.textContent = 'Section Name'
    body.appendChild(h1)
    preview.appendChild(body)
    document.body.appendChild(preview)
    const target = findPreviewAnchorTarget('#section-name', null)
    expect(target).toBe(h1)
    expect(h1.id).toBe('section-name')
  })

  it('uses previewEl fallback when no .preview-body in document', () => {
    const previewEl = document.createElement('div')
    const h1 = document.createElement('h1')
    h1.id = 'fallback'
    previewEl.appendChild(h1)
    document.body.appendChild(previewEl)
    const target = findPreviewAnchorTarget('#fallback', previewEl)
    expect(target).toBe(h1)
  })
})

describe('scrollPreviewAnchorIntoView', () => {
  it('returns false when target not found', () => {
    expect(scrollPreviewAnchorIntoView('#missing', null)).toBe(false)
  })

  it('returns true and calls scrollIntoView when found', () => {
    const preview = document.createElement('div')
    preview.className = 'preview'
    const body = document.createElement('div')
    body.className = 'preview-body'
    const h1 = document.createElement('h1')
    h1.id = 'h1'
    h1.textContent = 'X'
    body.appendChild(h1)
    preview.appendChild(body)
    document.body.appendChild(preview)
    const scrollSpy = vi.fn()
    h1.scrollIntoView = scrollSpy
    expect(scrollPreviewAnchorIntoView('#h1', null)).toBe(true)
    expect(scrollSpy).toHaveBeenCalled()
  })
})
