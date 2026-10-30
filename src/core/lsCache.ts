// localStorage 读缓存（perf 批次 H3）
//
// 背景（真机实测，1.05MB 笔记 + 554KB 脏会话快照把 DB 撑到数 MB）：
// WebKitGTK 的 localStorage 是"同步 IPC + SQLite"，DB 变大后单次 getItem ~26ms、
// 首次建库/打开可达数十秒。热路径（每次渲染、每代码块）直连 localStorage 会把
// 这些成本乘进循环——decorateCodeBlocks 曾因每块调用一次 getItem 花掉 87~102 秒。
//
// 规则：热路径一律走本模块的内存缓存；本窗口写入即时更新缓存；跨窗口/外部写入
// 由 storage 事件失效对应 key（key 为 null 的 storage 事件=clear() 全清）。
// 非热路径（启动期/低频设置项）仍可直连 localStorage，不强制。

const cache = new Map<string, string | null>()
let bound = false

function ensureStorageListener(): void {
  if (bound) return
  bound = true
  try {
    window.addEventListener('storage', (ev) => {
      try {
        if (ev.key === null) cache.clear()
        else cache.delete(ev.key)
      } catch {}
    })
  } catch {}
}

export function lsGetStringCached(key: string): string | null {
  ensureStorageListener()
  if (cache.has(key)) return cache.get(key) as string | null
  let v: string | null = null
  try { v = localStorage.getItem(key) } catch {}
  cache.set(key, v)
  return v
}

export function lsSetStringCached(key: string, value: string): void {
  ensureStorageListener()
  cache.set(key, value)
  try { localStorage.setItem(key, value) } catch {}
}

export function lsRemoveCached(key: string): void {
  ensureStorageListener()
  cache.delete(key)
  try { localStorage.removeItem(key) } catch {}
}
