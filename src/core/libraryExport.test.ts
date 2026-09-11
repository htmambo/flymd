// 库私有化 v2 - PR-6 测试
// 覆盖 configBackup 的 includeLibraries 三种组合 + libraryExport helper
// 详见 docs/Task/Active/2026-09-11-library-private-v2-pr6-portable-backup.md

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @tauri-apps/plugin-fs
const mockFsData = new Map<string, Uint8Array>()
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async (p: string) => {
    const v = mockFsData.get(p)
    if (!v) throw new Error('not found: ' + p)
    return v
  }),
  writeTextFile: vi.fn(async (p: string, content: string) => {
    mockFsData.set(p, new TextEncoder().encode(content))
  }),
  writeFile: vi.fn(async (p: string, data: Uint8Array) => {
    mockFsData.set(p, data)
  }),
  readDir: vi.fn(async () => []),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  exists: vi.fn(async (p: string) => mockFsData.has(p)),
  BaseDirectory: { AppData: 1, AppLocalData: 2, AppConfig: 3 },
}))

import { collectConfigBackupFiles, bytesToBase64 } from './configBackup'
import { exportLibraryConfig, hasLibraryCredentials } from './libraryExport'

describe('PR-6: collectConfigBackupFiles with includeLibraries', () => {
  beforeEach(() => {
    mockFsData.clear()
  })

  it('default: does not include any library files', async () => {
    // 模拟库内文件存在
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{"recent":["a.md"]}'))
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{"uploader":{"enabled":true}}'))
    const { files } = await collectConfigBackupFiles()
    const libFiles = files.filter((f) => f.path.includes('libraryConfig') || f.path.includes('libraryLocal'))
    expect(libFiles).toHaveLength(0)
  })

  it('includeLibraries with no creds: includes config.json only', async () => {
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{"recent":["a.md"]}'))
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{"uploader":{"enabled":true}}'))
    const { files } = await collectConfigBackupFiles({
      includeLibraries: [{ id: 'lib1', root: '/lib' }],  // no includeCredentials
    })
    const libCfg = files.find((f) => f.path === 'libraryConfig:lib1/config.json')
    const libLocal = files.find((f) => f.path === 'libraryLocal:lib1/local.json')
    expect(libCfg).toBeDefined()
    expect(libLocal).toBeUndefined()  // 没勾选凭据就不包含
  })

  it('includeLibraries with creds: includes both config.json and local.json', async () => {
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{"recent":["a.md"]}'))
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{"uploader":{"enabled":true}}'))
    const { files } = await collectConfigBackupFiles({
      includeLibraries: [{ id: 'lib1', root: '/lib', includeCredentials: true }],
    })
    const libCfg = files.find((f) => f.path === 'libraryConfig:lib1/config.json')
    const libLocal = files.find((f) => f.path === 'libraryLocal:lib1/local.json')
    expect(libCfg).toBeDefined()
    expect(libLocal).toBeDefined()
  })

  it('handles missing config.json gracefully', async () => {
    // local.json 存在但 config.json 不存在
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{}'))
    const { files } = await collectConfigBackupFiles({
      includeLibraries: [{ id: 'lib1', root: '/lib', includeCredentials: true }],
    })
    const libCfg = files.find((f) => f.path === 'libraryConfig:lib1/config.json')
    expect(libCfg).toBeUndefined()  // 缺失不报错
  })

  it('multi-library: appends entries per library', async () => {
    mockFsData.set('/libA/.flymd/config.json', new TextEncoder().encode('{"id":"A"}'))
    mockFsData.set('/libB/.flymd/config.json', new TextEncoder().encode('{"id":"B"}'))
    const { files } = await collectConfigBackupFiles({
      includeLibraries: [
        { id: 'libA', root: '/libA' },
        { id: 'libB', root: '/libB' },
      ],
    })
    expect(files.find((f) => f.path === 'libraryConfig:libA/config.json')).toBeDefined()
    expect(files.find((f) => f.path === 'libraryConfig:libB/config.json')).toBeDefined()
  })

  it('skips entries with missing id or root', async () => {
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{}'))
    const { files } = await collectConfigBackupFiles({
      includeLibraries: [
        { id: '', root: '/lib' },
        { id: 'lib1', root: '' },
      ] as any,
    })
    const libFiles = files.filter((f) => f.path.startsWith('libraryConfig:'))
    expect(libFiles).toHaveLength(0)
  })
})

describe('PR-6: exportLibraryConfig', () => {
  beforeEach(() => {
    mockFsData.clear()
  })

  it('writes .flymdconfig with targetPath override (no dialog)', async () => {
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{"recent":["a.md"]}'))
    const result = await exportLibraryConfig({
      libId: 'lib1',
      libRoot: '/lib',
      mode: 'noCredentials',
      targetPath: '/tmp/export.flymdconfig',
    })
    expect(result).not.toBeNull()
    expect(result?.path).toBe('/tmp/export.flymdconfig')
    expect(result?.fileCount).toBe(1)
    // 验证文件内容含 config.json
    const written = mockFsData.get('/tmp/export.flymdconfig')
    expect(written).toBeDefined()
    const payload = JSON.parse(new TextDecoder().decode(written!))
    expect(payload.files.some((f: any) => f.path === 'libraryConfig:lib1/config.json')).toBe(true)
    expect(payload.files.some((f: any) => f.path === 'libraryLocal:lib1/local.json')).toBe(false)
  })

  it('withCredentials includes local.json', async () => {
    mockFsData.set('/lib/.flymd/config.json', new TextEncoder().encode('{}'))
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{"uploader":{"enabled":true}}'))
    const result = await exportLibraryConfig({
      libId: 'lib1',
      libRoot: '/lib',
      mode: 'withCredentials',
      targetPath: '/tmp/export.flymdconfig',
    })
    expect(result?.fileCount).toBe(2)
  })

  it('returns null when libId is empty', async () => {
    const result = await exportLibraryConfig({
      libId: '',
      libRoot: '/lib',
      mode: 'noCredentials',
      targetPath: '/tmp/x',
    })
    expect(result).toBeNull()
  })

  it('returns null when lib has no files', async () => {
    const result = await exportLibraryConfig({
      libId: 'lib1',
      libRoot: '/nonexistent',
      mode: 'noCredentials',
      targetPath: '/tmp/x',
    })
    expect(result).toBeNull()
  })
})

describe('PR-6: hasLibraryCredentials', () => {
  beforeEach(() => {
    mockFsData.clear()
  })

  it('returns false when local.json does not exist', async () => {
    const result = await hasLibraryCredentials('/lib')
    expect(result).toBe(false)
  })

  it('returns false when local.json is empty {}', async () => {
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{}'))
    const result = await hasLibraryCredentials('/lib')
    expect(result).toBe(false)
  })

  it('returns true when local.json has content', async () => {
    mockFsData.set('/lib/.flymd/local.json', new TextEncoder().encode('{"uploader":{"enabled":true}}'))
    const result = await hasLibraryCredentials('/lib')
    expect(result).toBe(true)
  })
})
