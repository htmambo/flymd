// fileTreeFacade 单元测试（perf 批次 E）
//
// 覆盖：
// - ensureFileTree 单例：多次调用返回同一 promise，./fileTree 只被动态 import 一次
// - init/refresh/revealAndSelect 转发真实模块并保参
// - setSort fire-and-forget：不 await 也最终转发
// - getSelectedDir 同步转发；模块未就绪时返回 null（与"无选中"同义）
//
// 门面是模块级单例，用 vi.resetModules + 动态 import 隔离各用例的加载状态。

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  revealAndSelect: vi.fn(async () => undefined),
  getSelectedDir: vi.fn(() => '/lib/selected'),
  newFileInSelected: vi.fn(async () => undefined),
  newFolderInSelected: vi.fn(async () => undefined),
  setSort: vi.fn(),
}))

vi.mock('./fileTree', () => ({ default: apiMocks }))

// 动态 import 门面，返回 { fileTreeFacade, ensureFileTree }
async function loadFacade() {
  return await import('./fileTreeFacade')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('fileTreeFacade', () => {
  it('ensureFileTree 单例：./fileTree 只被加载一次', async () => {
    const { ensureFileTree } = await loadFacade()
    const p1 = ensureFileTree()
    const p2 = ensureFileTree()
    expect(p1).toBe(p2)
    const m = await p1
    expect(m.default).toBe(apiMocks)
  })

  it('init/refresh/revealAndSelect 转发真实模块并保参', async () => {
    const { fileTreeFacade } = await loadFacade()
    const container = document.createElement('div')
    const opts = { getRoot: async () => null, onOpenFile: async () => {} } as any
    await fileTreeFacade.init(container, opts)
    expect(apiMocks.init).toHaveBeenCalledWith(container, opts)
    await fileTreeFacade.refresh()
    expect(apiMocks.refresh).toHaveBeenCalledTimes(1)
    await fileTreeFacade.revealAndSelect('/lib/a.md')
    expect(apiMocks.revealAndSelect).toHaveBeenCalledWith('/lib/a.md')
  })

  it('setSort fire-and-forget：不 await 也最终转发参数', async () => {
    const { fileTreeFacade, ensureFileTree } = await loadFacade()
    fileTreeFacade.setSort('mtime_desc')
    await ensureFileTree()
    await Promise.resolve()
    await Promise.resolve()
    expect(apiMocks.setSort).toHaveBeenCalledWith('mtime_desc')
  })

  it('getSelectedDir：模块未就绪返回 null，就绪后同步转发', async () => {
    const { fileTreeFacade, ensureFileTree } = await loadFacade()
    // 未发起加载：门面应返回 null（与"无选中"同义），且不触发模块加载
    expect(fileTreeFacade.getSelectedDir()).toBeNull()
    expect(apiMocks.getSelectedDir).not.toHaveBeenCalled()
    await ensureFileTree()
    expect(fileTreeFacade.getSelectedDir()).toBe('/lib/selected')
    expect(apiMocks.getSelectedDir).toHaveBeenCalledTimes(1)
  })
})
