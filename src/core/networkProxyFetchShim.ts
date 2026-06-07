// 网络代理 fetch 桥接:把浏览器 fetch 通过 Tauri 的 plugin-http 走 Rust 网络栈
// 抽离自 main.ts:1518-1684。
// 抽离理由:整块是纯全局 fetch 适配,完全无 main.ts 闭包依赖;
// 只用 window.fetch / localStorage / 动态 import('@tauri-apps/plugin-http')。
// 启用开关:localStorage `flymd:net:proxy` 的 { enabled: true } + window 事件 'flymd:netproxy:changed'。

const NET_PROXY_KEY = 'flymd:net:proxy'
const NET_PROXY_CHANGED_EVENT = 'flymd:netproxy:changed'

export interface NetworkProxyDeps {
  /** window 注入用,默认全局 window */
  win?: any
  /** localStorage 注入用,默认全局 localStorage */
  storage?: { getItem(k: string): string | null } | null
  /** 动态 import,默认 import('@tauri-apps/plugin-http') */
  importHttp?: () => Promise<{ fetch: any; Body?: any } | null>
}

interface InternalState {
  installed: boolean
  nativeFetch: any
  httpFetch: any
  httpBody: any
  httpImportPromise: Promise<any> | null
}

export interface NetworkProxyApi {
  install: () => void
  uninstall: () => void
  isInstalled: () => boolean
  update: () => void
  /** 测试/重置用 */
  _resetState: () => void
}

function makeState(): InternalState {
  return {
    installed: false,
    nativeFetch: null,
    httpFetch: null,
    httpBody: null,
    httpImportPromise: null,
  }
}

export function createNetworkProxyFetchShim(deps: NetworkProxyDeps = {}): NetworkProxyApi {
  const state = makeState()
  const win = deps.win ?? (typeof window !== 'undefined' ? window : null)
  const storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const importHttp = deps.importHttp ?? (async () => {
    try {
      const mod: any = await import('@tauri-apps/plugin-http')
      return mod
    } catch {
      return null
    }
  })

  const readEnabled = (): boolean => {
    try {
      if (!storage) return false
      const raw = storage.getItem(NET_PROXY_KEY)
      if (!raw) return false
      const v = JSON.parse(raw || '{}') as any
      return !!v.enabled
    } catch { return false }
  }

  const loadHttp = async (): Promise<{ fetch: any; Body?: any } | null> => {
    if (state.httpFetch) return { fetch: state.httpFetch, Body: state.httpBody }
    if (!state.httpImportPromise) {
      state.httpImportPromise = (async () => {
        try {
          const mod: any = await importHttp()
          if (!mod || typeof mod.fetch !== 'function') return null
          state.httpFetch = mod.fetch
          state.httpBody = mod.Body
          return { fetch: state.httpFetch, Body: state.httpBody }
        } catch {
          return null
        }
      })()
    }
    return await state.httpImportPromise
  }

  const normalizeHeaders = (h: any): Record<string, string> | any => {
    try {
      if (!h) return h
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        const out: Record<string, string> = {}
        h.forEach((v: string, k: string) => { out[k] = v })
        return out
      }
      if (Array.isArray(h)) {
        const out: Record<string, string> = {}
        for (const it of h) {
          if (!Array.isArray(it) || it.length < 2) continue
          const k = String(it[0] || '')
          const v = String(it[1] || '')
          if (k) out[k] = v
        }
        return out
      }
      return h
    } catch {
      return h
    }
  }

  const resolveHttpUrl = (input: any): string | null => {
    try {
      if (typeof input !== 'string') return null
      const u = new URL(input, win?.location?.href ?? 'http://localhost/')
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u.toString()
    } catch {
      return null
    }
  }

  const proxiedFetch = async (input: any, init?: any): Promise<any> => {
    try {
      if (!state.nativeFetch && win?.fetch) state.nativeFetch = win.fetch.bind(win)

      let url = resolveHttpUrl(input)
      let reqFromRequest: Request | null = null
      try {
        if (!url && typeof Request !== 'undefined' && input instanceof Request) {
          if (init != null) return state.nativeFetch(input, init)
          reqFromRequest = input
          url = resolveHttpUrl(reqFromRequest.url)
        }
      } catch {}
      if (!url) return state.nativeFetch(input, init)

      const http = await loadHttp()
      if (!http || typeof http.fetch !== 'function') return state.nativeFetch(input, init)

      const req: any = init ? { ...init } : {}
      req.headers = normalizeHeaders(req.headers)

      if (reqFromRequest) {
        try {
          req.method = reqFromRequest.method || req.method || 'GET'
          req.headers = normalizeHeaders(reqFromRequest.headers)
          const m = String(req.method || 'GET').toUpperCase()
          if (m !== 'GET' && m !== 'HEAD') {
            const clone = reqFromRequest.clone()
            const ab = await clone.arrayBuffer()
            req.body = ab
          }
        } catch {
          return state.nativeFetch(input, init)
        }
      }

      const body = req.body
      try {
        if (typeof FormData !== 'undefined' && body instanceof FormData) return state.nativeFetch(input, init)
        if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return state.nativeFetch(input, init)
        if (typeof Blob !== 'undefined' && body instanceof Blob) return state.nativeFetch(input, init)
      } catch {}

      try {
        const Body = (http as any).Body
        if (Body && typeof Body.bytes === 'function') {
          if (body instanceof Uint8Array) req.body = Body.bytes(body)
          else if (body instanceof ArrayBuffer) req.body = Body.bytes(new Uint8Array(body))
        }
      } catch {}

      try { if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) req.body = body.toString() } catch {}

      return await http.fetch(url, req)
    } catch {
      try { return state.nativeFetch(input, init) } catch { throw new Error('fetch failed') }
    }
  }

  const install = (): void => {
    try {
      if (state.installed) return
      if (!state.nativeFetch && win?.fetch) state.nativeFetch = win.fetch.bind(win)
      if (typeof state.nativeFetch !== 'function' || !win) return
      win.fetch = proxiedFetch as any
      state.installed = true
    } catch {}
  }

  const uninstall = (): void => {
    try {
      if (!state.installed) return
      if (state.nativeFetch && typeof state.nativeFetch === 'function' && win) {
        win.fetch = state.nativeFetch
      }
      state.installed = false
    } catch {}
  }

  const update = (): void => {
    try {
      if (readEnabled()) install()
      else uninstall()
    } catch {}
  }

  // initial update
  update()

  // bind change event
  if (win?.addEventListener) {
    try { win.addEventListener(NET_PROXY_CHANGED_EVENT, () => { update() }) } catch {}
  }

  return {
    install,
    uninstall,
    isInstalled: () => state.installed,
    update,
    _resetState: () => {
      uninstall()
      state.nativeFetch = null
      state.httpFetch = null
      state.httpBody = null
      state.httpImportPromise = null
    },
  }
}

/**
 * 一键初始化:等同于调用 createNetworkProxyFetchShim() 并触发首次 update。
 * 替换原 main.ts 入口的 initNetworkProxyFetchShim 调用。
 */
export function initNetworkProxyFetchShim(deps?: NetworkProxyDeps): NetworkProxyApi {
  return createNetworkProxyFetchShim(deps)
}
