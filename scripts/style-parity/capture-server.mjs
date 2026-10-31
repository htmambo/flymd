/*
 * flymd 样式基线捕获服务（dev-only）
 *
 * 校验页算出「阅读模式逐元素计算样式指纹」后，POST 到这里落盘成
 * scripts/style-parity/baseline.json。
 * 单独起一个小服务，而不是把 JSON 打印到终端/人眼，是为了让基线文件
 * 始终由「浏览器真实计算样式」生成，不经人工转录。
 *
 * 用法：
 *   node scripts/style-parity/capture-server.mjs [端口，默认 5180]
 * 然后打开 http://127.0.0.1:5173/scripts/style-parity/index.html?capture=1
 */
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const baselinePath = resolve(here, 'baseline.json')
const port = Number(process.argv[2] || 5180)

const server = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/baseline') {
    res.writeHead(404, cors)
    res.end('not found')
    return
  }
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    try {
      const payload = JSON.parse(raw)
      if (!payload || !payload.themes) throw new Error('payload.themes 缺失')
      // ?file=baseline-original.json 允许并存多份基线（原始基线 vs 当前基线）
      const q = new URL(req.url, 'http://127.0.0.1').searchParams
      const name = (q.get('file') || 'baseline.json').replace(/[^\w.-]/g, '')
      const target = resolve(here, name)
      if (dirname(target) !== here) throw new Error('非法文件名')
      await writeFile(target, JSON.stringify(payload, null, 2) + '\n', 'utf8')
      const themes = Object.keys(payload.themes).length
      res.writeHead(200, cors)
      res.end('saved ' + target + ' (' + themes + ' themes)')
    } catch (err) {
      res.writeHead(400, cors)
      res.end('error: ' + (err && err.message ? err.message : String(err)))
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log('baseline capture server: http://127.0.0.1:' + port + '/baseline')
})
