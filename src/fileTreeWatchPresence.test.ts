/**
 * fileTree watch 增量失效集成测试（T3 / NFR-3）
 *
 * 通过 vi.mock 接管 Tauri IPC（scan_dirs_doc_presence 返回受控 pending promise），
 * 验证 refreshTree 的调度语义：
 * - ≤64 路径：立即以缓存渲染，refreshTree 在后台预取 pending 期间先行返回（不 await 扫描）
 * - >64 路径：降级全清 + root 全扫，渲染等待扫描完成（现状语义）
 * - 后台预取失败：logWarn + 标脏，下一次 refreshTree 走全清全扫兜底（FR-3）
 * - debounce 合并窗口内多条事件并集触发一次增量刷新
 * - invalidateDirDocPresenceScan 前缀数组（段级匹配，不误伤兄弟目录）+ 单前缀向后兼容
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ScanDeferred = { promise: Promise<string[]>; resolve: (v: string[]) => void; reject: (e: any) => void }

let scanQueue: ScanDeferred[] = []
let scanArgs: any[] = []

function makeDeferred(): ScanDeferred {
  let resolve!: (v: string[]) => void
  let reject!: (e: any) => void
  const promise = new Promise<string[]>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const invokeMock = vi.fn((cmd: string, args: any) => {
  if (cmd === 'scan_dirs_doc_presence') {
    scanArgs.push(args)
    const d = makeDeferred()
    scanQueue.push(d)
    return d.promise
  }
  return Promise.reject(new Error('unknown command: ' + cmd))
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: any) => invokeMock(cmd, args),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: async () => [],
  stat: async (p: string) => { throw new Error('not found: ' + p) },
  mkdir: async () => {},
  rename: async () => {},
  remove: async () => {},
  exists: async () => false,
  writeTextFile: async () => {},
  writeFile: async () => {},
  readFile: async () => { throw new Error('not found') },
  watch: async () => () => {},
  // logger（动态 import）依赖：
  open: async () => { throw new Error('logger disabled in test') },
  BaseDirectory: {},
}))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ROOT = '/lib'

let container: HTMLElement
let hooks: typeof import('./fileTree').__fileTreeTestHooks
let renderCount = 0
let mo: MutationObserver | null = null

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  scanQueue = []
  scanArgs = []
  invokeMock.mockClear()
  const mod = await import('./fileTree')
  hooks = mod.__fileTreeTestHooks
  hooks.resetForTest()
  renderCount = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  mo?.disconnect()
  mo = new MutationObserver(() => { renderCount++ })
  mo.observe(container, { childList: true })
  // init → refresh()：消费一次全扫（队列第 1 个 deferred）
  const initP = mod.fileTree.init(container, { getRoot: async () => ROOT, onOpenFile: async () => {} })
  await vi.waitFor(() => expect(scanQueue.length).toBe(1))
  scanQueue.shift()!.resolve([])
  await initP
  renderCount = 0
})

describe('refreshTree 增量失效（watch 路径 ≤64）', () => {
  it('单文件事件：立即以缓存渲染，refreshTree 不等待后台预取（NFR-3）', async () => {
    const p = hooks.refreshTree([ROOT + '/a.md'])
    // 后台预取已发起（仅失效前缀集合是目标语义；Rust 暂不支持前缀参数，仍以 root 后台扫描）
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    // 关键断言：扫描未 resolve，渲染已先行发生
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(0), { timeout: 500 })
    // 关键断言：refreshTree 在后台预取 pending 期间已返回（不 hang）
    await p
    // 基线（空）与新扫描（空）一致 → hint 无变化 → 不标脏、不二次渲染
    scanQueue.shift()!.resolve([])
    await sleep(30)
    expect(hooks.dirDocPresenceDirty).toBe(false)
  })

  it('65 条路径：降级全清 + root 全扫，渲染等待扫描完成（写放大防护）', async () => {
    const many = Array.from({ length: 65 }, (_, i) => `${ROOT}/f${i}.md`)
    const p = hooks.refreshTree(many)
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    const race = await Promise.race([
      p.then(() => 'resolved'),
      sleep(150).then(() => 'pending'),
    ])
    expect(race).toBe('pending')
    expect(renderCount).toBe(0)
    scanQueue.shift()!.resolve([])
    await p
    expect(renderCount).toBeGreaterThan(0)
  })

  it('无路径上下文：保持现状语义（全清 + 全扫后渲染）', async () => {
    const p = hooks.refreshTree(null)
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    const race = await Promise.race([
      p.then(() => 'resolved'),
      sleep(150).then(() => 'pending'),
    ])
    expect(race).toBe('pending')
    scanQueue.shift()!.resolve([])
    await p
    expect(renderCount).toBeGreaterThan(0)
  })

  it('后台预取失败：标脏，下一次 refreshTree 走全清全扫兜底（FR-3）', async () => {
    const p1 = hooks.refreshTree([ROOT + '/a.md'])
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(0), { timeout: 500 })
    await p1
    scanQueue.shift()!.reject(new Error('ipc boom'))
    await vi.waitFor(() => expect(hooks.dirDocPresenceDirty).toBe(true))
    // 下一次即使有单路径上下文，也强制全扫兜底
    const rcBefore = renderCount
    const p2 = hooks.refreshTree([ROOT + '/b.md'])
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    const race = await Promise.race([
      p2.then(() => 'resolved'),
      sleep(150).then(() => 'pending'),
    ])
    expect(race).toBe('pending')
    expect(renderCount).toBe(rcBefore) // 全扫完成前不渲染
    scanQueue.shift()!.resolve([])
    await p2
    expect(renderCount).toBeGreaterThan(rcBefore)
    expect(hooks.dirDocPresenceDirty).toBe(false) // 全清全扫消费脏标记
  })

  it('后台预取完成后 hint 与已渲染不一致 → 触发二次渲染（最终一致）', async () => {
    const p1 = hooks.refreshTree([ROOT + '/a.md'])
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(0), { timeout: 500 })
    await p1
    const rcBefore = renderCount
    // 新扫描发现新目录含文档 → 与基线（空）不一致 → 兜底 renderRoot
    scanQueue.shift()!.resolve([ROOT + '/newdir'])
    await vi.waitFor(() => expect(renderCount).toBeGreaterThan(rcBefore), { timeout: 500 })
    expect(hooks.dirDocPresenceDirty).toBe(false)
  })

  it('全扫路径失败：置脏标记，下一次刷新继续全清全扫兜底', async () => {
    const many = Array.from({ length: 65 }, (_, i) => `${ROOT}/f${i}.md`)
    const p = hooks.refreshTree(many) // >64 → 全清 + 全扫
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    scanQueue.shift()!.reject(new Error('full scan boom'))
    await p // 全扫失败被捕获，仍渲染（回落懒加载递归）
    expect(hooks.dirDocPresenceDirty).toBe(true)
    // 下一次单路径刷新仍强制全扫（脏标记未被消费）
    const p2 = hooks.refreshTree([ROOT + '/a.md'])
    await vi.waitFor(() => expect(scanQueue.length).toBe(1))
    const race = await Promise.race([
      p2.then(() => 'resolved'),
      sleep(150).then(() => 'pending'),
    ])
    expect(race).toBe('pending')
    scanQueue.shift()!.resolve([])
    await p2
    expect(hooks.dirDocPresenceDirty).toBe(false) // 全扫成功才消费脏标记
  })
})

describe('scheduleRefreshTreeFromWatch 路径并集', () => {
  it('debounce 窗口内多条事件并集触发一次增量刷新（不 await 扫描）', async () => {
    vi.useFakeTimers()
    try {
      hooks.scheduleRefreshTreeFromWatch([ROOT + '/a.md', ROOT + '/a.md'])
      hooks.scheduleRefreshTreeFromWatch([ROOT + '\\b.md'])
      await vi.advanceTimersByTimeAsync(249)
      expect(scanQueue.length).toBe(0) // debounce 未到点
      await vi.advanceTimersByTimeAsync(1)
      expect(scanQueue.length).toBe(1) // 并集去重后 2 条路径 → 一次增量刷新、一次后台预取
      expect(renderCount).toBeGreaterThan(0) // 已先行渲染
      scanQueue.shift()!.resolve([])
      await vi.advanceTimersByTimeAsync(10)
      expect(hooks.dirDocPresenceDirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('invalidateDirDocPresenceScan 前缀失效', () => {
  it('支持前缀数组（段级匹配，不误伤兄弟目录）+ 单前缀向后兼容 + 全清', async () => {
    const pf = hooks.prefetchDirDocPresence(ROOT)
    scanQueue.shift()!.resolve([ROOT + '/a', ROOT + '/a/b', ROOT + '/ab', ROOT + '/c'])
    await pf
    expect([...hooks.dirDocPresenceScan.keys()].sort()).toEqual(
      [ROOT + '/a', ROOT + '/a/b', ROOT + '/ab', ROOT + '/c'].sort(),
    )
    // 数组形式：/lib/a 前缀失效 → /lib/a 与 /lib/a/b 被清；/lib/ab（兄弟）保留
    hooks.invalidateDirDocPresenceScan([ROOT + '/a'])
    expect([...hooks.dirDocPresenceScan.keys()].sort()).toEqual([ROOT + '/ab', ROOT + '/c'])
    // 单前缀（向后兼容）
    hooks.invalidateDirDocPresenceScan(ROOT + '/c')
    expect([...hooks.dirDocPresenceScan.keys()]).toEqual([ROOT + '/ab'])
    // 全清
    hooks.invalidateDirDocPresenceScan()
    expect(hooks.dirDocPresenceScan.size).toBe(0)
  })

  it('前缀失效只影响缓存命中，不阻塞渲染语义', async () => {
    const pf = hooks.prefetchDirDocPresence(ROOT)
    scanQueue.shift()!.resolve([ROOT + '/sub'])
    await pf
    expect(hooks.dirDocPresenceScan.has(ROOT + '/sub')).toBe(true)
    hooks.invalidateDirDocPresenceScan([ROOT + '/sub/x.md', ROOT + '/sub'])
    expect(hooks.dirDocPresenceScan.has(ROOT + '/sub')).toBe(false)
  })
})
