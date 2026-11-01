// 路径 glob 匹配（用于 recipe 的 on-save 触发过滤）。
//
// 语义对齐 gitignore 的直觉：
// - 不含 `/` 的模式匹配**文件名**（任意层级）：`*.md` 命中 `日记/今天.md`
// - 含 `/` 的模式匹配**库内相对路径**：`AI/*.md` 只命中 `AI/` 下的直接子文件
// - `**` 跨目录，`*` 不跨目录，`?` 匹配单个非分隔符字符
//
// 纯函数，便于单测。

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 把 glob 转成正则（`^...$` 锚定） */
export function globToRegExp(glob: string): RegExp {
  const g = String(glob || '').trim().replace(/\\/g, '/')
  let out = ''
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === '*') {
      if (g[i + 1] === '*') {
        // `**/` 跨任意层级（含零层）；`**` 跨任意字符
        if (g[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      out += '[^/]'
      continue
    }
    out += escapeRegExp(ch)
  }
  return new RegExp('^' + out + '$')
}

const cache = new Map<string, RegExp>()

function cached(glob: string): RegExp {
  const key = glob
  let re = cache.get(key)
  if (!re) {
    re = globToRegExp(key)
    cache.set(key, re)
  }
  return re
}

/**
 * 判断库内相对路径是否命中 glob。
 * `relPath` 用 `/` 分隔。
 */
export function matchGlob(glob: string, relPath: string): boolean {
  const g = String(glob || '').trim()
  if (!g) return false
  const p = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p) return false

  const re = cached(g)
  if (!g.includes('/')) {
    // 无斜杠：只匹配文件名
    const base = p.split('/').pop() || p
    return re.test(base)
  }
  return re.test(p)
}

/**
 * 判断相对路径是否命中 glob 列表。
 * 空列表 = 匹配全部（调用方据此决定"不过滤"）。
 */
export function matchAnyGlob(globs: string[] | undefined, relPath: string): boolean {
  const list = Array.isArray(globs) ? globs.filter((g) => String(g || '').trim()) : []
  if (list.length === 0) return true
  return list.some((g) => matchGlob(g, relPath))
}
