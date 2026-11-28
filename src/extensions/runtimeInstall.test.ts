// 插件安装链路集成测试：hostile manifest / hostile 目录条目
//
// 目的：把 pluginPath 的纯函数净化和 runtime.ts 的安装流程串起来验证，
// 确认恶意输入不会突破 `${PLUGINS_DIR}/<id>` 边界。
// Tauri 侧全部用内存实现替换：plugin-fs 提供假文件系统，plugin-http 提供路由表。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; data: unknown }>,
  files: new Map<string, string>(),
  dirs: new Map<string, any[]>(),
}))

const net = vi.hoisted(() => ({
  routes: new Map<string, string | Uint8Array>(),
  calls: [] as string[],
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppLocalData: 1 },
  mkdir: async () => {},
  writeTextFile: async (p: string, data: string) => {
    mem.writes.push({ path: p, data })
  },
  writeFile: async (p: string, data: unknown) => {
    mem.writes.push({ path: p, data })
  },
  readTextFile: async (p: string) => {
    const v = mem.files.get(p)
    if (v === undefined) throw new Error('ENOENT ' + p)
    return v
  },
  readFile: async (p: string) => {
    const v = mem.files.get(p)
    if (v === undefined) throw new Error('ENOENT ' + p)
    return new TextEncoder().encode(v)
  },
  readDir: async (p: string) => {
    const v = mem.dirs.get(p)
    if (!v) throw new Error('ENOENT ' + p)
    return v
  },
  remove: async () => {},
  exists: async () => false,
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  ResponseType: { Text: 1, Binary: 2 },
  Body: class {},
  fetch: async (url: string) => {
    net.calls.push(url)
    const body = net.routes.get(url)
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const isBin = body instanceof Uint8Array
    return {
      ok: true,
      status: 200,
      text: async () => (isBin ? '' : String(body)),
      arrayBuffer: async () =>
        isBin
          ? body.buffer
          : new TextEncoder().encode(String(body)).buffer,
      data: body,
    }
  },
}))

vi.mock('../core/logger', () => ({ logInfo: () => {}, logDebug: () => {} }))

vi.mock('../core/libraryConfig', () => ({
  getLibraryScope: () => ({ id: null, root: null, persisted: false }),
  readLibraryConfig: async () => null,
  writeLibraryConfig: async () => true,
}))

import {
  installPluginFromGitCore,
  installPluginFromLocalCore,
  normalizePluginPermissions,
  PLUGIN_PERMISSIONS,
  MAX_PLUGIN_ASSETS,
  MAX_PLUGIN_ASSET_BYTES,
  MAX_PLUGIN_MAIN_CHARS,
  MAX_PLUGIN_MANIFEST_CHARS,
} from './runtime'

const APP_VERSION = '9.9.9'
const PLUGINS_PREFIX = 'flymd/plugins/'

function makeStore() {
  const data = new Map<string, any>()
  return {
    get: async (k: string) => data.get(k),
    set: async (k: string, v: any) => {
      data.set(k, v)
    },
    save: async () => {},
  } as any
}

function assertAllWritesInside(dirPrefix: string) {
  for (const w of mem.writes) {
    expect(w.path.startsWith(dirPrefix), w.path).toBe(true)
    expect(w.path.includes('..'), w.path).toBe(false)
  }
}

beforeEach(() => {
  mem.writes.length = 0
  mem.files.clear()
  mem.dirs.clear()
  net.routes.clear()
  net.calls.length = 0
})

describe('normalizePluginPermissions', () => {
  it('只保留已知权限枚举并去重', () => {
    expect(normalizePluginPermissions(['fs.read', 'net', 'fs.read', 'ui'])).toEqual(['fs.read', 'net', 'ui'])
  })

  it('非数组、非字符串、未知项、超长数组均被忽略', () => {
    expect(normalizePluginPermissions(undefined)).toEqual([])
    expect(normalizePluginPermissions('fs.read')).toEqual([])
    expect(normalizePluginPermissions([1, null, 'fs.exec', 'all'])).toEqual([])
    expect(normalizePluginPermissions([...PLUGIN_PERMISSIONS, ...PLUGIN_PERMISSIONS])).toEqual([...PLUGIN_PERMISSIONS])
  })
})

