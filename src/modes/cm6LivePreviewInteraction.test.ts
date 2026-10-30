// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { Cm6Editor } from './cm6Editor'
import { createCm6LivePreview } from './cm6LivePreview'

let parent: HTMLDivElement
beforeEach(() => {
  document.body.innerHTML = ''
  parent = document.createElement('div')
  document.body.appendChild(parent)
})

function waitForWidgets(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 40))
}

function mockVisibleRange(editor: Cm6Editor): void {
  Object.defineProperty((editor as any).view, 'visibleRanges', {
    configurable: true,
    get: () => [{ from: 0, to: (editor as any).view.state.doc.length }],
  })
}

describe('cm6LivePreview interaction', () => {
  it('点击渲染块先落光标并恢复源码', async () => {
    const source = 'before\n\n$$\nx^2\n$$'
    const editor = new Cm6Editor({
      parent,
      document: source,
      onChange: () => {},
      extensions: createCm6LivePreview({
        render: element => { element.textContent = '渲染完成' },
      }),
    })
    mockVisibleRange(editor)
    await waitForWidgets()
    const widget = parent.querySelector('.cm6-rendered-block') as HTMLElement | null
    expect(widget?.textContent).toBe('渲染完成')
    widget?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await waitForWidgets()
    expect(parent.querySelector('.cm6-rendered-block')).toBeNull()
    expect((editor as any).view.state.selection.main.anchor).toBe(source.indexOf('$$'))
    editor.destroy()
  })

  it('异步渲染失败时显示完整源码', async () => {
    const editor = new Cm6Editor({
      parent,
      document: 'before\n\n```mermaid\nA-->B\n```',
      onChange: () => {},
      extensions: createCm6LivePreview({
        render: async () => { throw new Error('invalid diagram') },
      }),
    })
    mockVisibleRange(editor)
    await waitForWidgets()
    expect(parent.querySelector('.cm6-rendered-block')?.textContent).toBe('A-->B')
    editor.destroy()
  })
})
