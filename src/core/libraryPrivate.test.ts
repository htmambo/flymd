// 库私有化 v2 - PR-3 测试
// 覆盖 libraryPrivate 框架的读 / 写 / 防抖 / flush / 缓存失效 / 路径 / schema
// 详见 docs/Task/Active/2026-09-11-library-private-v2-pr3-libraryprivate.md

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub 库作用域：libStub.scope.root 模拟"当前有库"
const libStub = vi.hoisted(() => ({
  scope: { id: null as string | null, root: null as string | null, persisted: false },
}))

vi.mock('./libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./libraryConfig')>()
  return {
    ...actual,
    getLibraryScope: () => libStub.scope,
    invalidateLibraryConfigCache: vi.fn(),
  }
})

// Mock fsSafe：内存模拟 read / write
const fileStore = vi.hoisted(() => new Map<string, { mtime: number; content: string }>())
const lockOps = vi.hoisted(() => [] as Array<{ op: string; path: string }>)

vi.mock('./fsSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fsSafe')>()
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    readTextFileAnySafe: vi.fn(async (p: string) => {
      const e = fileStore.get(p)
      if (!e) throw new Error('not found: ' + p)
      return e.content
    }),
    statFileAnySafe: vi.fn(async (p: string) => {
      const e = fileStore.get(p)
      if (!e) return null
      return { mtimeMs: e.mtime, size: e.content.length }
    }),
    writeFileLockedSafe: vi.fn(async (p: string, content: string) => {
      lockOps.push({ op: 'write_locked', path: p })
      fileStore.set(p, { mtime: Date.now(), content })
    }),
    writeFileAtomicSafe: vi.fn(async (p: string, content: string) => {
      fileStore.set(p, { mtime: Date.now(), content })
    }),
  }
})

import {
  readLibraryPrivate,
  writeLibraryPrivate,
  flushLibraryPrivate,
  invalidateLibraryPrivateCache,
  libraryPrivateFilePath,
  LIBRARY_PRIVATE_SCHEMA_VERSION,
  LIBRARY_PRIVATE_CHANGED_EVENT,
} from './libraryPrivate'

describe('PR-3: libraryPrivateFilePath', () => {
  it('appends /.flymd/local.json to root', () => {
    expect(libraryPrivateFilePath('/root')).toBe('/root/.flymd/local.json')
    // 尾部斜杠会被 strip
    expect(libraryPrivateFilePath('/root/')).toBe('/root/.flymd/local.json')
  })

  it('handles backslashes on Windows (mixed separator, same as libraryConfig)', () => {
    // 与 libraryConfig.ts:124-126 一致：strip 末尾分隔符但保留 \\ 与 / 共存
    // 这是 flymd 在 Windows 上的实际行为
    expect(libraryPrivateFilePath('C:\\notes\\')).toBe('C:\\notes/.flymd/local.json')
  })
})

