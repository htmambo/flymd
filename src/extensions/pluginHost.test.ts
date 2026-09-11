// 库私有化 v2 - PR-5 测试
// 覆盖 createPluginScopedStorage 工厂函数(get / set / remove + 库作用域边界)
// 详见 docs/Task/Active/2026-09-11-library-private-v2-pr5-plugin-scoped-api.md

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub 库作用域
const libStub = vi.hoisted(() => ({
  scope: { id: null as string | null, root: null as string | null, persisted: false },
}))

vi.mock('../core/libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/libraryConfig')>()
  return {
    ...actual,
    getLibraryScope: () => libStub.scope,
  }
})

// Mock libraryPrivate
const privStore = vi.hoisted(() => {
  let data: any = { version: 1 }
  return {
    get: () => data,
    set: (v: any) => { data = v },
    read: vi.fn(async () => data),
    write: vi.fn(async (patch: any, opts: any) => {
      // 模拟 libraryPrivate 的浅合并 prefs 行为
      const next = { ...data, ...patch }
      if (patch.prefs && data.prefs) {
        next.prefs = { ...data.prefs, ...patch.prefs }
      }
      data = next
      return true
    }),
  }
})

vi.mock('../core/libraryPrivate', () => ({
  readLibraryPrivate: privStore.read,
  writeLibraryPrivate: privStore.write,
}))

import { createPluginScopedStorage } from './pluginHost'

describe('PR-5: createPluginScopedStorage', () => {
  beforeEach(() => {
    libStub.scope = { id: null, root: null, persisted: false }
    privStore.set({ version: 1 })
    privStore.read.mockClear()
    privStore.write.mockClear()
  })

  describe('get', () => {
    it('returns null when no library root', async () => {
      const store = createPluginScopedStorage('pluginA')
      const v = await store.get('k1')
      expect(v).toBeNull()
    })

    it('returns null when library has no persisted root', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: false }  // 临时库
      const store = createPluginScopedStorage('pluginA')
      const v = await store.get('k1')
      expect(v).toBeNull()
    })

    it('returns null when key does not exist', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { other: 'v' } } })
      const store = createPluginScopedStorage('pluginA')
      const v = await store.get('k1')
      expect(v).toBeNull()
    })

    it('returns the stored value', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'hello', k2: 42 } } })
      const store = createPluginScopedStorage('pluginA')
      expect(await store.get('k1')).toBe('hello')
      expect(await store.get('k2')).toBe(42)
    })

    it('isolates data between different plugins', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k: 'A' }, pluginB: { k: 'B' } } })
      const storeA = createPluginScopedStorage('pluginA')
      const storeB = createPluginScopedStorage('pluginB')
      expect(await storeA.get('k')).toBe('A')
      expect(await storeB.get('k')).toBe('B')
    })

    it('returns null when readLibraryPrivate throws', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.read.mockRejectedValueOnce(new Error('read failed'))
      const store = createPluginScopedStorage('pluginA')
      expect(await store.get('k1')).toBeNull()
    })
  })

  describe('set', () => {
    it('returns false when no library root', async () => {
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.set('k1', 'v1')
      expect(ok).toBe(false)
    })

    it('returns true and writes to libraryPrivate when persisted lib', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.set('k1', 'v1')
      expect(ok).toBe(true)
      expect(privStore.write).toHaveBeenCalled()
      expect(privStore.get().prefs.pluginA.k1).toBe('v1')
    })

    it('preserves existing keys in the same plugin scope', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k_existing: 'old' } } })
      const store = createPluginScopedStorage('pluginA')
      await store.set('k_new', 'new')
      expect(privStore.get().prefs.pluginA.k_existing).toBe('old')
      expect(privStore.get().prefs.pluginA.k_new).toBe('new')
    })

    it('isolates data between different plugins', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      const storeA = createPluginScopedStorage('pluginA')
      const storeB = createPluginScopedStorage('pluginB')
      await storeA.set('k', 'A')
      await storeB.set('k', 'B')
      expect(privStore.get().prefs.pluginA.k).toBe('A')
      expect(privStore.get().prefs.pluginB.k).toBe('B')
    })

    it('returns false when writeLibraryPrivate throws', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.write.mockRejectedValueOnce(new Error('write failed'))
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.set('k1', 'v1')
      expect(ok).toBe(false)
    })
  })

  describe('remove', () => {
    it('returns false when no library root', async () => {
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.remove('k1')
      expect(ok).toBe(false)
    })

    it('returns true and removes the key', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'v1', k2: 'v2' } } })
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.remove('k1')
      expect(ok).toBe(true)
      expect(privStore.get().prefs.pluginA.k1).toBeUndefined()
      expect(privStore.get().prefs.pluginA.k2).toBe('v2')
    })

    it('returns true (no-op) when key does not exist', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'v1' } } })
      const store = createPluginScopedStorage('pluginA')
      const ok = await store.remove('k_nonexistent')
      expect(ok).toBe(true)
    })

    it('does not touch other plugins data', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'A' }, pluginB: { k1: 'B' } } })
      const storeA = createPluginScopedStorage('pluginA')
      await storeA.remove('k1')
      expect(privStore.get().prefs.pluginA.k1).toBeUndefined()
      expect(privStore.get().prefs.pluginB.k1).toBe('B')
    })
  })

  describe('integration: round-trip', () => {
    it('set then get returns the same value', async () => {
      libStub.scope = { id: 'lib1', root: '/lib', persisted: true }
      const store = createPluginScopedStorage('pluginA')
      await store.set('k1', { nested: 'value', count: 3 })
      const v = await store.get('k1')
      expect(v).toEqual({ nested: 'value', count: 3 })
    })

    it('library switch resets visibility (no cross-library leak)', async () => {
      // Library A: set k1
      libStub.scope = { id: 'libA', root: '/libA', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'A-only' } } })
      const store = createPluginScopedStorage('pluginA')
      expect(await store.get('k1')).toBe('A-only')

      // Library B: same pluginId, different data
      libStub.scope = { id: 'libB', root: '/libB', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'B-only' } } })
      expect(await store.get('k1')).toBe('B-only')

      // Back to library A
      libStub.scope = { id: 'libA', root: '/libA', persisted: true }
      privStore.set({ version: 1, prefs: { pluginA: { k1: 'A-only' } } })
      expect(await store.get('k1')).toBe('A-only')
    })
  })
})
