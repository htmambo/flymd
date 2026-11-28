// 插件 invoke 命令边界契约测试。
//
// 目的：防止 PLUGIN_INVOKE_DENYLIST / PLUGIN_INVOKE_PUBLIC_API 与 Rust 侧
// generate_handler! 真实命令表再次漂移（历史问题：42 条名单里 23 条对应的命令已不存在）。
//
// 断言：
// 1. 两份名单互斥；
// 2. 并集恰好等于 generate_handler! 注册的命令集合（无幽灵条目、无未分类命令）；
// 3. public/plugins 下官方插件实际调用的命令（凡是真实存在的）都在公开 API 内。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_INVOKE_DENYLIST,
  PLUGIN_INVOKE_PUBLIC_API,
} from './pluginHost'

// 项目根：src/extensions/ → ../../。用 fileURLToPath 而非 pathname（Windows 上
// pathname 会得到 /C:/... 形式）。
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * 从 generate_handler! 注册块里提取命令名。
 * 逐行剥掉 `//` 注释后再按逗号切分——整行过滤会让“行尾注释 + 下一行的新命令”
 * 粘成一段，导致新增命令被漏报。
 */
export function parseHandlerCommands(src: string): Set<string> {
  const block = src.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/)
  if (!block) throw new Error('未找到 generate_handler! 命令注册块')
  const names = new Set<string>()
  const body = block[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  for (const part of body.split(',')) {
    const name = part.trim().split('::').pop()?.trim() || ''
    if (/^[a-z][a-z0-9_]*$/.test(name)) names.add(name)
  }
  return names
}

function readHandlerCommands(): Set<string> {
  const mainRs = readFileSync(join(ROOT, 'src-tauri/src/main.rs'), 'utf8')
  return parseHandlerCommands(mainRs)
}

function readPluginInvokedCommands(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const pluginsDir = join(ROOT, 'public/plugins')
  if (!existsSync(pluginsDir)) return out
  for (const id of readdirSync(pluginsDir)) {
    const mainJs = join(pluginsDir, id, 'main.js')
    if (!existsSync(mainJs)) continue
    const code = readFileSync(mainJs, 'utf8')
    const cmds = new Set<string>()
    for (const m of code.matchAll(/(?:context|ctx)\.invoke\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      cmds.add(m[1])
    }
    if (cmds.size) out.set(id, cmds)
  }
  return out
}

describe('parseHandlerCommands', () => {
  it('支持模块前缀、无尾逗号，并忽略行尾注释后的下一命令', () => {
    const src = `builder.invoke_handler(tauri::generate_handler![
      foo,
      ai_guard::snapshot,
      commented, // 说明文字，bogus_before_newline
      bar,
      last
    ])`
    expect([...parseHandlerCommands(src)].sort()).toEqual([
      'bar',
      'commented',
      'foo',
      'last',
      'snapshot',
    ])
  })

  it('找不到注册块时抛错（避免静默通过）', () => {
    expect(() => parseHandlerCommands('fn main() {}')).toThrow()
  })
})

describe('插件 invoke 命令边界', () => {
  const handlerCommands = readHandlerCommands()

  it('denylist 与 public API 互斥', () => {
    const overlap = [...PLUGIN_INVOKE_DENYLIST].filter((c) =>
      PLUGIN_INVOKE_PUBLIC_API.has(c),
    )
    expect(overlap).toEqual([])
  })

  it('两份名单的并集等于 generate_handler! 的命令集合', () => {
    const classified = new Set([
      ...PLUGIN_INVOKE_DENYLIST,
      ...PLUGIN_INVOKE_PUBLIC_API,
    ])
    const missing = [...handlerCommands].filter((c) => !classified.has(c)).sort()
    const ghost = [...classified].filter((c) => !handlerCommands.has(c)).sort()
    expect(missing, '未分类的新命令：请决定加入 denylist 或 public API').toEqual([])
    expect(ghost, '名单中存在已不存在的命令（历史漂移）').toEqual([])
  })

  it('官方插件调用的真实命令必须属于 public API', () => {
    const violations: string[] = []
    for (const [pluginId, cmds] of readPluginInvokedCommands()) {
      for (const cmd of cmds) {
        // android_saf_* 等命令由移动端独立实现，不在当前 Rust 表内，跳过。
        if (!handlerCommands.has(cmd)) continue
        if (PLUGIN_INVOKE_DENYLIST.has(cmd)) {
          violations.push(`${pluginId}: ${cmd}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
