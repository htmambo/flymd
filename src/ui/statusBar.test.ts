// @vitest-environment jsdom
// 测试 statusBar:消息槽(自动清除 + 外部写入兜底)+ 四个常驻槽位 + dispose
// 关注点:
// 1) setMessage 写入消息,clearMessage 清空
// 2) setMessage 到期自动清除(单一 timer 句柄)
// 3) 外部直接写 #status(textContent)也会被 MutationObserver 兜底清除
// 4) 四个常驻槽位各自写入/清空
// 5) dispose() 取消待清除定时器

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createStatusBar, STATUS_MESSAGE_TTL } from './statusBar'

function mountDom() {
  document.body.innerHTML = `
    <div class="statusbar" id="statusbar">
      <div class="statusbar-left" id="statusbar-left"></div>
      <div class="statusbar-msg" id="status"></div>
      <div class="statusbar-right" id="statusbar-right">
        <span id="statusbar-pos"></span>
        <span id="statusbar-chars"></span>
        <span id="statusbar-dirty" data-dirty="0"></span>
        <span id="statusbar-zoom"></span>
      </div>
    </div>`
  return {
    message: document.getElementById('status') as HTMLElement,
    pos: document.getElementById('statusbar-pos') as HTMLElement,
    chars: document.getElementById('statusbar-chars') as HTMLElement,
    dirty: document.getElementById('statusbar-dirty') as HTMLElement,
    zoom: document.getElementById('statusbar-zoom') as HTMLElement,
  }
}

describe('statusBar 消息槽', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('setMessage 写入消息,clearMessage 清空', () => {
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setMessage('文件已保存')
    expect(dom.message.textContent).toBe('文件已保存')
    bar.clearMessage()
    expect(dom.message.textContent).toBe('')
    bar.dispose()
  })

  it('消息到期自动清除', async () => {
    vi.useFakeTimers()
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setMessage('正在导出 PDF...')
    expect(dom.message.textContent).toBe('正在导出 PDF...')
    await vi.advanceTimersByTimeAsync(STATUS_MESSAGE_TTL + 10)
    expect(dom.message.textContent).toBe('')
    bar.dispose()
  })

  it('后写的消息不会被前一个定时器提前清掉(单一 timer 句柄)', async () => {
    vi.useFakeTimers()
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setMessage('第一条')
    await vi.advanceTimersByTimeAsync(STATUS_MESSAGE_TTL - 100)
    bar.setMessage('第二条')
    await vi.advanceTimersByTimeAsync(200)
    expect(dom.message.textContent).toBe('第二条')
    await vi.advanceTimersByTimeAsync(STATUS_MESSAGE_TTL)
    expect(dom.message.textContent).toBe('')
    bar.dispose()
  })

  it('外部直接写 #status 也会被兜底清除', async () => {
    vi.useFakeTimers()
    const dom = mountDom()
    const bar = createStatusBar()
    dom.message.textContent = '同步进行中，请稍候'
    await vi.advanceTimersByTimeAsync(1)
    expect(dom.message.textContent).toBe('同步进行中，请稍候')
    await vi.advanceTimersByTimeAsync(STATUS_MESSAGE_TTL + 10)
    expect(dom.message.textContent).toBe('')
    bar.dispose()
  })

  it('dispose() 取消待清除定时器', async () => {
    vi.useFakeTimers()
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setMessage('不会自动消失')
    bar.dispose()
    await vi.advanceTimersByTimeAsync(STATUS_MESSAGE_TTL * 3)
    expect(dom.message.textContent).toBe('不会自动消失')
  })
})

describe('statusBar 常驻槽位', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('行/列、字数、缩放各自写入对应槽位', () => {
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setPosition('行 3, 列 7')
    bar.setChars('字 42')
    bar.setZoom('120%')
    expect(dom.pos.textContent).toBe('行 3, 列 7')
    expect(dom.chars.textContent).toBe('字 42')
    expect(dom.zoom.textContent).toBe('120%')
    bar.dispose()
  })

  it('传 null 表示隐藏该项', () => {
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setPosition('行 3, 列 7')
    bar.setPosition(null)
    bar.setChars('字 42')
    bar.setChars(null)
    expect(dom.pos.textContent).toBe('')
    expect(dom.chars.textContent).toBe('')
    bar.dispose()
  })

  it('未保存标记写入圆点 + data-dirty + tooltip,取消时清空', () => {
    const dom = mountDom()
    const bar = createStatusBar()
    bar.setDirty(true, '未保存')
    expect(dom.dirty.textContent).toBe('●')
    expect(dom.dirty.getAttribute('data-dirty')).toBe('1')
    expect(dom.dirty.title).toBe('未保存')

    bar.setDirty(false)
    expect(dom.dirty.textContent).toBe('')
    expect(dom.dirty.getAttribute('data-dirty')).toBe('0')
    expect(dom.dirty.title).toBe('')
    bar.dispose()
  })
})
