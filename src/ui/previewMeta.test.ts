// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  injectPreviewMeta,
  setPreviewMetaVisible,
  isPreviewMetaVisible,
} from './previewMeta'

beforeEach(() => {
  try { localStorage.removeItem('flymd:preview:showMeta') } catch {}
  // 重置模块内初始态(默认 true)
  setPreviewMetaVisible(true)
  document.body.innerHTML = ''
})

function makeContainer(): HTMLDivElement {
  const d = document.createElement('div')
  document.body.appendChild(d)
  return d
}

describe('injectPreviewMeta', () => {
  it('injects nothing when meta is null/undefined', () => {
    const c = makeContainer()
    injectPreviewMeta(c, null)
    expect(c.querySelector('.preview-meta')).toBeNull()

    injectPreviewMeta(c, undefined as any)
    expect(c.querySelector('.preview-meta')).toBeNull()
  })

  it('renders title, tags, status from meta object', () => {
    const c = makeContainer()
    injectPreviewMeta(c, {
      title: 'Hello',
      tags: ['t1', 't2'],
      status: 'published',
    }, { currentFilePath: null })
    const root = c.querySelector('.preview-meta') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.classList.contains('collapsed')).toBe(false)
    expect(root.querySelector('.preview-meta-title')?.textContent).toBe('Hello')
    // tags row
    const tagsRow = Array.from(root.querySelectorAll('.preview-meta-row'))
      .find(r => r.querySelector('.preview-meta-label')?.textContent === '标签')
    expect(tagsRow).toBeTruthy()
    const chips = tagsRow!.querySelectorAll('.preview-meta-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].textContent).toBe('t1')
    expect(chips[1].textContent).toBe('t2')
  })

  it('falls back to filename when title missing', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { tags: ['a'] }, { currentFilePath: '/docs/sub/note.md' })
    expect(c.querySelector('.preview-meta-title')?.textContent).toBe('note.md')
  })

  it('respects currentFilePath with backslashes (windows path)', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { tags: ['a'] }, { currentFilePath: 'C:\\docs\\note.md' })
    expect(c.querySelector('.preview-meta-title')?.textContent).toBe('note.md')
  })

  it('handles categories vs category (array takes priority)', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { category: 'B', categories: ['A1', 'A2'] })
    const row = Array.from(c.querySelectorAll('.preview-meta-row'))
      .find(r => r.querySelector('.preview-meta-label')?.textContent === '分类')
    const chips = row!.querySelectorAll('.preview-meta-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].textContent).toBe('A1')
  })

  it('handles draft boolean mapped to status=draft', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { draft: true })
    const statusRow = Array.from(c.querySelectorAll('.preview-meta-row'))
      .find(r => r.querySelector('.preview-meta-label')?.textContent === '草稿')
    expect(statusRow).toBeTruthy()
    expect(statusRow!.querySelector('.preview-meta-value')?.textContent).toBe('draft')
  })

  it('toggles collapsed class based on previewMetaVisible', () => {
    setPreviewMetaVisible(false)
    const c = makeContainer()
    injectPreviewMeta(c, { title: 'x' })
    expect(c.querySelector('.preview-meta')?.classList.contains('collapsed')).toBe(true)
    expect(c.querySelector('.preview-meta-toggle')?.textContent).toBe('显示元数据')
  })

  it('toggle button flips visible state and updates localStorage', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { title: 'x' })
    const btn = c.querySelector('.preview-meta-toggle') as HTMLButtonElement
    expect(btn.textContent).toBe('隐藏元数据')
    btn.click()
    expect(isPreviewMetaVisible()).toBe(false)
    expect(c.querySelector('.preview-meta')?.classList.contains('collapsed')).toBe(true)
    expect(localStorage.getItem('flymd:preview:showMeta')).toBe('0')
    btn.click()
    expect(isPreviewMetaVisible()).toBe(true)
    expect(localStorage.getItem('flymd:preview:showMeta')).toBe('1')
  })

  it('uses custom metadataLabels when provided', () => {
    const c = makeContainer()
    injectPreviewMeta(c, { tags: ['x'] }, {
      metadataLabels: { tags: '🏷️' },
    })
    const row = Array.from(c.querySelectorAll('.preview-meta-row'))
      .find(r => r.querySelector('.preview-meta-label')?.textContent === '🏷️')
    expect(row).toBeTruthy()
  })

  it('skips handled keys when iterating unknown fields', () => {
    const c = makeContainer()
    injectPreviewMeta(c, {
      title: 't',
      author: 'Alice',
      description: 'd',
      tags: ['x'],
    })
    // body should contain author and description rows, but no extra 'title' or 'tags' duplicates
    const labels = Array.from(c.querySelectorAll('.preview-meta-label')).map(el => el.textContent)
    expect(labels).toContain('作者')
    expect(labels).toContain('描述')
    expect(labels).toContain('标签')
  })
})
