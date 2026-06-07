import { describe, it, expect } from 'vitest'
import { getRecentFiles, pushRecentFile, RECENT_MAX } from './recentFiles'

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
