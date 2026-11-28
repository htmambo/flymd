// 插件更新检查：manifest 超限降级 + 版本比较
//
// 并发上限由 src/core/concurrency.test.ts 单独覆盖；这里始终单条请求，
// 避免测试环境对并发动态 import 的干扰（真实应用无此限制）。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  urls: [] as string[],
  oversized: new Set<string>(),
  version: '9.9.9',
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  ResponseType: { Text: 1, Binary: 2 },
  Body: class {},
  fetch: async (url: string) => {
    state.urls.push(url)
    if (state.oversized.has(url)) {
      return { ok: true, status: 200, text: async () => 'x'.repeat(1024 * 1024 + 1) }
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ version: state.version }),
    }
  },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: {},
  mkdir: async () => {},
}))

vi.mock('../core/logger', () => ({ logInfo: () => {}, logDebug: () => {} }))

vi.mock('../core/libraryConfig', () => ({
  getLibraryScope: () => ({ id: null, root: null, persisted: false }),
  readLibraryConfig: async () => null,
  writeLibraryConfig: async () => true,
}))

vi.mock('../core/configBackup', () => ({ PLUGINS_DIR: 'flymd/plugins' }))

import {
  fetchRemoteManifestVersion,
  getPluginUpdateStates,
  MAX_PLUGIN_MANIFEST_CHARS,
  type InstalledPlugin,
} from './runtime'

function plugin(id: string, version?: string, manifestUrl?: string): InstalledPlugin {
  return { id, version, manifestUrl: manifestUrl || '', dir: 'flymd/plugins/' + id, main: 'main.js' }
}

beforeEach(() => {
  state.urls.length = 0
  state.oversized.clear()
  state.version = '9.9.9'
})

describe('fetchRemoteManifestVersion', () => {
  it('读取 version 字段', async () => {
    state.version = '1.2.3'
    expect(await fetchRemoteManifestVersion('https://example.test/a/manifest.json')).toBe('1.2.3')
  })

  it('超过 manifest 上限时视为无更新', async () => {
    const big = 'https://example.test/big/manifest.json'
    state.oversized.add(big)
    expect(MAX_PLUGIN_MANIFEST_CHARS).toBe(1024 * 1024)
    expect(await fetchRemoteManifestVersion(big)).toBeNull()
  })
})

describe('getPluginUpdateStates', () => {
  it('远端版本更高时返回更新', async () => {
    const url = 'https://example.test/p/manifest.json'
    state.version = '2.0.0'
    const res = await getPluginUpdateStates([plugin('p', '1.0.0', url)], [])
    expect(res.p).toEqual({ manifestUrl: url, remoteVersion: '2.0.0' })
    expect(state.urls).toEqual([url])
  })

  it('版本不高于本地时不返回', async () => {
    state.version = '1.0.0'
    const res = await getPluginUpdateStates(
      [plugin('p', '1.0.0', 'https://example.test/p/manifest.json')],
      [],
    )
    expect(res).toEqual({})
  })

  it('无法解析 manifest URL 时不发请求', async () => {
    const res = await getPluginUpdateStates([plugin('p', '1.0.0')], [])
    expect(res).toEqual({})
    expect(state.urls).toEqual([])
  })
})
