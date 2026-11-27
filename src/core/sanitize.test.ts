// @vitest-environment jsdom
// 预览消毒默认值与配置的回归测试：
// 1) 默认必须开启（发行版关闭曾导致 html:true 预览直接执行事件属性）
// 2) 配置必须保留 KaTeX/Mermaid/任务列表占位结构，同时剥离事件属性与高危标签
import { describe, it, expect, afterEach } from 'vitest'
import DOMPurify from 'dompurify'
import { sanitizePreviewWith, shouldSanitizePreview } from './sanitize'

const sanitize = (html: string) => sanitizePreviewWith(DOMPurify, html)

afterEach(() => {
  try { localStorage.removeItem('flymd:sanitizePreview') } catch {}
})

describe('shouldSanitizePreview', () => {
  it('默认开启', () => {
    expect(shouldSanitizePreview()).toBe(true)
  })

  it('localStorage 显式关闭时返回 false', () => {
    localStorage.setItem('flymd:sanitizePreview', '0')
    expect(shouldSanitizePreview()).toBe(false)
  })

  it('localStorage 显式开启时返回 true', () => {
    localStorage.setItem('flymd:sanitizePreview', '1')
    expect(shouldSanitizePreview()).toBe(true)
  })

  it('无法识别的值回落到默认开启', () => {
    localStorage.setItem('flymd:sanitizePreview', 'maybe')
    expect(shouldSanitizePreview()).toBe(true)
  })
})

describe('PREVIEW_SANITIZE_CONFIG', () => {
  it('剥离事件属性与 javascript: URL', () => {
    const out = sanitize('<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">x</a>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('javascript:')
  })

  it('保留 Mermaid 占位 <pre class="mermaid">', () => {
    const out = sanitize('<pre class="mermaid">graph TD;A--&gt;B</pre>')
    expect(out).toContain('<pre class="mermaid">')
    expect(out).toContain('graph TD;A--&gt;B')
  })

  it('保留 KaTeX 占位符的 data-math 属性', () => {
    const out = sanitize('<span class="katex-placeholder" data-math="x^2"></span>')
    expect(out).toContain('data-math="x^2"')
    expect(out).toContain('class="katex-placeholder"')
  })

  it('保留任务列表复选框', () => {
    const out = sanitize('<input type="checkbox" class="task-list-item-checkbox" disabled checked>')
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('task-list-item-checkbox')
  })

  it('移除 iframe/object/embed/form', () => {
    const out = sanitize('<iframe src="https://example.test"></iframe><object data="x"></object><embed src="x"><form action="https://example.test"></form>')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<embed')
    expect(out).not.toContain('<form')
  })

  it('保留外链 target 属性并自动补 rel', () => {
    const out = sanitize('<a href="https://example.test" target="_blank">x</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('剥离 style 属性（防全屏伪 UI 覆盖层）', () => {
    const out = sanitize('<div style="position:fixed;inset:0;z-index:99999;background:url(https://example.test/x)">x</div>')
    expect(out).not.toContain('position:fixed')
    expect(out).not.toContain('style=')
  })

  it('移除非 checkbox 的 input（防伪装登录框）', () => {
    const out = sanitize('<input type="password" placeholder="密码"><input type="checkbox" class="task">')
    expect(out).not.toContain('type="password"')
    expect(out).toContain('type="checkbox"')
  })

  it('移除 dialog/button/select/textarea 等伪 UI 节点', () => {
    const out = sanitize('<dialog open>x</dialog><button>继续</button><select><option>a</option></select><textarea>x</textarea>')
    expect(out).not.toContain('<dialog')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('<select')
    expect(out).not.toContain('<textarea')
  })

  it('保留 callout 图标 SVG，但剥离脚本与外部 image', () => {
    const out = sanitize('<div class="callout-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6"/><script>alert(1)</script><image href="https://example.test/x"/></svg></div>')
    expect(out).toContain('<svg')
    expect(out).toContain('<path')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<image')
  })

  it('折叠状态靠 class 表达（内联 style 仍被剥离）', () => {
    const out = sanitize('<div class="callout folded" data-callout="note"><div class="callout-content" style="display:none">x</div></div>')
    expect(out).toContain('class="callout folded"')
    expect(out).toContain('data-callout="note"')
    expect(out).not.toContain('display:none')
  })
})
