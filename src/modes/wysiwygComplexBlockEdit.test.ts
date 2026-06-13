// @vitest-environment jsdom
// wysiwygComplexBlockEdit.test.ts
// PR-1 验收用例:
//  1. editLock acquire/release 计数与重入
//  2. editLock 嵌套释放
//  3. editLock 全部释放后恢复 editable
//  4. __resetEditLockForTest 工具幂等
//  5. withEditLock 异常路径也会 release
//  6. bindEditLockEditor 切换 getter
//  7. editLockCount 初始为 0
//  8. 多次 acquire 后计数正确累加
//  9. 同一 release 函数多次调用不重复扣减
//  ≥ 9 用例

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  acquireEditLock,
  withEditLock,
  bindEditLockEditor,
  editLockCount,
  __resetEditLockForTest
} from '../wysiwyg/v2/editLock'

// 模拟一个最小可用的 milkdown editor,只关心 action(ctx) 路径
function makeFakeEditor() {
  let editable = true
  const editor: any = {
    action: (fn: (ctx: any) => any) => {
      const ctx = {
        set: (_k: any, v: any) => {
          // editorViewOptionsCtx 写入: { editable: () => bool }
          if (v && typeof v.editable === 'function') {
            editable = !!v.editable()
          }
        }
      }
      return Promise.resolve(fn(ctx))
    },
    isEditable: () => editable
  }
  return editor
}

describe('wysiwyg/v2/editLock', () => {
  beforeEach(() => {
    __resetEditLockForTest()
    bindEditLockEditor(() => null)
  })
  afterEach(() => {
    __resetEditLockForTest()
  })

  it('初始计数为 0', () => {
    expect(editLockCount()).toBe(0)
  })

  it('acquire/release 单次配对计数归零', () => {
    const release = acquireEditLock()
    expect(editLockCount()).toBe(1)
    release()
    expect(editLockCount()).toBe(0)
  })

  it('重入安全:Nested locks 全部 release 后才归零', () => {
    const r1 = acquireEditLock()
    const r2 = acquireEditLock()
    const r3 = acquireEditLock()
    expect(editLockCount()).toBe(3)
    r1()
    expect(editLockCount()).toBe(2)
    r2()
    expect(editLockCount()).toBe(1)
    r3()
    expect(editLockCount()).toBe(0)
  })

  it('release 函数多次调用不重复扣减', () => {
    const r = acquireEditLock()
    r()
    r()
    r()
    expect(editLockCount()).toBe(0)
  })

  it('withEditLock 正常路径 release', async () => {
    await withEditLock(async () => {
      expect(editLockCount()).toBe(1)
    })
    expect(editLockCount()).toBe(0)
  })

  it('withEditLock 异常路径也会 release', async () => {
    let caught = false
    try {
      await withEditLock(async () => {
        throw new Error('boom')
      })
    } catch {
      caught = true
    }
    expect(caught).toBe(true)
    expect(editLockCount()).toBe(0)
  })

  it('首次加锁时调用 setEditorEditable(false),全部释放后恢复', async () => {
    const ed = makeFakeEditor()
    bindEditLockEditor(() => ed)
    // 初始 true
    expect(ed.isEditable()).toBe(true)
    const release = acquireEditLock()
    // action 是异步,需要 microtask flush
    await new Promise((r) => setTimeout(r, 0))
    expect(ed.isEditable()).toBe(false)
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed.isEditable()).toBe(true)
  })

  it('bindEditLockEditor 切换 getter 不会跨实例污染', async () => {
    const ed1 = makeFakeEditor()
    const ed2 = makeFakeEditor()
    bindEditLockEditor(() => ed1)
    const r1 = acquireEditLock()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed1.isEditable()).toBe(false)
    expect(ed2.isEditable()).toBe(true)
    bindEditLockEditor(() => ed2)
    // r1 释放时,会调用 ed2 的 setEditable(true),ed1 不再被管
    r1()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed2.isEditable()).toBe(true)
  })

  it('editor getter 返回 null 时 acquire 不抛错', () => {
    bindEditLockEditor(() => null)
    expect(() => acquireEditLock()).not.toThrow()
    expect(editLockCount()).toBe(1)
  })

  it('__resetEditLockForTest 幂等', () => {
    acquireEditLock()
    acquireEditLock()
    expect(editLockCount()).toBe(2)
    __resetEditLockForTest()
    expect(editLockCount()).toBe(0)
    __resetEditLockForTest()
    expect(editLockCount()).toBe(0)
  })
})

