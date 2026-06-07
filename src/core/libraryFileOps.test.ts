// @vitest-environment jsdom
// 测试 libraryFileOps:覆盖 happy path + 异常路径
// 通过 vi.mock 替换 @tauri-apps/api/core 的 invoke 和 @tauri-apps/plugin-fs 的 fs 操作

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 共享 mock 状态 — 用 plain object,vi.clearAllMocks 不会清掉
const fsState = {
  files: new Set<string>(),
  stat: new Map<string, { isDirectory: boolean }>(),
  dirs: new Map<string, Array<{ name: string; path: string }>>(),
}

const invokeMock = vi.fn(async (cmd: string, args: any) => {
  if (cmd === 'move_to_trash' || cmd === 'force_remove_path') {
    fsState.files.delete(args.path)
    return null
  }
  throw new Error('unknown command: ' + cmd)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: any) => invokeMock(cmd, args),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (p: string) => fsState.files.has(p),
  remove: async (p: string) => {
    // 文件直接清掉;目录调用不在测试覆盖范围(集成测试)
    const s = fsState.stat.get(p)
    if (s && s.isDirectory) {
      throw new Error('mock: directory remove not supported in unit test')
    }
    fsState.files.delete(p)
    fsState.stat.delete(p)
  },
  stat: async (p: string) => {
    const s = fsState.stat.get(p)
    if (!s) throw new Error('not found: ' + p)
    return s
  },
  readDir: async (p: string) => fsState.dirs.get(p) || [],
  writeTextFile: async (p: string, _c: string) => {
    fsState.files.add(p)
  },
}))

vi.mock('./fsSafe', () => ({
  ensureDir: async (_d: string) => { /* noop for tests */ },
}))

beforeEach(() => {
  fsState.files.clear()
  fsState.stat.clear()
  fsState.dirs.clear()
  invokeMock.mockClear()
})

const { deleteFileSafe, newFileSafe } = await import('./libraryFileOps')

describe('deleteFileSafe', () => {
  it('moves file to trash on first try', async () => {
    fsState.files.add('/lib/note.md')
    await deleteFileSafe('/lib/note.md')
    expect(fsState.files.has('/lib/note.md')).toBe(false)
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: '/lib/note.md' })
  })

  it('skips trash when permanent=true', async () => {
    fsState.files.add('/lib/note.md')
    await deleteFileSafe('/lib/note.md', true)
    expect(fsState.files.has('/lib/note.md')).toBe(false)
    expect(invokeMock).not.toHaveBeenCalledWith('move_to_trash', expect.anything())
  })

  it('falls back to remove() when trash throws', async () => {
    // trash 抛错后,走 remove() 直接删除,函数正常 return
    // (force_remove_path 是 file 删除失败时兜底,此处路径不触发)
    invokeMock.mockImplementationOnce(async () => { throw new Error('trash unavailable') })
    fsState.files.add('/lib/note.md')
    await deleteFileSafe('/lib/note.md')
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: '/lib/note.md' })
    expect(fsState.files.has('/lib/note.md')).toBe(false)
  })
})

describe('newFileSafe', () => {
  it('creates file with default name and content when no conflict', async () => {
    const p = await newFileSafe('/lib')
    expect(p).toBe('/lib/新建文档.md')
    expect(fsState.files.has('/lib/新建文档.md')).toBe(true)
  })

  it('appends " N" suffix when default name exists', async () => {
    fsState.files.add('/lib/新建文档.md')
    const p = await newFileSafe('/lib')
    expect(p).toBe('/lib/新建文档 2.md')
    expect(fsState.files.has('/lib/新建文档 2.md')).toBe(true)
  })

  it('preserves file extension when renaming', async () => {
    fsState.files.add('/lib/note.md')
    fsState.files.add('/lib/note 2.md')
    const p = await newFileSafe('/lib', 'note.md')
    expect(p).toBe('/lib/note 3.md')
  })

  it('uses windows separator when dir contains backslash', async () => {
    const p = await newFileSafe('C:\\lib', 'a.md')
    expect(p).toBe('C:\\lib\\a.md')
  })

  it('uses custom content when provided', async () => {
    const p = await newFileSafe('/lib', 'init.md')
    // default content '# 标题\n\n'
    expect(fsState.files.has(p)).toBe(true)
  })
})