describe('PR-3: readLibraryPrivate', () => {
  beforeEach(() => {
    fileStore.clear()
    lockOps.length = 0
    invalidateLibraryPrivateCache()
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
    libStub.scope.id = 'lib1'
  })

  it('returns null when no library root', async () => {
    libStub.scope.root = null
    const data = await readLibraryPrivate()
    expect(data).toBeNull()
  })

  it('returns empty version-1 data when file does not exist', async () => {
    const data = await readLibraryPrivate()
    expect(data).toEqual({ version: LIBRARY_PRIVATE_SCHEMA_VERSION })
  })

  it('parses existing local.json correctly', async () => {
    fileStore.set('/lib/.flymd/local.json', {
      mtime: Date.now(),
      content: JSON.stringify({ version: 1, docPos: { '/a.md': { pos: 10, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }),
    })
    invalidateLibraryPrivateCache()  // 让重新读
    const data = await readLibraryPrivate()
    expect(data?.version).toBe(1)
    expect(data?.docPos?.['/a.md']?.pos).toBe(10)
  })

  it('coerces missing version to current schema', async () => {
    fileStore.set('/lib/.flymd/local.json', {
      mtime: Date.now(),
      content: JSON.stringify({ docPos: {} }),
    })
    invalidateLibraryPrivateCache()
    const data = await readLibraryPrivate()
    expect(data?.version).toBe(LIBRARY_PRIVATE_SCHEMA_VERSION)
  })

  it('caches result on second read', async () => {
    await readLibraryPrivate()
    // 改底层文件但不清缓存
    fileStore.set('/lib/.flymd/local.json', {
      mtime: Date.now(),
      content: JSON.stringify({ version: 1, docPos: { '/b.md': { pos: 5, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }),
    })
    const data = await readLibraryPrivate()  // 命中缓存
    expect(data?.docPos?.['/b.md']).toBeUndefined()
  })
})

describe('PR-3: writeLibraryPrivate (immediate mode)', () => {
  beforeEach(() => {
    fileStore.clear()
    lockOps.length = 0
    invalidateLibraryPrivateCache()
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('returns false when no library root', async () => {
    libStub.scope.root = null
    const ok = await writeLibraryPrivate({ uploader: { enabled: true } }, { immediate: true })
    expect(ok).toBe(false)
  })

  it('writes to locked file (PR-2 基础设施) and updates cache', async () => {
    const ok = await writeLibraryPrivate({ docPos: { '/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }, { immediate: true })
    expect(ok).toBe(true)
    expect(lockOps).toContainEqual({ op: 'write_locked', path: '/lib/.flymd/local.json' })
    // 缓存已更新
    const data = await readLibraryPrivate()
    expect(data?.docPos?.['/a.md']?.pos).toBe(1)
  })

  it('merges with disk latest value (no overwrite)', async () => {
    fileStore.set('/lib/.flymd/local.json', {
      mtime: Date.now(),
      content: JSON.stringify({ version: 1, docPos: { '/existing.md': { pos: 100, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }),
    })
    invalidateLibraryPrivateCache()
    await writeLibraryPrivate({ docPos: { '/new.md': { pos: 5, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }, { immediate: true })
    const data = await readLibraryPrivate()
    expect(data?.docPos?.['/existing.md']?.pos).toBe(100)
    expect(data?.docPos?.['/new.md']?.pos).toBe(5)
  })

  it('preserves version field on write', async () => {
    await writeLibraryPrivate({ uploader: null }, { immediate: true })
    const data = await readLibraryPrivate()
    expect(data?.version).toBe(LIBRARY_PRIVATE_SCHEMA_VERSION)
  })
})

describe('PR-3: writeLibraryPrivate (debounced mode)', () => {
  beforeEach(() => {
    fileStore.clear()
    lockOps.length = 0
    invalidateLibraryPrivateCache()
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('coalesces rapid writes into one disk write', async () => {
    vi.useFakeTimers()
    try {
      const p1 = writeLibraryPrivate({ docPos: { '/a.md': { pos: 1, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } })
      const p2 = writeLibraryPrivate({ docPos: { '/b.md': { pos: 2, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } })
      const p3 = writeLibraryPrivate({ uploader: { enabled: true } })
      // 防抖期内未落盘
      expect(lockOps.filter((o) => o.op === 'write_locked')).toHaveLength(0)
      // 推进时间
      await vi.advanceTimersByTimeAsync(600)
      await Promise.all([p1, p2, p3])
      // 合并成 1 次写
      expect(lockOps.filter((o) => o.op === 'write_locked')).toHaveLength(1)
      const data = await readLibraryPrivate()
      expect(data?.docPos?.['/a.md']?.pos).toBe(1)
      expect(data?.docPos?.['/b.md']?.pos).toBe(2)
      expect(data?.uploader?.enabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PR-3: flushLibraryPrivate', () => {
  beforeEach(() => {
    fileStore.clear()
    lockOps.length = 0
    invalidateLibraryPrivateCache()
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('flushes pending debounced write immediately', async () => {
    const p = writeLibraryPrivate({ uploader: { enabled: true } })
    // flush 强制立即写
    await flushLibraryPrivate()
    await p
    expect(lockOps.filter((o) => o.op === 'write_locked')).toHaveLength(1)
  })
})

describe('PR-3: invalidateLibraryPrivateCache', () => {
  beforeEach(() => {
    fileStore.clear()
    lockOps.length = 0
    invalidateLibraryPrivateCache()
    libStub.scope.root = '/lib'
    libStub.scope.persisted = true
  })

  it('forces next read to hit disk', async () => {
    await readLibraryPrivate()
    fileStore.set('/lib/.flymd/local.json', {
      mtime: Date.now(),
      content: JSON.stringify({ version: 1, docPos: { '/x.md': { pos: 999, scroll: 0, pscroll: 0, mode: 'edit', ts: 0 } } }),
    })
    invalidateLibraryPrivateCache()
    const data = await readLibraryPrivate()
    expect(data?.docPos?.['/x.md']?.pos).toBe(999)
  })
})

describe('PR-3: LIBRARY_PRIVATE_CHANGED_EVENT constant', () => {
  it('has the expected name', () => {
    expect(LIBRARY_PRIVATE_CHANGED_EVENT).toBe('flymd:libraryPrivate:changed')
  })
})
