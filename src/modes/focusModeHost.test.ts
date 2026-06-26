// @vitest-environment jsdom
// 测试 focusModeHost 的 compactTitlebar 读写语义修复：
// 修复前 setCompactTitlebar / getCompactTitlebar 都把 compactTitlebar 写死为 true,
// 导致 isCompactTitlebarEnabled() 永远 true,既无法持久化用户偏好,也会让 initWindowDrag
// 的"门槛"看似通过但实际语义错误。
//
// 关注点:
// 1. setCompactTitlebarFlag / setCompactTitlebar 真的写入入参值
// 2. getCompactTitlebar 从 store 读取持久值,store 不存在时回退到内存值
// 3. isCompactTitlebarEnabled 反映真实内存值

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  isCompactTitlebarEnabled,
  setCompactTitlebarFlag,
  getCompactTitlebar,
  setCompactTitlebar,
} from './focusModeHost'

interface FakeStore {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

function makeStore(initial: Record<string, unknown> = {}): FakeStore {
  const data: Record<string, unknown> = { ...initial }
  return {
    get: vi.fn(async (key: string) => data[key]),
    set: vi.fn(async (key: string, value: unknown) => { data[key] = value }),
    save: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  // 重置内存状态:模块级单例,必须显式重置避免用例互相污染。
  // 默认是 true,这里统一重置为 false 再开始。
  setCompactTitlebarFlag(false)
  // body class 也清掉
  document.body.className = ''
})

describe('isCompactTitlebarEnabled / setCompactTitlebarFlag', () => {
  it('reflects the value set by setCompactTitlebarFlag', () => {
    setCompactTitlebarFlag(false)
    expect(isCompactTitlebarEnabled()).toBe(false)
    setCompactTitlebarFlag(true)
    expect(isCompactTitlebarEnabled()).toBe(true)
  })

  it('coerces non-boolean to boolean', () => {
    setCompactTitlebarFlag('yes' as unknown as boolean)
    expect(isCompactTitlebarEnabled()).toBe(true)
    setCompactTitlebarFlag(0 as unknown as boolean)
    expect(isCompactTitlebarEnabled()).toBe(false)
  })
})

describe('getCompactTitlebar (store loading)', () => {
  it('returns stored boolean when store has compactTitlebar=true', async () => {
    const store = makeStore({ compactTitlebar: true })
    // 起始内存值为 false,验证 store 优先级
    setCompactTitlebarFlag(false)
    const v = await getCompactTitlebar(store as any)
    expect(v).toBe(true)
    expect(isCompactTitlebarEnabled()).toBe(true)
  })

  it('returns stored boolean when store has compactTitlebar=false', async () => {
    const store = makeStore({ compactTitlebar: false })
    setCompactTitlebarFlag(true) // 内存默认值是 true
    const v = await getCompactTitlebar(store as any)
    expect(v).toBe(false)
    expect(isCompactTitlebarEnabled()).toBe(false)
  })

  it('falls back to in-memory value when store has no compactTitlebar', async () => {
    const store = makeStore({}) // 无 compactTitlebar key
    setCompactTitlebarFlag(true)
    const v = await getCompactTitlebar(store as any)
    expect(v).toBe(true)
  })

  it('falls back to in-memory value when store.get throws', async () => {
    const badStore: FakeStore = {
      get: vi.fn(async () => { throw new Error('store broken') }),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    }
    setCompactTitlebarFlag(true)
    const v = await getCompactTitlebar(badStore as any)
    expect(v).toBe(true)
  })

  it('returns current in-memory value when store is null', async () => {
    setCompactTitlebarFlag(true)
    const v = await getCompactTitlebar(null)
    expect(v).toBe(true)
    setCompactTitlebarFlag(false)
    const v2 = await getCompactTitlebar(null)
    expect(v2).toBe(false)
  })
})

describe('setCompactTitlebar (toggle semantic)', () => {
  it('writes the actual enabled argument (not hardcoded true)', async () => {
    const store = makeStore()
    await setCompactTitlebar(false, store as any, false)
    expect(isCompactTitlebarEnabled()).toBe(false)
    await setCompactTitlebar(true, store as any, false)
    expect(isCompactTitlebarEnabled()).toBe(true)
  })

  it('persists to store when persist=true and not on Windows', async () => {
    const store = makeStore()
    // 模拟非 Windows
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      await setCompactTitlebar(false, store as any, true)
      expect(store.set).toHaveBeenCalledWith('compactTitlebar', false)
      expect(store.save).toHaveBeenCalled()
    } finally {
      if (orig) Object.defineProperty(navigator, 'platform', orig)
    }
  })

  it('does not persist to store when persist=false', async () => {
    const store = makeStore()
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      await setCompactTitlebar(true, store as any, false)
      expect(store.set).not.toHaveBeenCalled()
    } finally {
      if (orig) Object.defineProperty(navigator, 'platform', orig)
    }
  })

  it('toggles body.compact-titlebar class to match enabled', async () => {
    const store = makeStore()
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      await setCompactTitlebar(true, store as any, false)
      expect(document.body.classList.contains('compact-titlebar')).toBe(true)
      await setCompactTitlebar(false, store as any, false)
      expect(document.body.classList.contains('compact-titlebar')).toBe(false)
    } finally {
      if (orig) Object.defineProperty(navigator, 'platform', orig)
    }
  })

  it('does not persist on Windows even when persist=true', async () => {
    const store = makeStore()
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
    try {
      await setCompactTitlebar(false, store as any, true)
      // Windows 上 isWindowsPlatform() 短路持久化,store 不应被写入
      expect(store.set).not.toHaveBeenCalled()
      expect(store.save).not.toHaveBeenCalled()
      // 内存值仍然按入参更新
      expect(isCompactTitlebarEnabled()).toBe(false)
    } finally {
      if (orig) Object.defineProperty(navigator, 'platform', orig)
    }
  })

  it('does not throw when store.set / store.save throws (persistence failure tolerance)', async () => {
    const brokenStore: FakeStore = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => { throw new Error('disk full') }),
      save: vi.fn(async () => { throw new Error('disk full') }),
    }
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      // 不应向上抛:现有 try/catch 吞掉 store 异常,主流程不被打断
      await expect(setCompactTitlebar(false, brokenStore as any, true)).resolves.toBeUndefined()
      // 内存值仍按入参更新
      expect(isCompactTitlebarEnabled()).toBe(false)
    } finally {
      if (orig) Object.defineProperty(navigator, 'platform', orig)
    }
  })

  it('ignores non-boolean compactTitlebar from store and falls back to in-memory', async () => {
    const store = makeStore({ compactTitlebar: 'true' as unknown as boolean })
    setCompactTitlebarFlag(true)
    const v = await getCompactTitlebar(store as any)
    // store 值不是 boolean → 不覆盖内存,保持 in-memory true
    expect(v).toBe(true)
    expect(isCompactTitlebarEnabled()).toBe(true)
  })
})
