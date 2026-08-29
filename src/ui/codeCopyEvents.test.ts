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

  it('shows "复制失败" when execCommand also fails (returns false)', async () => {
    // 修复后的行为:fallback 检查 execCommand 返回值,不再无条件视为成功。
    // (旧行为:execCommand 返回 false 仍显示"已复制",导致"显示已复制但剪贴板为空")
    // 注意:每次 beforeEach 都会在 document 上累加一个委托监听器,
    // 用 mockRejectedValue(而非 Once)保证所有监听器都走 fallback 路径
    writeTextMock.mockRejectedValue(new Error('nope'))
    document.execCommand = vi.fn(() => false)
    const btn = makeCodebox({ code: 'fallback-fail' })
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.textContent).toBe('复制失败')
  })

  it('copies when clicking a child element inside the button (e.g. SVG icon in wysiwyg)', async () => {
    // 所见模式复制按钮内嵌 SVG:点击图标时 ev.target 是 <rect>/<path> 子元素,
    // 委托需用 closest('.code-copy') 匹配,否则点击无效
    const btn = makeCodebox({ code: 'icon-click' })
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13"></rect></svg>'
    const rect = btn.querySelector('rect') as unknown as HTMLElement
    dispatchClick(rect)
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextMock).toHaveBeenCalledWith('icon-click')
  })

  it('swaps icon button to a check icon on success, then restores the original icon', async () => {
    // 图标按钮(所见模式)的反馈:成功 → 对勾图标,1.2s 后还原;不能用文案反馈
    const originalIcon = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13"></rect></svg>'
    const btn = makeCodebox({ code: 'icon-feedback' })
    btn.innerHTML = originalIcon
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.querySelector('polyline')).toBeTruthy() // 对勾图标
    expect(btn.textContent).not.toContain('已复制')
    vi.advanceTimersByTime(1200)
    expect(btn.innerHTML).toBe(originalIcon)
  })

  it('resets button text after 1.2s', async () => {
    const btn = makeCodebox({ code: 'reset' })
    dispatchClick(btn)
    await Promise.resolve()
    await Promise.resolve()
    expect(btn.textContent).toBe('已复制')
    expect(btn.classList.contains('copy-ok')).toBe(true) // 成功反馈:绿色 class
    vi.advanceTimersByTime(1200)
    expect(btn.textContent).toBe('复制')
    expect(btn.classList.contains('copy-ok')).toBe(false) // 复位后移除
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

// 缩放按钮委托：切换 .codebox 限高/全高显示
describe('initCodeCopyEvents .code-expand', () => {
  function makeExpandBox(): { box: HTMLElement; pre: HTMLElement; btn: HTMLElement } {
    const box = document.createElement('div')
    box.className = 'codebox'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'code'
    pre.appendChild(code)
    box.appendChild(pre)
    const btn = document.createElement('button')
    btn.className = 'code-expand'
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 3 21 3"></polyline></svg>'
    box.appendChild(btn)
    document.body.appendChild(box)
    return { box, pre, btn }
  }

  it('第一次点击：加 .code-expanded 并切换为收起图标与文案', () => {
    const { box, btn } = makeExpandBox()
    dispatchClick(btn)
    expect(box.classList.contains('code-expanded')).toBe(true)
    expect(btn.title).toBe('恢复限高显示')
    expect(btn.innerHTML).toContain('points="4 14') // 收起图标（minimize-2）特征
    expect(btn.innerHTML).not.toContain('points="15 3') // 展开图标已被替换
  })

  it('第二次点击：移除 .code-expanded 还原展开图标', () => {
    const { box, btn } = makeExpandBox()
    dispatchClick(btn)
    dispatchClick(btn)
    expect(box.classList.contains('code-expanded')).toBe(false)
    expect(btn.title).toBe('全高显示代码块')
    expect(btn.innerHTML).toContain('15 3 21 3') // 展开图标还原
  })

  it('点击 SVG 子元素也能命中（closest 兜底）', () => {
    const { box, btn } = makeExpandBox()
    const poly = btn.querySelector('polyline') as unknown as HTMLElement
    dispatchClick(poly)
    expect(box.classList.contains('code-expanded')).toBe(true)
  })

  it('.code-expand 点击不会触发复制', () => {
    const { btn } = makeExpandBox()
    dispatchClick(btn)
    expect(writeTextMock).not.toHaveBeenCalled()
  })
})