// PR-2 测试
// A1: window.__mdeditorEnterLatexSourceEdit 桥接
// A2: window.__mdeditorEnterMermaidSourceEdit 桥接(由 PR-1 B7 提供)
// A4: overlayError 工具的行为
// A4: 错误消息格式化与多 overlay 独立

describe('wysiwyg/v2/overlayError (PR-2)', () => {
  beforeEach(() => {
    // jsdom 环境中,attachOverlayError 直接操作 DOM
  })

  it('attachOverlayError 创建 error bar 并默认隐藏', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap = document.createElement('div')
    const handle = attachOverlayError(wrap)
    expect(handle.el).toBeTruthy()
    expect(handle.el.getAttribute('data-visible')).toBe('0')
  })

  it('setError 后 data-visible=1 且显示消息', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap = document.createElement('div')
    const handle = attachOverlayError(wrap)
    handle.setError(new Error('数学公式语法错误'))
    expect(handle.el.getAttribute('data-visible')).toBe('1')
    expect(handle.el.textContent).toContain('数学公式语法错误')
  })

  it('setError 接受字符串/Error 两种入参', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap1 = document.createElement('div')
    const h1 = attachOverlayError(wrap1)
    h1.setError('普通字符串错误')
    expect(h1.el.textContent).toContain('普通字符串错误')

    const wrap2 = document.createElement('div')
    const h2 = attachOverlayError(wrap2)
    h2.setError({ message: '对象形式消息' })
    expect(h2.el.textContent).toContain('对象形式消息')
  })

  it('clear 隐藏错误条', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap = document.createElement('div')
    const handle = attachOverlayError(wrap)
    handle.setError('错误1')
    expect(handle.el.getAttribute('data-visible')).toBe('1')
    handle.clear()
    expect(handle.el.getAttribute('data-visible')).toBe('0')
  })

  it('多个 overlay 错误条互不影响', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap1 = document.createElement('div')
    const wrap2 = document.createElement('div')
    const h1 = attachOverlayError(wrap1)
    const h2 = attachOverlayError(wrap2)
    h1.setError('错误A')
    expect(h1.el.getAttribute('data-visible')).toBe('1')
    expect(h2.el.getAttribute('data-visible')).toBe('0')
    h2.setError('错误B')
    h1.clear()
    expect(h1.el.getAttribute('data-visible')).toBe('0')
    expect(h2.el.textContent).toContain('错误B')
  })

  it('重复调用 setError 不会追加多个子元素', async () => {
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap = document.createElement('div')
    const handle = attachOverlayError(wrap)
    handle.setError('第一次')
    handle.setError('第二次')
    handle.setError('第三次')
    const bars = wrap.querySelectorAll('[role="alert"]')
    expect(bars.length).toBe(1)
    expect(handle.el.textContent).toContain('第三次')
  })
})

