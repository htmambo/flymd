// 把已构建的 flymd MCP 服务器注入打包产物。
//
// 尽力而为：找不到产物或目标位置不存在时只告警，不阻断打包。
// MCP 服务器的主要分发渠道是 Release 里的独立二进制，本脚本只是
// 顺带把它塞进应用包（macOS 的 .app/Contents/MacOS、Windows/Linux 的
// 主程序同级目录），方便用户直接配置 MCP 客户端。
//
// 用法：node scripts/bundle-mcp-server.mjs [--triple <triple>]

import { existsSync, mkdirSync, copyFileSync, statSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs() {
  const args = process.argv.slice(2)
  let triple = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--triple') {
      triple = args[i + 1]
      i++
    } else if (args[i].startsWith('--triple=')) {
      triple = args[i].slice('--triple='.length)
    }
  }
  return { triple }
}

function hostTriple() {
  const r = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return null
  const m = r.stdout.match(/^host:\s*(\S+)$/m)
  return m ? m[1] : null
}

function findBuilt(triple) {
  const candidates = []
  const exe = triple && triple.includes('windows') ? '.exe' : ''
  if (triple) {
    candidates.push(path.join(projectRoot, 'mcp-server', 'target', triple, 'release', `flymd-mcp${exe}`))
  }
  candidates.push(path.join(projectRoot, 'mcp-server', 'target', 'release', `flymd-mcp${exe}`))
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** macOS: .app/Contents/MacOS/ 下的注入点 */
function macTargets() {
  const out = []
  const base = path.join(projectRoot, 'src-tauri', 'target')
  const targets = [
    'universal-apple-darwin',
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'release',
  ]
  for (const t of targets) {
    const app = path.join(base, t, 'release', 'bundle', 'macos', 'flymd.app')
    if (existsSync(app)) {
      out.push(path.join(app, 'Contents', 'MacOS', 'flymd-mcp'))
    }
  }
  return out
}

/** Windows / Linux: 主程序同级目录 */
function releaseDirTargets() {
  const out = []
  const base = path.join(projectRoot, 'src-tauri', 'target')
  for (const t of ['release', 'universal-apple-darwin', 'x86_64-unknown-linux-gnu']) {
    const dir = path.join(base, t, 'release')
    if (existsSync(dir)) out.push(path.join(dir, 'flymd-mcp'))
  }
  return out
}

function inject(src, dst) {
  try {
    mkdirSync(path.dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    try {
      chmodSync(dst, 0o755)
    } catch (_) {
      /* Windows 上忽略 */
    }
    console.log(`[bundle-mcp] ${path.relative(projectRoot, dst)} (${(statSync(dst).size / 1048576).toFixed(2)} MB)`)
    return true
  } catch (e) {
    console.warn(`[bundle-mcp] 注入失败 ${path.relative(projectRoot, dst)}: ${e.message}`)
    return false
  }
}

function main() {
  const { triple } = parseArgs()
  const t = triple || hostTriple()
  const src = findBuilt(t)
  if (!src) {
    console.warn('[bundle-mcp] 未找到已构建的 flymd-mcp，跳过注入（不影响主构建）')
    console.warn('[bundle-mcp] 提示：先运行 node scripts/build-mcp-server.mjs')
    return
  }
  console.log(`[bundle-mcp] 源: ${path.relative(projectRoot, src)}`)

  let n = 0
  for (const dst of [...macTargets(), ...releaseDirTargets()]) {
    if (inject(src, dst)) n++
  }
  if (n === 0) {
    console.warn('[bundle-mcp] 没有可注入的目标（打包产物可能尚未生成），跳过')
  }
}

main()
