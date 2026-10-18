// NFR-2 入口闭包校验:dist 入口 chunk(+ modulepreload)的静态 import 闭包(递归解析产物 import 语句)
// 不得包含 js-yaml / diffMerge 对应 chunk(文件名形如 assets/(yaml|diff)-*.js)。
// 无第三方依赖;在 vite build 后由 package.json build 脚本调用。
// 校验失败打印违规路径并以 exit 1 退出。

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')
const htmlPath = path.join(distDir, 'index.html')

const VIOLATION_RE = /assets\/(?:yaml|diff)-[^/]*\.js$/

function fail(msg) {
  console.error(`[check-entry-closure] FAIL: ${msg}`)
  process.exit(1)
}

let html
try {
  html = readFileSync(htmlPath, 'utf8')
} catch (e) {
  fail(`无法读取 ${htmlPath}:${e}`)
}

// 1. 找入口 chunk:<script type="module" src="...">
const entryMatch = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/) ||
  html.match(/<script[^>]*src="([^"]+)"[^>]*type="module"/)
if (!entryMatch) fail('dist/index.html 中未找到 <script type="module" src="..."> 入口')
// 归一化:剥 query/hash、`./` 与前导 `/`(`/assets/index-*.js` 绝对形态同样相对 dist 解析);
// 外链/协议相对地址不是产物内 chunk,返回 null 由调用方跳过,避免误拼路径导致误报/漏检
const normRel = (p) => {
  if (!p || p.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null
  const clean = p.replace(/[?#].*$/, '').replace(/^\.\//, '').replace(/^\/+/, '')
  return clean || null
}
const entryRel = normRel(entryMatch[1])
if (!entryRel) fail(`入口 src 不是产物相对路径:${entryMatch[1]}`)

// 1b. modulepreload 与入口同步静态加载,必须一并作为闭包根;
//     否则 vite 若把黑名单 chunk 提升为 modulepreload 会绕过校验
const preloadRels = []
const PRELOAD_RE = /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*rel="modulepreload"/g
let pm
while ((pm = PRELOAD_RE.exec(html)) !== null) {
  const rel = normRel(pm[1] ?? pm[2])
  if (rel) preloadRels.push(rel)
}

// 2. 剥注释(块注释 + 行注释;行注释保护 :// 以免误伤 URL 字符串),只保留代码形态做正则解析
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// 3. 收集一个 chunk 文件内的静态 import 说明符(忽略动态 import() 与 import.meta)
//    覆盖三种形态:import ... from 'x' / import 'x' / export ... from 'x';兼容压缩产物(import{..}from"..")
const STATIC_IMPORT_RE = /\bimport(?!\s*[(.])\s*(?:[^()'"]*?\bfrom\s*)?['"]([^'"]+)['"]|\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g

function resolveSpecifier(spec, fromFile) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null // 外部依赖(产物内不应出现),不递归
  const resolved = path.resolve(path.dirname(fromFile), spec)
  if (!resolved.startsWith(distDir)) return null
  return resolved
}

// 4. 递归 DFS 收集闭包(入口 + 全部 modulepreload 为根)
const closure = new Set()
const stack = [entryRel, ...preloadRels].map((rel) => path.join(distDir, rel))
while (stack.length > 0) {
  const file = stack.pop()
  if (closure.has(file)) continue
  closure.add(file)
  let code
  try {
    code = readFileSync(file, 'utf8')
  } catch (e) {
    fail(`闭包解析失败,无法读取 ${path.relative(distDir, file)}:${e}`)
  }
  const clean = stripComments(code)
  STATIC_IMPORT_RE.lastIndex = 0
  let m
  while ((m = STATIC_IMPORT_RE.exec(clean)) !== null) {
    const spec = m[1] ?? m[2]
    const resolved = resolveSpecifier(spec, file)
    if (resolved && !closure.has(resolved)) stack.push(resolved)
  }
}

// 5. 断言闭包内无黑名单 chunk
const violations = [...closure]
  .map((f) => path.relative(distDir, f).split(path.sep).join('/'))
  .filter((rel) => VIOLATION_RE.test(rel))

if (violations.length > 0) {
  console.error('[check-entry-closure] 入口静态闭包包含被禁止的 chunk:')
  for (const v of violations) console.error(`  - ${v}`)
  console.error(`[check-entry-closure] 闭包大小: ${closure.size}`)
  process.exit(1)
}

console.log(`[check-entry-closure] OK: 入口静态闭包 ${closure.size} 个文件,不含 yaml/diff chunk`)
