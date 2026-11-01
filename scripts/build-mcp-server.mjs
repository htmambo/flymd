// 构建 flymd MCP 服务器二进制。
//
// 用法：
//   node scripts/build-mcp-server.mjs                  # 构建当前 host 目标
//   node scripts/build-mcp-server.mjs --target <triple> # 构建指定目标
//   node scripts/build-mcp-server.mjs --universal      # macOS: 构建 universal 二进制
//
// 产物位置：
//   mcp-server/target/<triple>/release/flymd-mcp[.exe]
//   src-tauri/binaries/flymd-mcp-<triple>[.exe]   （Tauri sidecar 约定位置）

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = path.join('mcp-server', 'Cargo.toml')
const outDir = path.join(projectRoot, 'src-tauri', 'binaries')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { target: null, universal: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target') {
      out.target = args[i + 1]
      i++
    } else if (args[i] === '--universal') {
      out.universal = true
    } else if (args[i].startsWith('--target=')) {
      out.target = args[i].slice('--target='.length)
    }
  }
  return out
}

function hostTriple() {
  const r = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return null
  const m = r.stdout.match(/^host:\s*(\S+)$/m)
  return m ? m[1] : null
}

function cargoBuild(triple) {
  const args = ['build', '--release', '--manifest-path', manifest]
  if (triple) args.push('--target', triple)
  console.log(`[build-mcp] cargo ${args.join(' ')}`)
  return spawnSync('cargo', args, { stdio: 'inherit', cwd: projectRoot }).status === 0
}

function exeSuffix(triple) {
  return triple && triple.includes('windows') ? '.exe' : ''
}

function builtPath(triple) {
  const dir = triple
    ? path.join(projectRoot, 'mcp-server', 'target', triple, 'release')
    : path.join(projectRoot, 'mcp-server', 'target', 'release')
  return path.join(dir, `flymd-mcp${exeSuffix(triple)}`)
}

function copyToSidecar(triple, src) {
  if (!triple) return null
  mkdirSync(outDir, { recursive: true })
  const dst = path.join(outDir, `flymd-mcp-${triple}${exeSuffix(triple)}`)
  copyFileSync(src, dst)
  console.log(`[build-mcp] sidecar -> ${path.relative(projectRoot, dst)}`)
  return dst
}

// Release 资产的平台后缀。
// 为什么要带后缀：GitHub Release 不允许两个同名资产。Linux 与 macOS 的产物
// 默认都叫 `flymd-mcp`，v2.0.0 首次发版就因此只传上去一个，另一个报 404。
const RELEASE_SUFFIX = {
  'x86_64-pc-windows-msvc': 'windows-x64',
  'aarch64-pc-windows-msvc': 'windows-arm64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
  'universal-apple-darwin': 'macos-universal',
  'aarch64-apple-darwin': 'macos-arm64',
  'x86_64-apple-darwin': 'macos-x64',
}

/**
 * 把产物按平台后缀复制到 release-dist/，供 CI 上传为 Release 资产。
 * 返回落盘文件名。
 */
function stageForRelease(triple, src) {
  const suffix = RELEASE_SUFFIX[triple]
  if (!suffix) {
    console.warn(`[build-mcp] 未知目标三元组 ${triple}，跳过 release-dist 暂存`)
    return null
  }
  const dir = path.join(projectRoot, 'mcp-server', 'target', 'release-dist')
  mkdirSync(dir, { recursive: true })
  const name = `flymd-mcp-${suffix}${exeSuffix(triple)}`
  const dst = path.join(dir, name)
  copyFileSync(src, dst)
  console.log(`[build-mcp] release-asset -> ${path.relative(projectRoot, dst)}`)
  return dst
}

function main() {
  const opts = parseArgs()

  if (opts.universal) {
    // macOS universal：分别构建两个架构后 lipo 合并
    const arches = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
    const built = []
    for (const t of arches) {
      if (!cargoBuild(t)) {
        console.error(`[build-mcp] 构建 ${t} 失败`)
        process.exit(1)
      }
      built.push(builtPath(t))
    }
    const out = builtPath('universal-apple-darwin')
    mkdirSync(path.dirname(out), { recursive: true })
    const lipo = spawnSync('lipo', ['-create', '-output', out, ...built], { stdio: 'inherit' })
    if (lipo.status !== 0) {
      console.error('[build-mcp] lipo 合并失败')
      process.exit(1)
    }
    console.log(`[build-mcp] universal -> ${path.relative(projectRoot, out)}`)
    copyToSidecar('universal-apple-darwin', out)
    stageForRelease('universal-apple-darwin', out)
    return
  }

  const triple = opts.target || hostTriple()
  if (!cargoBuild(triple)) {
    console.error('[build-mcp] 构建失败')
    process.exit(1)
  }
  const src = builtPath(triple)
  if (!existsSync(src)) {
    console.error(`[build-mcp] 未找到产物: ${src}`)
    process.exit(1)
  }
  console.log(
    `[build-mcp] 产物 -> ${path.relative(projectRoot, src)} (${(statSync(src).size / 1048576).toFixed(2)} MB)`,
  )
  copyToSidecar(triple, src)
  stageForRelease(triple, src)
}

main()
