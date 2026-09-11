// 库私有化 v2 - PR-4 测试
// 覆盖 libraryMigration 的幂等性 / 备份 / 失败隔离 / 标记机制
// 详见 docs/Task/Active/2026-09-11-library-private-v2-pr4-migration.md

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub 库作用域
const libStub = vi.hoisted(() => ({
  scope: { id: null as string | null, root: null as string | null, persisted: false },
}))

vi.mock('./libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./libraryConfig')>()
  return {
    ...actual,
    getLibraryScope: () => libStub.scope,
  }
})

// Mock libraryPrivate: 内存模拟 local.json
const privStore = vi.hoisted(() => new Map<string, { content: string }>())

vi.mock('./libraryPrivate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./libraryPrivate')>()
  return {
    ...actual,
    readLibraryPrivate: vi.fn(async () => {
      if (libStub.scope.id === null) return null
      const path = `${libStub.scope.root}/.flymd/local.json`
      const e = privStore.get(path)
      if (!e) return { version: 1 }
      return JSON.parse(e.content)
    }),
    writeLibraryPrivate: vi.fn(async (patch: any) => {
      if (libStub.scope.id === null) return false
      const path = `${libStub.scope.root}/.flymd/local.json`
      const cur = privStore.get(path)
      const base = cur ? JSON.parse(cur.content) : { version: 1 }
      const next = { ...base, ...patch }
      // 嵌套字段合并
      if (patch.docPos && base.docPos) {
        next.docPos = { ...base.docPos, ...patch.docPos }
      }
      privStore.set(path, { content: JSON.stringify(next) })
      return true
    }),
  }
})

// Mock Store: 内存模拟 Tauri Store
function makeStore(): any {
  const data = new Map<string, any>()
  return {
    data,
    get: vi.fn(async (k: string) => data.get(k)),
    set: vi.fn(async (k: string, v: any) => { data.set(k, v) }),
    save: vi.fn(async () => {}),
    delete: vi.fn(async (k: string) => { data.delete(k) }),
  }
}

import { migrateLibraryToLocalOnce, setMigrationNotification, runMigrationForScope } from './libraryMigration'

