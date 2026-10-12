// 并发切换标签时的状态覆盖竞态。
//
// restoreTabState 内部有重量级 await（所见模式启停会重建 Milkdown 实例、
// PDF 会重载文件），而 switchToTab 不串行化，调用方（TabBar 的点击处理）
// 也不 await。因此「切到 A、恢复未完成、再切到 B」是完全可达的。
//
// 后果：若不加守卫，A 的续行会在 B 恢复完之后继续执行，把 A 的 dirty 写进
// 正显示 B 的编辑器。若 A 干净、B 有未保存改动，dirty 被抹成 false，随后
// saveCurrentTabState 会把它固化 —— 用户关闭 B 时就不再收到保存提示。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TabManager } from './TabManager'
import type { TabManagerHooks } from './TabManager'

/** 可控 rAF 队列：手动 flush，模拟「下一次绘制」 */
let rafQueue: Array<() => void> = []
function flushRaf() {
  const q = rafQueue
  rafQueue = []
  for (const fn of q) fn()
}

type Probe = {
  hooks: TabManagerHooks
  state: () => { dirty: boolean; content: string }
  releaseFirstToggle: () => void
}

/**
 * 所见模式始终报告「已开启」，使 restoreTabState 必定经过那个重量级 await。
 *
 * 关键：第一次 setWysiwygEnabled（属于标签 A 的恢复）会挂起在可控的 Promise 上，
 * 直到测试显式调用 releaseFirstToggle 才放行。这样才能造出真正的窗口 ——
 * 「A 的恢复在 B 完整结束之后才继续执行」。缺了这个窗口，B 自己的后写入会把
 * A 的脏写盖掉，竞态在最终状态上不可见，测试就成了永远会过的摆设
 * （这一点实测确认过：仅靠微任务让出，移除守卫后用例依然通过）。
 */
function makeHooks(): Probe {
  let dirty = false
  let content = ''
  let filePath: string | null = null
  let releaseFirstToggle = () => {}
  // 按「当前正在恢复的内容」判定，而非「第几次调用」——init/importState 是否会触发
  // setWysiwygEnabled 取决于实现演进，用计数会死锁。
  let restoring: string | null = null
  const gate = new Promise<void>((resolve) => { releaseFirstToggle = resolve })
  const hooks: TabManagerHooks = {
    getEditorContent: () => content,
    setEditorContent: (c) => { content = c; restoring = c },
    getCurrentFilePath: () => filePath,
    setCurrentFilePath: (p) => { filePath = p },
    getDirty: () => dirty,
    setDirty: (d) => { dirty = d },
    getMode: () => 'edit',
    setMode: () => {},
    getWysiwygEnabled: () => true,
    setWysiwygEnabled: async () => {
      // 只有 A 的恢复会挂起；B 的恢复照常跑完
      if (restoring === 'A 内容') await gate
    },
    getScrollTop: () => 0,
    setScrollTop: () => {},
    getCursorPos: () => ({ line: 1, col: 1 }),
    setCursorPos: () => {},
    refreshTitle: () => {},
    refreshPreview: () => {},
    reloadFile: async () => {},
  }
  return { hooks, state: () => ({ dirty, content }), releaseFirstToggle }
}

/** 两个标签：A 干净，B 有未保存改动。
 *  初始活动标签设为 tab-b —— 这样 switchToTab('tab-a') 才是一次「真正的切换」，
 *  否则它会命中 `tabId === this.activeTabId` 的早返回，竞态根本不会发生
 *  （这一点实测确认过：activeTabId 指向不存在的值时 importState 会回退到首个标签）。
 */
async function makeTwoTabs(tm: TabManager) {
  await tm.importState({
    tabs: [
      { id: 'tab-a', filePath: '/a.md', content: 'A 内容', dirty: false, mode: 'edit', wysiwygEnabled: false },
      { id: 'tab-b', filePath: '/b.md', content: 'B 内容', dirty: true, mode: 'edit', wysiwygEnabled: false },
    ],
    activeTabId: 'tab-b',
    // 非脏标签会走 loadFileContent 重新加载内容，必须返回真实内容，
    // 否则 A 的 content 变成空串，下面按内容判定的挂起点就不会触发。
  } as any, async (p: string) => (p === '/a.md' ? 'A 内容' : ''))
  expect(tm.getActiveTab()?.id).toBe('tab-b')
  expect(tm.findTabById('tab-a')!.content).toBe('A 内容')
}

describe('并发切换标签的状态隔离', () => {
  beforeEach(() => {
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      rafQueue.push(fn)
      return rafQueue.length
    })
  })

  it('A 的恢复被 B 取代后，不得把 A 的状态写进正在显示 B 的编辑器', async () => {
    const tm = new TabManager()
    const { hooks, state, releaseFirstToggle } = makeHooks()
    tm.init(hooks)
    await makeTwoTabs(tm)

    // A 的恢复会挂在 setWysiwygEnabled 上（第一次调用）
    const pA = tm.switchToTab('tab-a')
    // 让 A 走到挂起点，然后切到 B 并让它完整跑完
    await Promise.resolve()
    const pB = tm.switchToTab('tab-b')
    await pB

    // 现在才放行 A —— 它会在 B 完全结束之后才继续执行
    releaseFirstToggle()
    await pA
    flushRaf()

    expect(tm.getActiveTab()?.id).toBe('tab-b')
    expect(state().content).toBe('B 内容')
    expect(state().dirty).toBe(true)
    expect(tm.findTabById('tab-b')!.dirty).toBe(true)
  })

  // 注：这里原本还有一个「过期 rAF 不得覆盖状态」的用例，但它并不成立 ——
  // 手动丢弃/保留 A 的回调都无法区分对错：flush 按入队顺序执行，A 的回调先于 B，
  // 最终值始终是 B 写入的那个。真正能暴露该竞态的是上面那个交错用例，
  // 因为只有它能让「过期」的续行最后落地。故不保留名不副实的用例。
})