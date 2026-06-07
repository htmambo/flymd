// @vitest-environment jsdom
// 测试 networkProxyFetchShim:覆盖 install/uninstall/enabled toggle/Request 场景/proxy fallback
// 关注点:
// 1) 初始不安装
// 2) 启用 localStorage 后 install 注入 window.fetch
// 3) uninstall 还原 nativeFetch
// 4) update() 切换 enabled 自动 install/uninstall
// 5) 'flymd:netproxy:changed' 事件触发 update
// 6) http fetch 不可用时降级到 native
// 7) Request 实例作为 input 走 Request 搬运路径
// 8) 非 http(s) 协议走 native

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNetworkProxyFetchShim } from './networkProxyFetchShim'

function fakeStorage(initial: Record<string, string> = {}): { storage: any } {
  const map = { ...initial }
  return {
    storage: {
      getItem: (k: string) => (k in map ? map[k] : null),
      setItem: (k: string, v: string) => { map[k] = v },
      removeItem: (k: string) => { delete map[k] },
    },
  }
}

function fakeWin(opts: { fetchImpl?: any; locationHref?: string } = {}) {
  const listeners: Record<string, Function[]> = {}
  const win: any = {
    fetch: opts.fetchImpl ?? (() => Promise.resolve(new Response('native'))),
    location: { href: opts.locationHref ?? 'http://app.local/' },
    addEventListener: (ev: string, cb: any) => {
      ;(listeners[ev] ||= []).push(cb)
    },
    dispatchEvent: (ev: string) => {
      ;(listeners[ev] || []).forEach(cb => cb())
    },
  }
  return { win, listeners }
}

beforeEach(() => {
  // default storage has no proxy enabled
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem('flymd:net:proxy') } catch {}
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNetworkProxyFetchShim', () => {
  it('is not installed by default when storage has no enabled flag', () => {
    const { storage } = fakeStorage()
    const { win } = fakeWin()
    const shim = createNetworkProxyFetchShim({ storage, win })
    expect(shim.isInstalled()).toBe(false)
  })

  it('installs on construction when localStorage has enabled=true', () => {
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const { win } = fakeWin()
    const shim = createNetworkProxyFetchShim({ storage, win })
    expect(shim.isInstalled()).toBe(true)
    expect(typeof win.fetch).toBe('function')
  })

  it('uninstall restores native fetch', () => {
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('native')))
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const { win } = fakeWin({ fetchImpl: nativeFetch })
    const shim = createNetworkProxyFetchShim({ storage, win })
    shim.uninstall()
    expect(shim.isInstalled()).toBe(false)
    // uninstall must restore the original native fetch (or its bound form) — assert via call
    // rather than reference equality because vi.fn() bound by shim is a fresh wrapper.
    void win.fetch('https://example.com/')
    expect(nativeFetch).toHaveBeenCalled()
  })

  it('update() installs/uninstalls based on storage change', () => {
    const map: Record<string, string> = {}
    const storage = { getItem: (k: string) => map[k] ?? null, setItem: (k: string, v: string) => { map[k] = v }, removeItem: (k: string) => { delete map[k] } }
    const { win } = fakeWin()
    const shim = createNetworkProxyFetchShim({ storage, win })
    expect(shim.isInstalled()).toBe(false)
    map['flymd:net:proxy'] = JSON.stringify({ enabled: true })
    shim.update()
    expect(shim.isInstalled()).toBe(true)
    delete map['flymd:net:proxy']
    shim.update()
    expect(shim.isInstalled()).toBe(false)
  })

  it('responds to flymd:netproxy:changed window event', () => {
    const map: Record<string, string> = {}
    const storage = { getItem: (k: string) => map[k] ?? null }
    const { win, listeners } = fakeWin()
    const shim = createNetworkProxyFetchShim({ storage, win })
    expect(shim.isInstalled()).toBe(false)
    map['flymd:net:proxy'] = JSON.stringify({ enabled: true })
    win.dispatchEvent('flymd:netproxy:changed')
    expect(shim.isInstalled()).toBe(true)
    // sanity: listener actually registered
    expect(listeners['flymd:netproxy:changed'].length).toBe(1)
  })

  it('falls back to native fetch when http module unavailable', async () => {
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('native')))
    const { win } = fakeWin({ fetchImpl: nativeFetch })
    const shim = createNetworkProxyFetchShim({ storage, win, importHttp: async () => null })
    const res = await win.fetch('https://example.com/')
    expect(await res.text()).toBe('native')
    expect(nativeFetch).toHaveBeenCalled()
  })

  it('uses http fetch when import succeeds and url is http(s)', async () => {
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const httpFetch = vi.fn(() => Promise.resolve(new Response('via-plugin-http')))
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('native')))
    const { win } = fakeWin({ fetchImpl: nativeFetch })
    const shim = createNetworkProxyFetchShim({ storage, win, importHttp: async () => ({ fetch: httpFetch }) })
    const res = await win.fetch('https://example.com/x')
    expect(await res.text()).toBe('via-plugin-http')
    expect(httpFetch).toHaveBeenCalledWith('https://example.com/x', expect.any(Object))
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('bypasses proxy for non-http(s) URLs', async () => {
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const httpFetch = vi.fn(() => Promise.resolve(new Response('plugin')))
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('native')))
    const { win } = fakeWin({ fetchImpl: nativeFetch })
    const shim = createNetworkProxyFetchShim({ storage, win, importHttp: async () => ({ fetch: httpFetch }) })
    const res = await win.fetch('data:text/plain,hello')
    expect(await res.text()).toBe('native')
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('Request instance: with init, fall back to native; without init, transport via http', async () => {
    const { storage } = fakeStorage({ 'flymd:net:proxy': JSON.stringify({ enabled: true }) })
    const httpFetch = vi.fn(() => Promise.resolve(new Response('req-via-plugin')))
    const nativeFetch = vi.fn(() => Promise.resolve(new Response('native')))
    const { win } = fakeWin({ fetchImpl: nativeFetch })
    const shim = createNetworkProxyFetchShim({ storage, win, importHttp: async () => ({ fetch: httpFetch }) })

    // case 1: with init → native (preserves browser semantics)
    const reqWithInit = new Request('https://example.com/a', { method: 'POST' })
    const res1 = await win.fetch(reqWithInit, { method: 'POST', body: 'x' })
    expect(await res1.text()).toBe('native')
    expect(httpFetch).not.toHaveBeenCalled()

    // case 2: no init → transport via http
    const reqNoInit = new Request('https://example.com/b')
    const res2 = await win.fetch(reqNoInit)
    expect(await res2.text()).toBe('req-via-plugin')
    expect(httpFetch).toHaveBeenCalled()
  })
})
