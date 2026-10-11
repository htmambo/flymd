// Vitest 全局 setup。
//
// 为什么需要：Node 22+ 内置了实验性的 `localStorage` 全局对象，jsdom 环境会把它
// 当作宿主全局透传，顶掉 jsdom 自己的 Storage 实现。后果是测试里拿到的
// localStorage 是个空壳 `Object`（没有 getItem/setItem），而
// `previewMeta.test.ts` / `networkProxyFetchShim.test.ts` 依赖真实 Storage。
// 仓库根目录那几个 .vitest-localstorage* SQLite 文件也是这个全局落盘留下的残迹。
//
// 这里在 jsdom 环境下补一个纯内存 Storage；node 环境下不动（无 DOM 需求）。

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined'

if (hasDom) {
  const g = globalThis as any
  const candidate = g.localStorage
  // 已经是可用的 Storage 实现就保持原样（正常 jsdom 行为）
  const isUsable = candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'

  if (!isUsable) {
    class MemoryStorage implements Storage {
      private _map = new Map<string, string>()

      get length(): number { return this._map.size }
      clear(): void { this._map.clear() }
      getItem(key: string): string | null {
        const v = this._map.get(String(key))
        return v === undefined ? null : v
      }
      key(index: number): string | null {
        return Array.from(this._map.keys())[index] ?? null
      }
      removeItem(key: string): void { this._map.delete(String(key)) }
      setItem(key: string, value: string): void { this._map.set(String(key), String(value)) }
      [name: string]: any
    }

    const storage = new MemoryStorage()
    // 同时覆盖 window 与 globalThis，确保两边拿到同一个实例
    try { g.localStorage = storage } catch {}
    try { (window as any).localStorage = storage } catch {}
    try {
      Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true })
    } catch {}
  }
}