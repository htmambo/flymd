// Word 文档预览：纯函数逻辑单测（后缀识别 / 一次性提示门）
import { describe, expect, it } from 'vitest'
import { createOnceGate, getOfficeExt, OFFICE_EXTS, OFFICE_PREVIEW_OWNER_ID } from './officePreview'

describe('getOfficeExt', () => {
  it('识别 doc/docx（大小写不敏感）', () => {
    expect(getOfficeExt('/tmp/报告.docx')).toBe('docx')
    expect(getOfficeExt('/tmp/报告.DOCX')).toBe('docx')
    expect(getOfficeExt('C:\\docs\\a.doc')).toBe('doc')
    expect(getOfficeExt('/tmp/a.DOC')).toBe('doc')
  })

  it('非 Word 后缀返回空串', () => {
    expect(getOfficeExt('/tmp/a.md')).toBe('')
    expect(getOfficeExt('/tmp/a.pdf')).toBe('')
    expect(getOfficeExt('/tmp/a.docx.bak')).toBe('')
    expect(getOfficeExt('/tmp/docx')).toBe('')
    expect(getOfficeExt('')).toBe('')
    expect(getOfficeExt(null)).toBe('')
  })
})

describe('createOnceGate', () => {
  it('同一会话只放一次', () => {
    const gate = createOnceGate()
    expect(gate()).toBe(true)
    expect(gate()).toBe(false)
    expect(gate()).toBe(false)
  })

  it('不同门互不影响', () => {
    const a = createOnceGate()
    const b = createOnceGate()
    expect(a()).toBe(true)
    expect(b()).toBe(true)
    expect(a()).toBe(false)
  })
})

describe('isOfficePreviewCachePath', () => {
  it('普通路径（含同名文件/深路径）不误伤', async () => {
    const { isOfficePreviewCachePath } = await import('./officePreview')
    expect(isOfficePreviewCachePath('/Volumes/Workarea/我的文档/笔记/资料/简历.docx')).toBe(false)
    expect(isOfficePreviewCachePath('/home/user/notes/a.md')).toBe(false)
    expect(isOfficePreviewCachePath('/x/flymd-office-preview-notes/a.md')).toBe(false) // 非精确分段
    expect(isOfficePreviewCachePath('')).toBe(false)
    expect(isOfficePreviewCachePath(null)).toBe(false)
  })

  it('命中 macOS/Linux 缓存路径（$TMPDIR 差异无关）', async () => {
    const { isOfficePreviewCachePath } = await import('./officePreview')
    expect(isOfficePreviewCachePath('/var/folders/xx/T/flymd-office-preview/24f75e00d60925a2/简历.md')).toBe(true)
    expect(isOfficePreviewCachePath('/tmp/flymd-office-preview/a4ff8fc83245ac4b/报告.pdf')).toBe(true)
    expect(isOfficePreviewCachePath('/tmp/flymd-office-preview')).toBe(true) // 缓存根本身
  })

  it('命中 Windows 反斜杠缓存路径', async () => {
    const { isOfficePreviewCachePath } = await import('./officePreview')
    expect(isOfficePreviewCachePath('C:\\Users\\u\\AppData\\Local\\Temp\\flymd-office-preview\\abc123\\a.md')).toBe(true)
  })
})

describe('normalizeOfficePreviewTabState', () => {
  it('Office 预览路径：强制 mode=preview、关闭所见，返回 true', async () => {
    const { normalizeOfficePreviewTabState } = await import('./officePreview')
    const s = { mode: 'edit', wysiwygEnabled: true }
    expect(normalizeOfficePreviewTabState('/tmp/flymd-office-preview/abc/简历.md', s)).toBe(true)
    expect(s.mode).toBe('preview')
    expect(s.wysiwygEnabled).toBe(false)
  })

  it('已是阅读态时返回 false（无副作用）', async () => {
    const { normalizeOfficePreviewTabState } = await import('./officePreview')
    const s = { mode: 'preview', wysiwygEnabled: false }
    expect(normalizeOfficePreviewTabState('/tmp/flymd-office-preview/abc/简历.md', s)).toBe(false)
    expect(s.mode).toBe('preview')
  })

  it('普通路径与空路径不动状态对象', async () => {
    const { normalizeOfficePreviewTabState } = await import('./officePreview')
    const s = { mode: 'edit', wysiwygEnabled: true }
    expect(normalizeOfficePreviewTabState('/home/user/notes/a.md', s)).toBe(false)
    expect(normalizeOfficePreviewTabState(null, s)).toBe(false)
    expect(s.mode).toBe('edit')
    expect(s.wysiwygEnabled).toBe(true)
  })
})

describe('内置常量', () => {
  it('覆盖 doc/docx 两个后缀', () => {
    expect(OFFICE_EXTS).toContain('doc')
    expect(OFFICE_EXTS).toContain('docx')
  })

  it('OWNER_ID 非空且带 builtin 前缀（ASP 注册归属）', () => {
    expect(OFFICE_PREVIEW_OWNER_ID.length).toBeGreaterThan(0)
    expect(OFFICE_PREVIEW_OWNER_ID.startsWith('builtin-')).toBe(true)
  })
})