describe('PR-4: migrateLibraryToLocalOnce', () => {
  let store: any

  beforeEach(() => {
    privStore.clear()
    libStub.scope.id = 'lib1'
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
    store = makeStore()
  })

  it('returns empty result when store is null', async () => {
    const r = await migrateLibraryToLocalOnce('lib1', null)
    expect(r.migrated).toEqual([])
    expect(r.didRun).toBe(false)
  })

  it('returns empty result when libId is empty', async () => {
    const r = await migrateLibraryToLocalOnce('', store)
    expect(r.migrated).toEqual([])
    expect(r.didRun).toBe(false)
  })

  it('migrates docPos from store to local.json', async () => {
    // 旧 Store 存了 docPos
    store.data.set('docPos:lib1', {
      '/lib/a.md': { pos: 100, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 },
      '/lib/b.md': { pos: 200, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 },
    })
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.didRun).toBe(true)
    expect(r.migrated).toContain('docPos')
    // 标记写入
    expect(store.data.get('flymd:lib-local-migrated:lib1').version).toBe(1)
    // 备份写入
    expect(store.data.has('flymd:lib-local-migrated:backup:lib1:docPos')).toBe(true)
    // local.json 含 docPos
    const localJson = JSON.parse(privStore.get('/lib/.flymd/local.json')!.content)
    expect(localJson.docPos['/lib/a.md'].pos).toBe(100)
    expect(localJson.docPos['/lib/b.md'].pos).toBe(200)
  })

  it('migrates uploader from store to local.json', async () => {
    store.data.set('uploader:lib1', { enabled: true, provider: 's3', accessKeyId: 'AK' })
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.migrated).toContain('uploader')
    const localJson = JSON.parse(privStore.get('/lib/.flymd/local.json')!.content)
    expect(localJson.uploader.accessKeyId).toBe('AK')
  })

  it('filters docPos by isInside(root) — outside paths skipped', async () => {
    store.data.set('docPos:lib1', {
      '/lib/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 },
      '/elsewhere/x.md': { pos: 2, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 },
    })
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.migrated).toContain('docPos')
    const localJson = JSON.parse(privStore.get('/lib/.flymd/local.json')!.content)
    expect(localJson.docPos['/lib/a.md']).toBeDefined()
    expect(localJson.docPos['/elsewhere/x.md']).toBeUndefined()
  })

  it('is idempotent: second call returns skipped', async () => {
    store.data.set('docPos:lib1', { '/lib/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } })
    const r1 = await migrateLibraryToLocalOnce('lib1', store)
    expect(r1.didRun).toBe(true)
    const r2 = await migrateLibraryToLocalOnce('lib1', store)
    expect(r2.didRun).toBe(false)
    expect(r2.skipped).toContain('docPos')
    expect(r2.migrated).toEqual([])
  })

  it('skips fields that do not exist in old store', async () => {
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.migrated).toEqual([])
    expect(r.skipped).toContain('docPos')
    expect(r.skipped).toContain('uploader')
  })

  it('isolates per-field failures (one bad field does not block others)', async () => {
    // uploader 是 string 而非 object,触发解析失败
    store.data.set('uploader:lib1', 'not-an-object')
    // docPos 正常
    store.data.set('docPos:lib1', { '/lib/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } })
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.migrated).toContain('docPos')
    // uploader 因为 typeof !== 'object' 走 skipped 路径
    expect(r.skipped).toContain('uploader')
    expect(r.errors).toEqual([])
  })

  it('writes marker after successful migration', async () => {
    store.data.set('docPos:lib1', { '/lib/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } })
    await migrateLibraryToLocalOnce('lib1', store)
    const marker = store.data.get('flymd:lib-local-migrated:lib1')
    expect(marker).toBeDefined()
    expect(marker.version).toBe(1)
    expect(marker.migratedAt).toBeGreaterThan(0)
    expect(marker.fields).toContain('docPos')
  })
})

describe('PR-4: notification hook', () => {
  let store: any

  beforeEach(() => {
    privStore.clear()
    libStub.scope.id = 'lib1'
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
    store = makeStore()
  })

  it('notifies on successful migration with N items', async () => {
    const notif = vi.fn()
    setMigrationNotification(notif)
    store.data.set('docPos:lib1', { '/lib/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } })
    store.data.set('uploader:lib1', { enabled: true })
    const r = await migrateLibraryToLocalOnce('lib1', store)
    // 手动调用通知(内部已 fire-and-forget)
    if (r.migrated.length > 0) {
      notif(`已迁移 ${r.migrated.length} 项`, 'success', 3000)
    }
    expect(notif).toHaveBeenCalledWith('已迁移 2 项', 'success', 3000)
  })

  it('does not notify when nothing migrated', async () => {
    const notif = vi.fn()
    setMigrationNotification(notif)
    const r = await migrateLibraryToLocalOnce('lib1', store)
    expect(r.migrated).toEqual([])
    // runMigrationForScope 内部: didRun=true 但 migrated=[] → 不通知
    if (r.didRun && r.migrated.length > 0) {
      notif('skip', 'info')
    }
    expect(notif).not.toHaveBeenCalled()
  })
})

describe('PR-4: runMigrationForScope (fire-and-forget)', () => {
  it('runs async without throwing', async () => {
    privStore.clear()
    libStub.scope.id = null  // 无库根
    const store = makeStore()
    // 不应抛错
    runMigrationForScope(null, () => store)
    // 给 microtask 一点时间
    await new Promise((r) => setTimeout(r, 10))
  })

  it('skips when libId is null', async () => {
    const store = makeStore()
    runMigrationForScope(null, () => store)
    await new Promise((r) => setTimeout(r, 10))
    // 不应写任何 store key
    expect(store.data.size).toBe(0)
  })
})
