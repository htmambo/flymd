// deleteFileSafe 的越权防护。
//
// 该函数会递归销毁传入的任意路径，后端 move_to_trash / force_remove_path
// 不做任何根目录校验。此前唯一的防线是「调用方传的路径来自文件树
// dataset.path」这一假设 —— 而库根行同样带 dataset.path 且会出现在右键
// 菜单里，右键删除库根就能把整个库移入回收站。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn(async () => undefined)
const existsMock = vi.fn(async () => false)
const removeMock = vi.fn(async () => undefined)
const statMock = vi.fn(async () => ({ isDirectory: false }))
const readDirMock = vi.fn(async () => [] as any[])

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: existsMock,
  remove: removeMock,
  stat: statMock,
  readDir: readDirMock,
  writeTextFile: vi.fn(async () => undefined),
}))

const { deleteFileSafe } = await import('./libraryFileOps')

const ROOT = '/Users/me/notes'

describe('deleteFileSafe 越权防护', () => {
  beforeEach(() => {
    invokeMock.mockClear()
    existsMock.mockClear()
    removeMock.mockClear()
    readDirMock.mockClear()
    existsMock.mockResolvedValue(false as any)
  })

  it('拒绝删除库根本身', async () => {
    await expect(deleteFileSafe(ROOT, false, { root: ROOT })).rejects.toThrow(/拒绝删除库外路径/)
    expect(invokeMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('拒绝删除库外路径', async () => {
    await expect(deleteFileSafe('/Users/me/其他库/a.md', false, { root: ROOT })).rejects.toThrow(/拒绝删除库外路径/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('拒绝删除库外的同名兄弟目录（前缀相同但不在库内）', async () => {
    // /Users/me/notes-backup 不在 /Users/me/notes 之内
    await expect(deleteFileSafe('/Users/me/notes-backup', false, { root: ROOT })).rejects.toThrow(/拒绝删除库外路径/)
  })

  it('拒绝空路径', async () => {
    await expect(deleteFileSafe('', false, { root: ROOT })).rejects.toThrow(/删除路径为空/)
  })

  it('允许删除库内文件并走回收站', async () => {
    await deleteFileSafe(`${ROOT}/sub/a.md`, false, { root: ROOT })
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: `${ROOT}/sub/a.md`, root: ROOT })
  })

  it('允许删除库内目录', async () => {
    await deleteFileSafe(`${ROOT}/sub`, false, { root: ROOT })
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: `${ROOT}/sub`, root: ROOT })
  })

  it('把库根一并传给后端，供 move_to_trash / force_remove_path 做纵深校验', async () => {
    await deleteFileSafe(`${ROOT}/sub/a.md`, false, { root: ROOT })
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', {
      path: `${ROOT}/sub/a.md`,
      root: ROOT,
    })
  })

  it('未提供 root 时不做越权拦截（保持旧行为，供库外场景使用）', async () => {
    await deleteFileSafe('/tmp/scratch.md', false)
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: '/tmp/scratch.md', root: null })
  })

  it('root 为 null/空 时同样不拦截', async () => {
    await deleteFileSafe('/tmp/scratch.md', false, { root: null })
    expect(invokeMock).toHaveBeenCalledWith('move_to_trash', { path: '/tmp/scratch.md', root: null })
  })
})