import { describe, it, expect, beforeAll, vi } from 'vitest'
import { TabManager } from './TabManager'
import type { TabManagerHooks } from './TabManager'

// importState → restoreTabState 会调度 requestAnimationFrame，Node 测试环境没有该 API
beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    vi.stubGlobal('requestAnimationFrame', () => 0)
  }
})

/**
 * 构造一组最小可控的 hooks：只关心 dirty / content，其余给无副作用默认值。
 * init() 会据此创建初始活跃标签，exportState() 内部的 saveCurrentTabState()
 * 也会再次从 hooks 读取，因而能精确驱动 dirty tab 的导出行为。
 */
function makeHooks(over: { dirty?: boolean; content?: string } = {}): TabManagerHooks {
  let dirty = over.dirty ?? false
  let content = over.content ?? ''
  let filePath: string | null = null
  return {
    getEditorContent: () => content,
    setEditorContent: (c) => {
      content = c
    },
    getCurrentFilePath: () => filePath,
    setCurrentFilePath: (p) => {
      filePath = p
    },
    getDirty: () => dirty,
    setDirty: (d) => {
      dirty = d
    },
    getMode: () => 'edit',
    setMode: () => {},
    getWysiwygEnabled: () => false,
    setWysiwygEnabled: async () => {},
    getScrollTop: () => 0,
    setScrollTop: () => {},
    getCursorPos: () => ({ line: 1, col: 1 }),
    setCursorPos: () => {},
    refreshTitle: () => {},
    refreshPreview: () => {},
    reloadFile: async () => {},
  }
}

describe('TabManager.exportState — discard 语义', () => {
  it('默认（向后兼容）：dirty tab 的 content 与 dirty 标记一并导出', () => {
    const tm = new TabManager()
    tm.init(makeHooks({ dirty: true, content: '未保存内容' }))

    const state = tm.exportState()

    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].dirty).toBe(true)
    expect(state.tabs[0].content).toBe('未保存内容')
  })

  it('includeDirtyContent:false：dirty tab 的 content 写空、dirty 重置为 false', () => {
    const tm = new TabManager()
    tm.init(makeHooks({ dirty: true, content: '未保存内容' }))

    const state = tm.exportState({ includeDirtyContent: false })

    // 这是修复"放弃更改后下次启动仍恢复内容"语义 bug 的核心保证
    expect(state.tabs[0].content).toBe('')
    expect(state.tabs[0].dirty).toBe(false)
  })

  it('includeDirtyContent:true 显式传入与默认行为一致', () => {
    const tm = new TabManager()
    tm.init(makeHooks({ dirty: true, content: 'X' }))

    const state = tm.exportState({ includeDirtyContent: true })

    expect(state.tabs[0].content).toBe('X')
    expect(state.tabs[0].dirty).toBe(true)
  })

  it('非 dirty tab：两种模式都不持久化 content（已保存文件下次从磁盘加载）', () => {
    const tm = new TabManager()
    tm.init(makeHooks({ dirty: false, content: '已保存内容' }))

    expect(tm.exportState().tabs[0].content).toBe('')
    expect(tm.exportState({ includeDirtyContent: false }).tabs[0].content).toBe('')
  })
})

describe('TabManager.importState — 活跃标签恢复', () => {
  it('恢复会话后激活的是导出时的活跃标签（tab id 跨会话复用）', async () => {
    // 第一段会话：打开 a/b 两个文件，最终 b 处于激活状态
    const tm1 = new TabManager()
    const hooks1 = makeHooks()
    tm1.init(hooks1)
    hooks1.setCurrentFilePath('/tmp/a.md')
    tm1.openFile('/tmp/a.md')
    hooks1.setCurrentFilePath('/tmp/b.md')
    tm1.openFile('/tmp/b.md')
    expect(tm1.getActiveTab()?.filePath).toBe('/tmp/b.md')

    const state = tm1.exportState()

    // 第二段会话（应用重启）：从持久化快照恢复
    const tm2 = new TabManager()
    tm2.init(makeHooks())
    await tm2.importState(state, async () => '磁盘内容')

    // 修复前：快照中的 tab 没有 id，importState 重新生成 id，
    // activeTabId 永远匹配不上而回落到第一个标签
    expect(tm2.getActiveTabId()).toBe(state.activeTabId)
    expect(tm2.getActiveTab()?.filePath).toBe('/tmp/b.md')
  })

  it('老快照（无 id 字段）兼容：不报错并回落激活第一个标签', async () => {
    const legacy = {
      tabs: [
        { filePath: '/tmp/a.md', content: '', dirty: false, mode: 'edit', wysiwygEnabled: false },
        { filePath: '/tmp/b.md', content: '', dirty: false, mode: 'edit', wysiwygEnabled: false },
      ],
      activeTabId: 'tab_legacy_stale',
    } as any

    const tm = new TabManager()
    tm.init(makeHooks())
    await tm.importState(legacy, async () => '磁盘内容')

    expect(tm.getTabs()).toHaveLength(2)
    expect(tm.getActiveTab()?.filePath).toBe('/tmp/a.md')
  })
})
