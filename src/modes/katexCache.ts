// KaTeX HTML 渲染缓存层(抽离自 main.ts:267-270,320-335)
//
// 设计:
//   - 纯性能缓存:命中就赚,溢出就清,不搞 LRU
//   - 工厂闭包持有 Map 状态(避免 module-level singleton 不可测)
//   - deps 注入 max(容量上限)/maxLen(可缓存的 LaTeX 长度阈值)
//   - katex mod 通过参数传入(本模块不依赖 katex 包的 import shape,
//     由调用方持有 _katexMod 状态以保证 import 延迟加载)

export interface KatexCacheDeps {
  max: number
  maxLen: number
}

export interface KatexCacheApi {
  renderCached(katexMod: any, latex: string, displayMode: boolean): string
}

export function createKatexCache(deps: KatexCacheDeps): KatexCacheApi {
  const cache = new Map<string, string>()
  const { max, maxLen } = deps

  return {
    renderCached(katexMod: any, latex: string, displayMode: boolean): string {
      const src = latex || ''
      // 大公式缓存意义不大,只会吃内存;小公式重复率高,缓存很划算。
      const canCache = src.length > 0 && src.length <= maxLen
      const key = canCache ? `${displayMode ? 'B' : 'I'}:${src}` : ''
      if (canCache) {
        const hit = cache.get(key)
        if (hit != null) return hit
      }
      const html = katexMod.default.renderToString(src, { throwOnError: false, displayMode })
      if (canCache) {
        if (cache.size >= max) cache.clear()
        cache.set(key, html)
      }
      return html
    },
  }
}
