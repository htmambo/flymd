// watch 事件路径 → 目录 doc-presence 预扫描缓存的增量失效决策（纯函数，便于单测）。
//
// 与 fileTreePathKey.normDirKey 的缓存 key 约定对齐：正斜杠、无尾斜杠；
// 本模块只做轻量归一（分隔符/尾斜杠/去重），大小写归一由 invalidate 侧 normDirKey 兜底。

/**
 * 单次 debounce 合并窗口内，去重后 watch 路径数超过该阈值时降级为
 * 全清 + root 全树扫描（写放大防护，NFR-3 / A5）。64 vs 65 为硬边界，测试锁定。
 */
export const WATCH_INVALIDATE_FULL_SCAN_THRESHOLD = 64

/** 单条路径归一：\ → /，去尾斜杠（文件系统根 "/" 与驱动器根 "C:" 除外）。 */
function normalizeWatchPath(raw: string): string {
  const s = String(raw).replace(/\\/g, '/')
  if (s.length > 1 && !/:$/.test(s)) return s.replace(/\/+$/, '')
  return s
}

/** 归一化 watch 事件路径：分隔符归一、去尾斜杠、去重（保序）；空/非字符串条目跳过。 */
export function normalizeWatchPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths || []) {
    if (typeof raw !== 'string' || !raw) continue
    const p = normalizeWatchPath(raw)
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/**
 * 每条路径 + 其所有祖先目录，去重后按长度降序输出（子代在前，利于前缀清理先处理深层）。
 * 祖先链在驱动器根（C:）与文件系统根（/）处截断——把二者当祖先等于全量清理，退化为整树失效；
 * 文件系统根截断同时防 UNC 路径（//server/share）向上退化出 "/" 前缀。
 * 注：库根恰为驱动器根（如 C:）时，根行 hint 不会因截断而失效，属可接受罕见边界（下轮全扫恢复）。
 */
export function pathsToInvalidatePrefixes(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (p: string) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  for (const raw of paths || []) {
    if (typeof raw !== 'string' || !raw) continue
    const p = normalizeWatchPath(raw)
    if (!p) continue
    add(p)
    let cur = p
    let idx = cur.lastIndexOf('/')
    while (idx > 0) {
      const parent = cur.slice(0, idx)
      // 驱动器根（C:）与文件系统根（/）作为祖先等于全量失效，截断。
      // 文件系统根截断同时防 UNC 路径（//server/share）向上退化出 "/" 前缀。
      if (parent === '/' || /^[a-zA-Z]:$/.test(parent)) break
      add(parent)
      cur = parent
      idx = cur.lastIndexOf('/')
    }
  }
  return out.sort((a, b) => b.length - a.length)
}

export type DocPresenceRefreshStrategy =
  | { kind: 'full-scan' }
  | { kind: 'incremental'; prefixes: string[] }

/**
 * refreshTree 的 doc-presence 刷新策略决策：
 * - 缓存被标脏（后台预取曾失败，FR-3 兜底）/ 无路径上下文 / 去重后超阈值 → 全清 + root 全扫
 * - 否则 → 前缀集合增量失效 + 先以缓存渲染 + 后台预取
 */
export function resolveDocPresenceRefresh(
  paths: string[] | null | undefined,
  opts?: { dirty?: boolean },
): DocPresenceRefreshStrategy {
  if (opts?.dirty) return { kind: 'full-scan' }
  const normalized = normalizeWatchPaths(paths || [])
  if (normalized.length === 0 || normalized.length > WATCH_INVALIDATE_FULL_SCAN_THRESHOLD) {
    return { kind: 'full-scan' }
  }
  return { kind: 'incremental', prefixes: pathsToInvalidatePrefixes(normalized) }
}

/** 预扫描缓存只写 true，按 key 集合比较即可判定 hint 是否与已渲染基线一致。 */
export interface KeyContainer {
  readonly size: number
  has(key: string): boolean
  keys(): IterableIterator<string>
}

export function docPresenceHintSetsEqual(a: KeyContainer, b: KeyContainer): boolean {
  if (a.size !== b.size) return false
  for (const k of a.keys()) if (!b.has(k)) return false
  return true
}
