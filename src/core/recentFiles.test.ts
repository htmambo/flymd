import { describe, it, expect, vi } from 'vitest'
import { getRecentFiles, pushRecentFile, RECENT_MAX, getLibraryCurrentFile, setLibraryCurrentFile, flushLibraryCurrentFile } from './recentFiles'

// 库作用域/config 存根：库相关用例通过 libStub.scope.root 模拟"当前有库"
const libStub = vi.hoisted(() => ({
  scope: { id: null as string | null, root: null as string | null, persisted: false },
  cfg: {} as Record<string, any>,
  writes: [] as any[],
}))
vi.mock('./libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./libraryConfig')>()
  return {
    ...actual,
    getLibraryScope: () => libStub.scope,
    readLibraryConfig: async () => libStub.cfg,
    writeLibraryConfig: async (patch: any) => {
      libStub.writes.push(patch)
      Object.assign(libStub.cfg, patch)
      return true
    },
  }
})

class FakeStore {
  private data: Record<string, any> = {}
  public saveCalls = 0
  public setCalls: Array<[string, any]> = []

  async get(key: string): Promise<any> {
    return this.data[key]
  }
  async set(key: string, value: any): Promise<void> {
    this.data[key] = value
    this.setCalls.push([key, value])
  }
  async save(): Promise<void> {
    this.saveCalls++
  }
  // test helper
  seed(key: string, value: any) {
    this.data[key] = value
  }
}

describe('getRecentFiles', () => {
  it('returns [] when store is null', async () => {
    expect(await getRecentFiles(null)).toEqual([])
  })
  it('returns [] when key is missing', async () => {
    const s = new FakeStore()
    expect(await getRecentFiles(s as any)).toEqual([])
  })
  it('returns [] when value is not an array', async () => {
    const s = new FakeStore()
    s.seed('recent', 'oops, string')
    expect(await getRecentFiles(s as any)).toEqual([])
  })
  it('returns array as-is when valid', async () => {
    const s = new FakeStore()
    s.seed('recent', ['/a.md', '/b.md'])
    expect(await getRecentFiles(s as any)).toEqual(['/a.md', '/b.md'])
  })
})

describe('pushRecentFile', () => {
  it('no-op when store is null', async () => {
    await pushRecentFile(null, '/a.md')
  })
  it('prepends new path', async () => {
    const s = new FakeStore()
    await pushRecentFile(s as any, '/a.md')
    expect(await getRecentFiles(s as any)).toEqual(['/a.md'])
  })
  it('deduplicates and moves to front', async () => {
    const s = new FakeStore()
    s.seed('recent', ['/a.md', '/b.md'])
    await pushRecentFile(s as any, '/a.md')
    expect(await getRecentFiles(s as any)).toEqual(['/a.md', '/b.md'])
  })
  it('caps at RECENT_MAX', async () => {
    const s = new FakeStore()
    s.seed('recent', ['/a', '/b', '/c', '/d', '/e'])
    await pushRecentFile(s as any, '/f')
    const list = await getRecentFiles(s as any)
    expect(list).toEqual(['/f', '/a', '/b', '/c', '/d']) // /e dropped
  })
  it('honors custom max', async () => {
    const s = new FakeStore()
    s.seed('recent', ['/a', '/b', '/c'])
    await pushRecentFile(s as any, '/d', 2)
    const list = await getRecentFiles(s as any)
    expect(list).toEqual(['/d', '/a'])
  })
  it('calls set and save on store', async () => {
    const s = new FakeStore()
    await pushRecentFile(s as any, '/a.md')
    expect(s.setCalls).toEqual([['recent', ['/a.md']]])
    expect(s.saveCalls).toBe(1)
  })
})

describe('getLibraryCurrentFile', () => {
  it('returns null when no library scope', async () => {
    libStub.scope.root = null
    libStub.cfg = { currentFile: 'a/b.md' }
    expect(await getLibraryCurrentFile()).toBeNull()
  })
  it('returns null when config has no currentFile', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = {}
    expect(await getLibraryCurrentFile()).toBeNull()
  })
  it('resolves library-relative path against root', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = { currentFile: 'a/b.md' }
    expect(await getLibraryCurrentFile()).toBe('/root/a/b.md')
  })
  it('keeps legacy absolute path as-is', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = { currentFile: '/elsewhere/x.md' }
    expect(await getLibraryCurrentFile()).toBe('/elsewhere/x.md')
  })
})

describe('setLibraryCurrentFile / flushLibraryCurrentFile', () => {
  it('ignores when no library scope', async () => {
    libStub.scope.root = null
    libStub.writes = []
    setLibraryCurrentFile('/root/a.md')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([])
  })
  it('ignores empty path (keeps previous record)', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = { currentFile: 'keep.md' }
    libStub.writes = []
    setLibraryCurrentFile(null)
    setLibraryCurrentFile('')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([])
  })
  it('ignores path outside library root', async () => {
    libStub.scope.root = '/root'
    libStub.writes = []
    setLibraryCurrentFile('/outside/x.md')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([])
  })
  it('writes library-relative path on flush', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = {}
    libStub.writes = []
    setLibraryCurrentFile('/root/dir/x.md')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([{ currentFile: 'dir/x.md' }])
  })
  it('coalesces rapid changes: only last value written', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = {}
    libStub.writes = []
    setLibraryCurrentFile('/root/a.md')
    setLibraryCurrentFile('/root/b.md')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([{ currentFile: 'b.md' }])
  })
  it('skips rewrite when value unchanged since last write', async () => {
    libStub.scope.root = '/root'
    libStub.cfg = {}
    libStub.writes = []
    setLibraryCurrentFile('/root/unique-value-guard.md')
    await flushLibraryCurrentFile()
    setLibraryCurrentFile('/root/unique-value-guard.md')
    await flushLibraryCurrentFile()
    expect(libStub.writes).toEqual([{ currentFile: 'unique-value-guard.md' }])
  })
})
