// @vitest-environment jsdom
// 测试 katexCriticalStyle 工厂:idempotent / 注入 / 多实例 / catch 包裹
// 关注点:
// 1) 首次 ensure() 注入 style 标签
// 2) 第二次 ensure() 早返(同一 id 已存在)
// 3) 多次实例化用不同 id 可共存
// 4) id 默认常量与 main.ts 沿用一致

import { describe, it, expect, beforeEach } from 'vitest'
import { createKatexCriticalStyle, KATEX_CRITICAL_STYLE_ID } from './katexCriticalStyle'

beforeEach(() => {
  document.head.innerHTML = ''
})

describe('createKatexCriticalStyle', () => {
  it('exports default id matching main.ts usage', () => {
    expect(KATEX_CRITICAL_STYLE_ID).toBe('flymd-katex-critical-style')
  })

  it('injects style tag on first ensure()', () => {
    const api = createKatexCriticalStyle({ id: 'test-katex' })
    api.ensure()
    const el = document.getElementById('test-katex')
    expect(el).not.toBeNull()
    expect(el!.tagName).toBe('STYLE')
    expect(el!.textContent).toContain('.preview-body .katex svg')
  })

  it('preserves the fragile .brace-center width: 50% rule', () => {
    const api = createKatexCriticalStyle({ id: 'test-katex' })
    api.ensure()
    const el = document.getElementById('test-katex') as HTMLStyleElement | null
    expect(el).not.toBeNull()
    expect(el!.textContent).toContain('.brace-center { left: 25%; overflow: hidden; position: absolute; width: 50%; }')
  })

  it('is idempotent: second ensure() does not append a duplicate', () => {
    const api = createKatexCriticalStyle({ id: 'test-katex' })
    api.ensure()
    api.ensure()
    const matches = document.querySelectorAll('#test-katex')
    expect(matches.length).toBe(1)
  })

  it('multiple instances with different ids coexist', () => {
    const a = createKatexCriticalStyle({ id: 'a-style' })
    const b = createKatexCriticalStyle({ id: 'b-style' })
    a.ensure()
    b.ensure()
    expect(document.getElementById('a-style')).not.toBeNull()
    expect(document.getElementById('b-style')).not.toBeNull()
  })
})
