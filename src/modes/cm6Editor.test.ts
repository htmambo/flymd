// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Cm6Editor, type Cm6Change } from './cm6Editor'

let parent: HTMLDivElement
beforeEach(() => {
  document.body.innerHTML = ''
  parent = document.createElement('div')
  document.body.appendChild(parent)
})

describe('Cm6Editor', () => {
  it('用户编辑在 update 返回前同步完整文本并保留选择', () => {
    const changes: Cm6Change[] = []
    const editor = new Cm6Editor({ parent, document: 'hello', onChange: change => changes.push(change) })
    editor.setSelection(5)
    ;(editor as any).view.dispatch({ changes: { from: 5, insert: ' world' }, selection: { anchor: 11 } })
    expect(editor.getDoc()).toBe('hello world')
    expect(changes[changes.length - 1]).toEqual({ text: 'hello world', external: false })
    expect(editor.getSelection().anchor).toBe(11)
    editor.destroy()
  })

  it('外部替换带来源标记且不进入用户撤销历史', () => {
    const changes: Cm6Change[] = []
    const editor = new Cm6Editor({ parent, document: 'before', onChange: change => changes.push(change) })
    editor.replaceDocument('after', { anchor: 2, head: 2 })
    expect(changes[changes.length - 1]).toEqual({ text: 'after', external: true })
    expect(editor.getSelection().anchor).toBe(2)
    expect(editor.getDoc()).toBe('after')
    editor.destroy()
  })

  it('CRLF、BOM 与 Unicode 在编辑后保持可往返', () => {
    const initial = '\ufeff第一行\r\n第二行 😀'
    const editor = new Cm6Editor({ parent, document: initial, onChange: () => {} })
    expect(editor.getDoc()).toBe(initial)
    editor.setSelection(initial.length)
    ;(editor as any).view.dispatch({ changes: { from: (editor as any).view.state.doc.length, insert: '\r\n第三行' } })
    expect(editor.getDoc()).toBe(`${initial}\r\n第三行`)
    editor.destroy()
  })

  it('撤销与重做使用 CM6 本地历史', () => {
    const editor = new Cm6Editor({ parent, document: 'a', onChange: () => {} })
    ;(editor as any).view.dispatch({ changes: { from: 1, insert: 'b' } })
    expect(editor.undo()).toBe(true)
    expect(editor.getDoc()).toBe('a')
    expect(editor.redo()).toBe(true)
    expect(editor.getDoc()).toBe('ab')
    editor.destroy()
  })

  it('一致 CRLF、CR 与 LF 的公开偏移逐项往返，混合行尾拒绝进入引擎', () => {
    for (const source of ['a\r\nb\r\n😀', 'a\rb\rc\r😀', 'a\nb\nc\n😀']) {
      const editor = new Cm6Editor({ parent, document: source, onChange: () => {} })
      for (let offset = 0; offset <= source.length; offset++) {
        if ((source[offset] === '\r' && source[offset + 1] === '\n') || (source[offset - 1] === '\r' && source[offset] === '\n')) continue
        editor.setSelection(offset)
        expect(editor.getSelection().anchor).toBe(offset)
      }
      expect(editor.getDoc()).toBe(source)
      editor.destroy()
    }
    expect(() => new Cm6Editor({ parent, document: 'a\r\nb\rc\n', onChange: () => {} })).toThrow('混合行尾')
  })

  it('所有两两混合行尾均拒绝，失败替换不改写旧文档', () => {
    const editor = new Cm6Editor({ parent, document: 'a\r\nb', onChange: () => {} })
    expect(() => editor.replaceDocument('a\r\nb\rc\n')).toThrow('混合行尾')
    expect(editor.getDoc()).toBe('a\r\nb')
    for (const source of ['a\r\nb\nc', 'a\rb\nc', 'a\rb\r\nc']) {
      expect(() => new Cm6Editor({ parent, document: source, onChange: () => {} })).toThrow('混合行尾')
    }
    editor.destroy()
  })

  it('偏移统一钳制，外部替换可切换一致行尾类型', () => {
    const source = 'a\r\nb'
    const editor = new Cm6Editor({ parent, document: source, onChange: () => {} })
    editor.setSelection(-10)
    expect(editor.getSelection().anchor).toBe(0)
    editor.setSelection(Number.NaN)
    expect(editor.getSelection().anchor).toBe(0)
    editor.setSelection(1.9)
    expect(editor.getSelection().anchor).toBe(1)
    editor.setSelection(999)
    expect(editor.getSelection().anchor).toBe(source.length)
    editor.setSelection(Number.POSITIVE_INFINITY)
    expect(editor.getSelection().anchor).toBe(source.length)
    editor.setSelection(Number.NEGATIVE_INFINITY)
    expect(editor.getSelection().anchor).toBe(0)
    editor.setSelection(-0.5)
    expect(Object.is(editor.getSelection().anchor, -0)).toBe(false)
    editor.replaceDocument('x\ny', { anchor: 3, head: 3 })
    expect(editor.getDoc()).toBe('x\ny')
    expect(editor.getSelection().anchor).toBe(3)
    editor.destroy()
  })

  it('销毁返回文本、选区和滚动快照', () => {
    const onChange = vi.fn()
    const editor = new Cm6Editor({ parent, document: 'abcdef', onChange })
    editor.setSelection(3, 5)
    editor.setScrollTop(120)
    const snapshot = editor.destroy()
    expect(snapshot).toEqual({ text: 'abcdef', anchor: 3, head: 5, scrollTop: 120 })
    expect(parent.childElementCount).toBe(0)
  })

  // 「源码行号」开关在大文件 CM6 视图必须真实生效：这是用户反馈的原始症状
  // （大文件所见模式用 CM6 渲染源码，但行号不跟随设置）。
  it('行号栏关闭时不创建 .cm-gutters，运行时切换即时增删', () => {
    const editor = new Cm6Editor({ parent, document: 'a\nb', onChange: () => {}, lineNumbers: false })
    expect(parent.querySelector('.cm-gutters')).toBeNull()
    editor.setLineNumbersEnabled(true)
    expect(parent.querySelector('.cm-gutters')).not.toBeNull()
    editor.setLineNumbersEnabled(false)
    expect(parent.querySelector('.cm-gutters')).toBeNull()
    editor.destroy()
  })

  it('行号栏开启时默认创建 .cm-gutters，切换不影响文档与选区', () => {
    const editor = new Cm6Editor({ parent, document: 'a\nb', onChange: () => {}, lineNumbers: true })
    expect(parent.querySelector('.cm-gutters')).not.toBeNull()
    editor.setSelection(2)
    editor.setLineNumbersEnabled(false)
    expect(parent.querySelector('.cm-gutters')).toBeNull()
    expect(editor.getDoc()).toBe('a\nb')
    expect(editor.getSelection().anchor).toBe(2)
    editor.destroy()
  })

  it('未显式指定时按「源码行号」偏好初始化', () => {
    const editor = new Cm6Editor({ parent, document: 'a', onChange: () => {} })
    // 默认偏好为开启
    expect(parent.querySelector('.cm-gutters')).not.toBeNull()
    editor.destroy()
  })
})
