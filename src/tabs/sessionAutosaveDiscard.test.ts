// 退出时的「放弃未保存内容」不能被自动保存定时器撤销。
//
// exitNow 的顺序是 stop → save。stopSessionAutoSave 清掉定时器，但
// saveTabSession 末尾会无条件 scheduleSessionAutoSave()，且不带任何 opts
// —— includeDirtyContent 于是回到默认的 true。
//
// 定时器周期 5s，而 exitNow 在 save 之后仍有若干 await（文件标识 flush、
// 便签恢复、便携导出、关闭前同步）。总耗时一旦超过 5s，定时器就会把用户
// 已选择丢弃的内容重新写进 localStorage，下次启动又被恢复 —— 正好抵消
// stopSessionAutoSave 注释里写明要避免的那件事。

// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type * as Integration from './integration'

let mod: typeof Integration

describe('退出时的会话自动保存', () => {
  // 模块有 initialized 守卫，只初始化一次；首次初始化会等待 DOM 就绪
  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="titlebar"></div>
      <div id="tabbar-placeholder"></div>
      <div class="container">
        <textarea id="editor"></textarea>
        <div id="preview"></div>
      </div>
    `
    mod = await import('./integration')
    await mod.initTabSystem({ restoreSession: false })
  }, 30000)

  beforeEach(() => {
    // 切到假定时器后才能精确统计「是否排下了自动保存定时器」。
    // 必须放在 init 之后 —— init 内部有 await setTimeout 的 DOM 就绪循环。
    vi.useFakeTimers()
    ;(window as any).flymdStopTabSessionAutoSave?.()
  })

  afterEach(() => {
    ;(window as any).flymdStopTabSessionAutoSave?.()
    vi.useRealTimers()
  })

  it('autoReschedule:false 时不得重新排定自动保存定时器', () => {
    const api = window as any
    expect(vi.getTimerCount()).toBe(0)

    // 模拟退出时「放弃未保存内容」的保存
    api.flymdSaveTabSession?.({ includeDirtyContent: false, autoReschedule: false })

    // 不应留下任何待触发的定时器；否则 5s 后会把丢弃的内容写回 storage
    expect(vi.getTimerCount()).toBe(0)
  })

  it('默认调用仍会重新排定自动保存（保持既有行为）', () => {
    const api = window as any
    api.flymdSaveTabSession?.()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })
})