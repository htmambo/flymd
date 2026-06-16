import { describe, it, expect } from 'vitest'
import { TabManager } from './TabManager'
import type { TabManagerHooks } from './TabManager'

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