describe('installPluginFromGitCore — hostile manifest', () => {
  it('id 含路径穿越时拒绝，且不写任何文件', async () => {
    net.routes.set(
      'https://example.test/p/manifest.json',
      JSON.stringify({ id: '../evil', name: 'x' }),
    )
    await expect(
      installPluginFromGitCore('https://example.test/p/manifest.json', undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/id 非法/)
    expect(mem.writes).toHaveLength(0)
    // 净化在下载 main 之前，恶意 id 不应触发任何额外请求
    expect(net.calls).toEqual(['https://example.test/p/manifest.json'])
  })

  it('main 含 .. 时拒绝，且不写任何文件', async () => {
    net.routes.set(
      'https://example.test/p/manifest.json',
      JSON.stringify({ id: 'good-plugin', main: '../../x.js' }),
    )
    await expect(
      installPluginFromGitCore('https://example.test/p/manifest.json', undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/非法段/)
    expect(mem.writes).toHaveLength(0)
  })

  it('恶意 assets 被跳过，合法资源落在插件目录内', async () => {
    const base = 'https://example.test/p/'
    net.routes.set(
      base + 'manifest.json',
      JSON.stringify({
        id: 'good-plugin',
        main: 'js/main.js',
        assets: ['../escape.png', 'C:/abs.png', 'CON.png', 'img/logo.png', 'ok.png'],
      }),
    )
    net.routes.set(base + 'js/main.js', 'console.log("ok")')
    net.routes.set(base + 'img/logo.png', new Uint8Array([1, 2, 3]))
    net.routes.set(base + 'ok.png', new Uint8Array([4]))

    const store = makeStore()
    const record = await installPluginFromGitCore(base, undefined, {
      appVersion: APP_VERSION,
      store,
    })

    expect(record.id).toBe('good-plugin')
    expect(record.main).toBe('js/main.js')
    expect(record.dir).toBe(PLUGINS_PREFIX + 'good-plugin')
    assertAllWritesInside(PLUGINS_PREFIX + 'good-plugin/')
    expect(net.calls).not.toContain(base + 'escape.png')
    expect(net.calls).not.toContain(base + 'abs.png')

    const paths = mem.writes.map((w) => w.path).sort()
    expect(paths).toEqual([
      PLUGINS_PREFIX + 'good-plugin/img/logo.png',
      PLUGINS_PREFIX + 'good-plugin/js/main.js',
      PLUGINS_PREFIX + 'good-plugin/manifest.json',
      PLUGINS_PREFIX + 'good-plugin/ok.png',
    ])
  })
})

describe('installPluginFromLocalCore — hostile 源目录', () => {
  it('穿越条目名与符号链接被跳过，合法文件复制到插件目录内', async () => {
    const src = '/tmp/src/evil'
    mem.dirs.set(src, [
      { name: 'main.js' },
      { name: '..' },
      { name: 'a/b.js' },
      { name: 'win' },
      { name: 'link', isSymlink: true },
      { name: 'logo.png' },
    ])
    mem.files.set(src + '/manifest.json', JSON.stringify({ id: 'local-plugin', main: 'main.js' }))
    mem.files.set(src + '/main.js', 'console.log(1)')
    mem.files.set(src + '/a/b.js', 'must-not-copy')
    mem.files.set(src + '/logo.png', 'png')

    const record = await installPluginFromLocalCore(src, undefined, {
      appVersion: APP_VERSION,
      store: makeStore(),
    })

    expect(record.id).toBe('local-plugin')
    expect(record.dir).toBe(PLUGINS_PREFIX + 'local-plugin')
    assertAllWritesInside(PLUGINS_PREFIX + 'local-plugin/')

    const paths = mem.writes.map((w) => w.path).sort()
    expect(paths).toEqual([
      PLUGINS_PREFIX + 'local-plugin/logo.png',
      PLUGINS_PREFIX + 'local-plugin/main.js',
    ])
    expect(paths.some((p) => p.includes('must-not-copy'))).toBe(false)
  })

  it('manifest id 含穿越时拒绝且不复制任何文件', async () => {
    const src = '/tmp/src/evil2'
    mem.dirs.set(src, [{ name: 'main.js' }])
    mem.files.set(src + '/manifest.json', JSON.stringify({ id: '..' }))
    mem.files.set(src + '/main.js', 'console.log(1)')

    await expect(
      installPluginFromLocalCore(src, undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/id 非法/)
    expect(mem.writes).toHaveLength(0)
  })
})

describe('安装体积上限', () => {
  it('manifest 过大时拒绝且不写文件', async () => {
    net.routes.set(
      'https://example.test/p/manifest.json',
      'x'.repeat(MAX_PLUGIN_MANIFEST_CHARS + 1),
    )
    await expect(
      installPluginFromGitCore('https://example.test/p/manifest.json', undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/manifest\.json 过大/)
    expect(mem.writes).toHaveLength(0)
  })

  it('主文件过大时拒绝且不写文件', async () => {
    const base = 'https://example.test/p/'
    net.routes.set(base + 'manifest.json', JSON.stringify({ id: 'big-plugin', main: 'main.js' }))
    net.routes.set(base + 'main.js', 'a'.repeat(MAX_PLUGIN_MAIN_CHARS + 1))
    await expect(
      installPluginFromGitCore(base, undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/主文件过大/)
    expect(mem.writes).toHaveLength(0)
  })

  it('超限资源被跳过，其余资源正常安装', async () => {
    const base = 'https://example.test/p/'
    net.routes.set(
      base + 'manifest.json',
      JSON.stringify({ id: 'asset-plugin', main: 'main.js', assets: ['big.bin', 'ok.png'] }),
    )
    net.routes.set(base + 'main.js', 'console.log(1)')
    net.routes.set(base + 'big.bin', new Uint8Array(MAX_PLUGIN_ASSET_BYTES + 1))
    net.routes.set(base + 'ok.png', new Uint8Array([1]))
    const record = await installPluginFromGitCore(base, undefined, {
      appVersion: APP_VERSION,
      store: makeStore(),
    })
    expect(record.id).toBe('asset-plugin')
    const paths = mem.writes.map((w) => w.path)
    expect(paths).toContain(PLUGINS_PREFIX + 'asset-plugin/ok.png')
    expect(paths).not.toContain(PLUGINS_PREFIX + 'asset-plugin/big.bin')
  })

  it('资源条目过多时拒绝', async () => {
    const base = 'https://example.test/p/'
    net.routes.set(
      base + 'manifest.json',
      JSON.stringify({
        id: 'many-assets',
        main: 'main.js',
        assets: Array.from({ length: MAX_PLUGIN_ASSETS + 1 }, (_, i) => `a${i}.png`),
      }),
    )
    await expect(
      installPluginFromGitCore(base, undefined, {
        appVersion: APP_VERSION,
        store: makeStore(),
      }),
    ).rejects.toThrow(/资源条目过多/)
    expect(mem.writes).toHaveLength(0)
  })
})
