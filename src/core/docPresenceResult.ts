// scan_dirs_doc_presence 返回值归一。
//
// Rust 端已从裸数组升级为结构体 { dirs, truncated, errors, visited }，
// 便于前端观测"截断/遍历错误"。这里同时接受旧数组形态（回滚后端、旧缓存测试桩），
// 保证调用方只处理一种形状。

export type DocPresenceScanStats = {
  dirs: string[]
  truncated: boolean
  errors: number
  visited: number
}

function toCount(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

export function normalizeDocPresenceScanResult(res: unknown): DocPresenceScanStats {
  if (Array.isArray(res)) {
    return { dirs: res.filter((x): x is string => typeof x === 'string'), truncated: false, errors: 0, visited: 0 }
  }
  const obj = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>
  const rawDirs = Array.isArray(obj.dirs) ? obj.dirs : []
  return {
    dirs: rawDirs.filter((x): x is string => typeof x === 'string'),
    truncated: obj.truncated === true,
    errors: toCount(obj.errors),
    visited: toCount(obj.visited),
  }
}
