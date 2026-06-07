// @vitest-environment jsdom
// 测试 codeCopyEvents:覆盖 .code-copy 按钮的 click 处理
// 关注点:
// 1) 普通 click 复制纯文本
// 2) Alt+click 复制 Markdown 围栏
// 3) data-copy-target 跨节点查找
// 4) navigator.clipboard 不可用时回退到 textarea + execCommand
// 5) 复制成功/失败后按钮文案变更 + 1.2s 还原
// 6) 非 .code-copy 元素触发 → 不做事

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initCodeCopyEvents } from './codeCopyEvents'

function makeCodebox(opts: { code: string; lang?: string; copyTargetId?: string }): HTMLElement {
  const box = document.createElement('div')
  box.className = 'codebox'
  const pre = document.createElement('pre')
  if (opts.copyTargetId) pre.setAttribute('data-code-copy-id', opts.copyTargetId)
  if (opts.lang) pre.className = `language-${opts.lang}`
  const code = document.createElement('code')
  code.className = opts.lang ? `language-${opts.lang}` : ''
  code.textContent = opts.code
  pre.appendChild(code)
  box.appendChild(pre)
  const btn = document.createElement('button')
  btn.className = 'code-copy'
  btn.textContent = '复制'
  box.appendChild(btn)
  document.body.appendChild(box)
  return btn
}

let writeTextMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useFakeTimers()
  // default: clipboard works
  writeTextMock = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  })
  initCodeCopyEvents()
})

afterEach(() => {
  vi.useRealTimers()
})

function dispatchClick(el: HTMLElement, opts: { altKey?: boolean } = {}): void {
  const ev = new MouseEvent('click', { bubbles: true, altKey: opts.altKey ?? false })
  el.dispatchEvent(ev)
}

describe('initCodeCopyEvents', () => {
  it('copies plain text on default click', async () => {
    const btn = makeCodebox({ code: 'console.log(1)', lang: 'js' })
    dispatchClick(btn)
    // await the async handler — flush microtask queue
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('console.log(1)')
    expect(btn.textContent).toBe('已复制')
  })

  it('copies as Markdown fence on alt+click', async () => {
    const btn = makeCodebox({ code: 'x = 1', lang: 'py' })
    dispatchClick(btn, { altKey: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('```py\nx = 1\n```')
  })

  it('omits language tag in fence when no language class', async () => {
    const btn = makeCodebox({ code: 'plain' })
    dispatchClick(btn, { altKey: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('```\nplain\n```')
  })

  it('uses data-copy-target to find pre outside the box', async () => {
    const pre = document.createElement('pre')
    pre.setAttribute('data-code-copy-id', 'remote-pre')
    const code = document.createElement('code')
    code.textContent = 'remote code'
    pre.appendChild(code)
    document.body.appendChild(pre)
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    btn.setAttribute('data-copy-target', 'remote-pre')
    btn.textContent = '复制'
    document.body.appendChild(btn)

    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('remote code')
  })

  it('falls back to execCommand when clipboard API rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('not allowed'))
    const execSpy = vi.fn(() => true)
    document.execCommand = execSpy
    const btn = makeCodebox({ code: 'fallback' })
    dispatchClick(btn)
    // multi-await to drain the try/catch chain
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(execSpy).toHaveBeenCalledWith('copy')
    expect(btn.textContent).toBe('已复制')
  })

  it('shows "已复制" when execCommand returns false (pre-existing behavior — ok=true in finally)', async () => {
    // 行为保留:main.ts 原代码 fallback 块末尾无条件 `ok = true`,
    // 因此即便 execCommand 返回 false,按钮仍显示"已复制"。
    // 真实场景下 execCommand 失败通常由 try/catch 抛错捕获,走更早的 fail 路径。
    writeTextMock.mockRejectedValueOnce(new Error('nope'))
    document.execCommand = vi.fn(() => false)
    const btn = makeCodebox({ code: 'fallback-still-ok' })
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.textContent).toBe('已复制')
  })

  it('resets button text after 1.2s', async () => {
    const btn = makeCodebox({ code: 'reset' })
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.textContent).toBe('已复制')
    vi.advanceTimersByTime(1200)
    expect(btn.textContent).toBe('复制')
  })

  it('ignores clicks on non .code-copy elements', async () => {
    const other = document.createElement('button')
    other.textContent = 'not a copy btn'
    document.body.appendChild(other)
    dispatchClick(other)
    await Promise.resolve()
    expect(writeTextMock).not.toHaveBeenCalled()
  })

  it('uses __copyText when present on the button', async () => {
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    ;(btn as any).__copyText = 'preset'
    document.body.appendChild(btn)
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('preset')
  })
})
