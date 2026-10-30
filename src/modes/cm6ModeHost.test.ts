// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Cm6ModeHost } from './cm6ModeHost'

let container: HTMLDivElement
let textarea: HTMLTextAreaElement

beforeEach(() => {
  document.body.innerHTML = ''
  container = document.createElement('div')
  textarea = document.createElement('textarea')
  document.body.append(container, textarea)
})

describe('Cm6ModeHost', () => {
  it('用户编辑同步到 textarea 并复用现有 input 副作用', async () => {
    textarea.value = 'before'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    const onInput = vi.fn()
    textarea.addEventListener('input', onInput)
    ;(host as any).engine.view.dispatch({ changes: { from: 6, insert: ' after' } })
    expect(textarea.value).toBe('before after')
    expect(onInput).toHaveBeenCalledTimes(1)
    host.destroy()
  })

  it('外部写入不派发 input，销毁保留文本与选区', async () => {
    textarea.value = 'old'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    const onInput = vi.fn()
    textarea.addEventListener('input', onInput)
    textarea.value = 'external'
    textarea.selectionStart = textarea.selectionEnd = 3
    host.syncFromTextarea()
    expect(host.getDoc()).toBe('external')
    expect(onInput).not.toHaveBeenCalled()
    const snapshot = host.destroy()
    expect(snapshot.text).toBe('external')
    expect(textarea.value).toBe('external')
    expect(textarea.selectionStart).toBe(3)
    expect(container.childElementCount).toBe(0)
  })

  it('相同文本不做全量替换', async () => {
    textarea.value = 'same'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    const replace = vi.spyOn((host as any).engine, 'replaceDocument')
    host.syncFromTextarea()
    expect(replace).not.toHaveBeenCalled()
    host.destroy()
  })

  it('组合输入期间延迟外部替换到 compositionend', async () => {
    textarea.value = 'old'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    Object.defineProperty((host as any).engine.view, 'composing', { configurable: true, value: true })
    textarea.value = 'external'
    host.syncFromTextarea()
    expect(host.getDoc()).toBe('old')
    Object.defineProperty((host as any).engine.view, 'composing', { configurable: true, value: false })
    host.root.dispatchEvent(new Event('compositionend'))
    expect(host.getDoc()).toBe('external')
    host.destroy()
  })

  it('销毁异常仍保留最新同步镜像', async () => {
    textarea.value = 'before'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    ;(host as any).engine.view.dispatch({ changes: { from: 6, insert: ' after' } })
    vi.spyOn((host as any).engine, 'destroy').mockImplementation(() => { throw new Error('injected') })
    const snapshot = host.destroy()
    expect(snapshot.text).toBe('before after')
    expect(textarea.value).toBe('before after')
    expect(container.childElementCount).toBe(0)
  })

  it('组合期间待同步的外部新文本不被旧引擎快照覆盖，销毁幂等且隔离迟到事件', async () => {
    textarea.value = 'old'
    const host = await Cm6ModeHost.create({ container, editor: textarea })
    Object.defineProperty((host as any).engine.view, 'composing', { configurable: true, value: true })
    textarea.value = 'new external'
    host.syncFromTextarea()
    const engineDestroy = vi.spyOn((host as any).engine, 'destroy')
    const replaceDocument = vi.spyOn((host as any).engine, 'replaceDocument')
    const snapshot = host.destroy()
    expect(snapshot.text).toBe('new external')
    expect(textarea.value).toBe('new external')
    expect(engineDestroy).toHaveBeenCalledTimes(1)
    expect(host.destroy()).toBe(snapshot)
    expect(engineDestroy).toHaveBeenCalledTimes(1)
    host.root.dispatchEvent(new Event('compositionend'))
    host.syncFromTextarea()
    expect(replaceDocument).not.toHaveBeenCalled()
  })
})
