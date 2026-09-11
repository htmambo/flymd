// 库私有化 v2 - PR-2 测试
// 覆盖 fsSafe.ts 新增的 6 个 PR-2 包装函数：atomic write / cleanup / lock / read-locked / write-locked
// 详见 docs/Task/Active/2026-09-11-library-private-v2-pr2-rust-atomic-lock.md

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @tauri-apps/api/core 的 invoke
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

// Mock @tauri-apps/plugin-fs 的 writeFile 和 stat
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => new Uint8Array()),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ mtimeMs: Date.now(), size: 0 })),
}))

import {
  writeFileAtomicSafe,
  cleanupStaleTmpFilesSafe,
  tryLockFileSafe,
  unlockFileSafe,
  readFileLockedSafe,
  writeFileLockedSafe,
} from './fsSafe'

describe('PR-2: writeFileAtomicSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('calls backend write_file_atomic with path and content', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    await writeFileAtomicSafe('/tmp/foo.json', '{"a":1}')
    expect(invokeMock).toHaveBeenCalledWith('write_file_atomic', {
      path: '/tmp/foo.json',
      content: '{"a":1}',
    })
  })

  it('falls back to writeFile when backend throws', async () => {
    invokeMock.mockRejectedValueOnce(new Error('backend not available'))
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFileAtomicSafe('/tmp/bar.json', '{}')
    expect(writeFile).toHaveBeenCalled()
  })
})

describe('PR-2: cleanupStaleTmpFilesSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('returns count from backend', async () => {
    invokeMock.mockResolvedValueOnce(3)
    const n = await cleanupStaleTmpFilesSafe('/root')
    expect(n).toBe(3)
    expect(invokeMock).toHaveBeenCalledWith('cleanup_stale_tmp_files', { root: '/root' })
  })

  it('returns 0 when backend throws (fault tolerant)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('backend error'))
    const n = await cleanupStaleTmpFilesSafe('/root')
    expect(n).toBe(0)
  })

  it('returns 0 when backend returns 0 (empty .flymd dir)', async () => {
    invokeMock.mockResolvedValueOnce(0)
    const n = await cleanupStaleTmpFilesSafe('/root')
    expect(n).toBe(0)
  })
})

describe('PR-2: tryLockFileSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('returns token string from backend', async () => {
    invokeMock.mockResolvedValueOnce('abc-123')
    const token = await tryLockFileSafe('/tmp/file.json', 1000)
    expect(token).toBe('abc-123')
    expect(invokeMock).toHaveBeenCalledWith('try_lock_file', {
      path: '/tmp/file.json',
      timeoutMs: 1000,
    })
  })

  it('uses default timeout of 5000ms when not specified', async () => {
    invokeMock.mockResolvedValueOnce('tok')
    await tryLockFileSafe('/tmp/file.json')
    expect(invokeMock).toHaveBeenCalledWith('try_lock_file', {
      path: '/tmp/file.json',
      timeoutMs: 5000,
    })
  })

  it('throws on empty token', async () => {
    invokeMock.mockResolvedValueOnce('')
    await expect(tryLockFileSafe('/tmp/file.json')).rejects.toThrow(/empty token/)
  })

  it('throws on non-string token', async () => {
    invokeMock.mockResolvedValueOnce(null)
    await expect(tryLockFileSafe('/tmp/file.json')).rejects.toThrow(/empty token/)
  })

  it('propagates backend errors (e.g. lock timeout)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('Lock timeout after 5000ms'))
    await expect(tryLockFileSafe('/tmp/file.json', 5000)).rejects.toThrow(/Lock timeout/)
  })
})

describe('PR-2: unlockFileSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('calls unlock_file with token', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    await unlockFileSafe('tok-1')
    expect(invokeMock).toHaveBeenCalledWith('unlock_file', { token: 'tok-1' })
  })

  it('silently swallows backend errors (best-effort cleanup)', async () => {
    invokeMock.mockRejectedValueOnce(new Error('token not found'))
    // 不应抛出
    await expect(unlockFileSafe('bad-tok')).resolves.toBeUndefined()
  })
})

describe('PR-2: readFileLockedSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('calls read_file_locked with path and timeout', async () => {
    invokeMock.mockResolvedValueOnce('content')
    const result = await readFileLockedSafe('/tmp/x.json', 3000)
    expect(result).toBe('content')
    expect(invokeMock).toHaveBeenCalledWith('read_file_locked', {
      path: '/tmp/x.json',
      timeoutMs: 3000,
    })
  })
})

describe('PR-2: writeFileLockedSafe', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('calls write_file_locked with path, content, timeout', async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    await writeFileLockedSafe('/tmp/y.json', '{"k":"v"}', 2000)
    expect(invokeMock).toHaveBeenCalledWith('write_file_locked', {
      path: '/tmp/y.json',
      content: '{"k":"v"}',
      timeoutMs: 2000,
    })
  })
})

describe('PR-2: integration smoke', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('lock + write + unlock flow invokes correct backend commands in order', async () => {
    invokeMock
      .mockResolvedValueOnce('tok-1') // try_lock_file
      .mockResolvedValueOnce(undefined) // write_file_locked
      .mockResolvedValueOnce(undefined) // unlock_file

    const token = await tryLockFileSafe('/tmp/flow.json', 1000)
    expect(token).toBe('tok-1')
    await writeFileLockedSafe('/tmp/flow.json', '{}', 1000)
    await unlockFileSafe(token)

    // 校验调用顺序（前 3 个必须按 lock → write → unlock）
    const commands = invokeMock.mock.calls.map((c) => c[0])
    expect(commands.slice(0, 3)).toEqual([
      'try_lock_file',
      'write_file_locked',
      'unlock_file',
    ])
  })
})
