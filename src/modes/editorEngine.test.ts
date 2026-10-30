import { describe, expect, it } from 'vitest'
import { getLargeDocEnginePreference, resolveEditorEngine } from './editorEngine'
import { WYSIWYG_AUTO_ENABLE_MAX_BYTES, WYSIWYG_AUTO_ENABLE_MAX_LINES } from '../core/largeDoc'

describe('editorEngine', () => {
  it('auto 只在达到既有大文档阈值时选择 CM6', () => {
    expect(resolveEditorEngine({ bytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES - 1, lines: 1 }, 'auto')).toBe('milkdown')
    expect(resolveEditorEngine({ bytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES, lines: 1 }, 'auto')).toBe('cm6')
    expect(resolveEditorEngine({ bytes: 1, lines: WYSIWYG_AUTO_ENABLE_MAX_LINES }, 'auto')).toBe('cm6')
  })

  it('显式引擎覆盖文档尺寸', () => {
    expect(resolveEditorEngine({ bytes: 1, lines: 1 }, 'cm6')).toBe('cm6')
    expect(resolveEditorEngine({ bytes: WYSIWYG_AUTO_ENABLE_MAX_BYTES, lines: 1 }, 'milkdown')).toBe('milkdown')
  })

  it('持久化标志读取与未知值回退', () => {
    const getItem = (key: string) => key === 'flymd:largeDocEngine' ? 'cm6' : null
    expect(getLargeDocEnginePreference({ getItem })).toBe('cm6')
    expect(getLargeDocEnginePreference({ getItem: () => 'invalid' })).toBe('auto')
    expect(getLargeDocEnginePreference({ getItem: () => { throw new Error('denied') } })).toBe('auto')
  })
})