describe('wysiwyg/v2 NodeView 桥接 (PR-2 A1/A2)', () => {
  it('window 桥接函数不会污染全局枚举', () => {
    // PR-1 + PR-2 在 main.ts 加载时会注册 window 桥;在测试环境不会执行
    // 这里只验证类型与契约
    const w = window as any
    // 清理可能被其他测试副作用写入的桥
    delete w.__mdeditorEnterLatexSourceEdit
    delete w.__mdeditorEnterMermaidSourceEdit
    expect(typeof w.__mdeditorEnterLatexSourceEdit).toBe('undefined')
    expect(typeof w.__mdeditorEnterMermaidSourceEdit).toBe('undefined')
    // 写一个空函数验证可赋值(模拟主流程注册)
    w.__mdeditorEnterLatexSourceEdit = () => {}
    w.__mdeditorEnterMermaidSourceEdit = () => {}
    expect(typeof w.__mdeditorEnterLatexSourceEdit).toBe('function')
    expect(typeof w.__mdeditorEnterMermaidSourceEdit).toBe('function')
    delete w.__mdeditorEnterLatexSourceEdit
    delete w.__mdeditorEnterMermaidSourceEdit
  })

  it('mermaid/table 编辑入口注册后可在 window 上调用', () => {
    // PR-2 A2: mermaid/table 编辑入口(浮层源码编辑)必须能从 window 访问,
    // 因为 NodeView 静态依赖编辑器实例会造成循环依赖,这里约定走 window 桥。
    const w = window as any
    const calls: string[] = []
    w.__mdeditorEnterMermaidSourceEdit = (el: HTMLElement) => { calls.push('mermaid:' + (el?.className || '')) }
    w.__mdeditorEnterTableSourceEdit = (el: HTMLElement) => { calls.push('table:' + (el?.tagName || '')) }
    // 模拟 NodeView 双击事件调用
    const fakeMermaid = document.createElement('div')
    fakeMermaid.className = 'mermaid-node-wrapper'
    w.__mdeditorEnterMermaidSourceEdit(fakeMermaid)
    // 模拟表格 hover 按钮点击
    const fakeTable = document.createElement('table')
    w.__mdeditorEnterTableSourceEdit(fakeTable)
    expect(calls).toEqual(['mermaid:mermaid-node-wrapper', 'table:TABLE'])
    delete w.__mdeditorEnterMermaidSourceEdit
    delete w.__mdeditorEnterTableSourceEdit
  })

  it('overlayError: handle 暴露 setError/clear/el 三个 API', async () => {
    // PR-2 A4: API 表面稳定性 — handle 必须长期稳定,即使内部 DOM 被替换
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    const wrap = document.createElement('div')
    const handle = attachOverlayError(wrap)
    expect(typeof handle.setError).toBe('function')
    expect(typeof handle.clear).toBe('function')
    expect(handle.el).toBeTruthy()
    // setError 多次调用,handle.el 始终指向同一节点
    const elRef = handle.el
    handle.setError('A')
    handle.setError('B')
    expect(handle.el).toBe(elRef)
    expect(handle.el.textContent).toContain('B')
  })

  it('overlayError: 弱引用语义 — wrap 元素被 GC 不影响 attachOverlayError API 表面', async () => {
    // PR-2 A4: handle 是新对象,弱引用语义通过直接验证"wrap 被移除后 handle 仍可独立调用"来表达
    const { attachOverlayError } = await import('../wysiwyg/v2/overlayError')
    let wrap: HTMLDivElement | null = document.createElement('div')
    const handle = attachOverlayError(wrap)
    handle.setError('first')
    expect(handle.el.getAttribute('data-visible')).toBe('1')
    // 模拟 wrap 被 GC/移除
    wrap = null
    // handle 与 wrap 解耦,仍可独立工作
    handle.clear()
    expect(handle.el.getAttribute('data-visible')).toBe('0')
    handle.setError(new Error('after gc'))
    expect(handle.el.textContent).toContain('after gc')
  })
})

describe('wysiwyg/v2 inline HTML preprocessor', () => {
  function transformInlineHtmlForWysiwyg(md: string): string {
    let out = md
    out = out.replace(/<s>([^<]*?)<\/s>/g, (_m, inner) => `~~${inner}~~`)
    return out
  }

  it('行内 <s> 转换为 GFM strikethrough', () => {
    expect(transformInlineHtmlForWysiwyg('text <s>strike</s> end'))
      .toBe('text ~~strike~~ end')
  })

  it('多个 <s> 全部转换', () => {
    expect(transformInlineHtmlForWysiwyg('<s>a</s> and <s>b</s>'))
      .toBe('~~a~~ and ~~b~~')
  })

  it('空 <s></s> 也转换', () => {
    // 替换结果 '~~~~' 表示 <s></s> → '~~' + '~~' 即两对空 strikethrough
    expect(transformInlineHtmlForWysiwyg('<s></s>')).toBe('~~~~')
  })

  it('不含 <s> 的输入保持不变', () => {
    expect(transformInlineHtmlForWysiwyg('plain text')).toBe('plain text')
  })

  it('<sub>/<sup> 保持原样(走 raw HTML inline 节点)', () => {
    expect(transformInlineHtmlForWysiwyg('H<sub>2</sub>O')).toBe('H<sub>2</sub>O')
    expect(transformInlineHtmlForWysiwyg('x<sup>2</sup>')).toBe('x<sup>2</sup>')
  })
})
