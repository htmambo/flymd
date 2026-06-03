#!/usr/bin/env node
/**
 * flymd.llingfei.com 本地 Mock Server
 *
 * 用法:
 *   node web/server.js                # 默认监听 127.0.0.1:8787
 *   PORT=9000 node web/server.js      # 自定义端口
 *   HOST=0.0.0.0 node web/server.js   # 监听所有接口
 *
 * 覆盖范围(基于全项目 16 处 flymd.llingfei.com 引用):
 *   - 主页 / 静态资源(/ /extensions.html / pdf/shop.png / Flymdnew.png)
 *   - 在线公告 / 插件市场索引(/announcements.json / plugins/index.json)
 *   - ASR 后端(/asr/api/auth/* /asr/api/billing/*)
 *   - AI 代理(OpenAI 兼容)/ai/ai_proxy.php/* + /ai/audio_proxy.php
 *   - AI 小说引擎(/xiaoshuo/auth/* /xiaoshuo/billing/* /xiaoshuo/ai/proxy/*)
 *   - PDF 服务(/pdf/*)
 *
 * 零依赖(Node 18+ 内置模块),单文件,in-memory 状态,无持久化。
 *
 * @internal 仅用于本地开发/测试,所有响应都是 mock 数据。
 */

'use strict'

import http from 'node:http'
import { URL } from 'node:url'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// 配置
// ============================================================

const PORT = parseInt(process.env.PORT || '8787', 10)
const HOST = process.env.HOST || '127.0.0.1'

// 透明 1x1 PNG(base64 解码)
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

// 1x1 ICO(占位,前端用作 favicon 也能跑)
const PLACEHOLDER_ICO = Buffer.from(
  'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAAA=',
  'base64',
)

// ============================================================
// 内存状态
// ============================================================

/** username -> { password, token, balance_min, used_min, plan, createdAt } */
const users = new Map()

/** 预置几个 demo 账号,避免每次都注册 */
;[
  { username: 'demo',  password: 'demo123',  balance_min: 999 },
  { username: 'admin', password: 'admin123', balance_min: 9999 },
  { username: 'test',  password: 'test123',  balance_min: 60 },
].forEach((u) => users.set(u.username, { ...u, used_min: 0, plan: 'mock', createdAt: Date.now(), token: null }))

// ============================================================
// 工具
// ============================================================

function newToken() {
  return 'tok_' + crypto.randomBytes(12).toString('hex')
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000)
}

function genId(prefix) {
  return prefix + '-' + crypto.randomBytes(8).toString('hex')
}

function logLine(method, url, status, ms) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  console.log(`[${ts}] ${method} ${url} → ${status} (${ms}ms)`)
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type, Authorization',
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
    ...(extraHeaders || {}),
  })
  res.end(body)
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...CORS_HEADERS,
  })
  res.end(text)
}

function sendBuffer(res, status, buf, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=3600',
    ...CORS_HEADERS,
  })
  res.end(buf)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      buf += c
      // 防御:超过 5MB 拒绝
      if (buf.length > 5 * 1024 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!buf) return resolve({})
      try {
        resolve(JSON.parse(buf))
      } catch (e) {
        reject(new Error('invalid json: ' + e.message))
      }
    })
    req.on('error', reject)
  })
}

function getAuthToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(h))
  return m ? m[1].trim() : null
}

function findUserByToken(token) {
  if (!token) return null
  for (const u of users.values()) {
    if (u.token === token) return u
  }
  return null
}

// ============================================================
// 路由处理
// ============================================================

const handlers = []

function route(method, regex, handler) {
  handlers.push({ method, regex, handler })
}

// ---------- A. 主页 + 静态资源 ----------

const HOMEPAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>flymd · 飞速 Markdown</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body{font:14px/1.6 -apple-system,"Segoe UI",sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#222}
  h1{font-size:28px;margin-bottom:8px}
  a{color:#2563eb;text-decoration:none}
  a:hover{text-decoration:underline}
  .tag{display:inline-block;padding:2px 8px;background:#eef;border-radius:4px;margin-right:4px;font-size:12px}
</style>
</head>
<body>
  <h1>flymd · 飞速 Markdown</h1>
  <p><span class="tag">本地 mock</span> 这是 <code>flymd.llingfei.com</code> 的本地开发服务器(由 <code>web/server.js</code> 提供)。</p>
  <h2>常用端点</h2>
  <ul>
    <li><a href="/announcements.json">/announcements.json</a> — 在线公告</li>
    <li><a href="/plugins/index.json">/plugins/index.json</a> — 插件市场索引</li>
    <li><a href="/extensions.html">/extensions.html</a> — 插件市场页面</li>
    <li><a href="/pdf/shop.png">/pdf/shop.png</a> — 占位 PNG(1x1)</li>
  </ul>
  <h2>ASR 测试</h2>
  <pre>curl -X POST http://127.0.0.1:8787/asr/api/auth/login/ \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"demo","password":"demo123"}'</pre>
  <h2>AI 代理测试(OpenAI 兼容)</h2>
  <pre>curl -X POST http://127.0.0.1:8787/ai/ai_proxy.php/v1/chat/completions \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"flymd-mock-1","messages":[{"role":"user","content":"hi"}]}'</pre>
</body>
</html>`

const EXTENSIONS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>flymd 插件市场</title>
<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 16px}</style>
</head>
<body>
  <h1>flymd 插件市场</h1>
  <p>(本地 mock · 真实索引请见 <a href="/plugins/index.json">/plugins/index.json</a>)</p>
  <p>返回 <a href="/">返回首页</a></p>
</body>
</html>`

route('GET', /^\/?$/, (req, res) => {
  sendText(res, 200, HOMEPAGE_HTML, 'text/html; charset=utf-8')
})

route('GET', /^\/extensions\.html$/, (req, res) => {
  sendText(res, 200, EXTENSIONS_HTML, 'text/html; charset=utf-8')
})

route('GET', /^\/pdf\/shop\.png$/, (req, res) => {
  sendBuffer(res, 200, TRANSPARENT_PNG, 'image/png')
})

route('GET', /^\/Flymdnew\.png$/, (req, res) => {
  sendBuffer(res, 200, TRANSPARENT_PNG, 'image/png')
})

route('GET', /^\/favicon\.ico$/, (req, res) => {
  sendBuffer(res, 200, PLACEHOLDER_ICO, 'image/x-icon')
})

route('GET', /^\/update-extra\.json$/, (req, res) => {
  sendJson(res, 200, {
    items: [
      { text: '官方网站', href: 'http://127.0.0.1:8787/' },
      { text: '插件市场', href: 'http://127.0.0.1:8787/extensions.html' },
    ],
  })
})

route('GET', /^\/announcements\.json$/, (req, res) => {
  sendJson(res, 200, {
    version: 1,
    announcements: [
      {
        id: 'mock-welcome',
        title: '欢迎使用 flymd 本地 mock 服务器',
        message: '这是来自 web/server.js 的 mock 公告。',
        url: 'http://127.0.0.1:8787/',
        duration_ms: 5000,
      },
    ],
  })
})

route('GET', /^\/plugins\/index\.json$/, (req, res) => {
  sendJson(res, 200, {
    version: 1,
    updated_at: new Date().toISOString(),
    items: [
      {
        id: 'mock-plugin-hello',
        name: 'Hello World(mock)',
        version: '1.0.0',
        author: 'flymd mock server',
        description: '由 web/server.js 返回的占位插件,用于本地开发。',
        main: 'main.js',
        homepage: 'http://127.0.0.1:8787/',
        download: 'http://127.0.0.1:8787/plugins/hello/main.js',
      },
    ],
  })
})

// ---------- B. ASR 后端 ----------

function asrGetOrCreateUser(username) {
  let u = users.get(username)
  if (!u) {
    u = { password: '', balance_min: 999, used_min: 0, plan: 'mock', createdAt: Date.now(), token: null }
    users.set(username, u)
  }
  return u
}

function asrIssueToken(user) {
  user.token = newToken()
  return user.token
}

route('POST', /^\/asr\/api\/auth\/login\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!username || !password) {
      return sendJson(res, 400, { error: 'username/password required' })
    }
    const u = users.get(username)
    if (!u || u.password !== password) {
      return sendJson(res, 401, { error: 'invalid credentials' })
    }
    const tok = asrIssueToken(u)
    sendJson(res, 200, { token: tok, username, balance_min: u.balance_min })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('POST', /^\/asr\/api\/auth\/register\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (username.length < 3 || username.length > 32) {
      return sendJson(res, 400, { error: 'username 长度需为 3~32' })
    }
    if (password.length < 6 || password.length > 64) {
      return sendJson(res, 400, { error: 'password 长度需为 6~64' })
    }
    if (users.has(username)) {
      return sendJson(res, 409, { error: 'username already exists' })
    }
    const u = asrGetOrCreateUser(username)
    u.password = password
    const tok = asrIssueToken(u)
    sendJson(res, 201, { token: tok, username, balance_min: u.balance_min })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('GET', /^\/asr\/api\/auth\/me\/?$/, (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (!u) return sendJson(res, 401, { error: 'unauthorized' })
  sendJson(res, 200, {
    username: u.username,
    balance_min: u.balance_min,
    used_min: u.used_min,
    plan: u.plan,
    created_at: nowEpoch(),
  })
})

route('POST', /^\/asr\/api\/auth\/logout\/?$/, (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (u) u.token = null
  sendJson(res, 200, { ok: true })
})

route('GET', /^\/asr\/api\/billing\/status\/?$/, (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (!u) return sendJson(res, 401, { error: 'unauthorized' })
  sendJson(res, 200, {
    balance_min: u.balance_min,
    used_min: u.used_min,
    plan: u.plan,
    expires_at: nowEpoch() + 30 * 86400,
    server_time: nowEpoch(),
  })
})

route('POST', /^\/asr\/api\/billing\/redeem\/?$/, async (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (!u) return sendJson(res, 401, { error: 'unauthorized' })
  try {
    const body = await readJsonBody(req)
    const key = String(body.token || body.code || '').trim()
    if (!key) return sendJson(res, 400, { error: '卡密为空' })
    // mock:任何以 'MOCK-' 开头的卡密都加 1000 分钟
    if (key.startsWith('MOCK-')) {
      u.balance_min += 1000
    } else {
      u.balance_min += 100
    }
    sendJson(res, 200, { ok: true, balance_min: u.balance_min })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

// ---------- C. AI 代理(OpenAI 兼容) ----------

/**
 * OpenAI 兼容 Chat Completion SSE 流式响应
 * 输出 3-5 个 chunk 模拟逐字流
 */
function streamChatCompletion(res, body) {
  const model = String(body.model || 'flymd-mock-1')
  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((m) => m && m.role === 'user')
  const userText = lastUser ? String(lastUser.content || '') : ''
  const reply =
    `这是 flymd 本地 mock 服务器的回复。你说:"${userText.slice(0, 100)}"。\n\n` +
    `本机 mock 不会调用真实 AI,所有响应都是固定文本。\n` +
    `如需真实能力,请部署真实后端。`

  const id = genId('chatcmpl')
  const created = nowEpoch()
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS_HEADERS,
  })

  // 把 reply 拆成 4-6 个 chunk
  const chunks = []
  const n = 5
  for (let i = 0; i < n; i++) {
    const start = Math.floor((reply.length * i) / n)
    const end = Math.floor((reply.length * (i + 1)) / n)
    chunks.push(reply.slice(start, end))
  }

  let i = 0
  function send() {
    if (i >= chunks.length) {
      // 最后一个 chunk 含 finish_reason
      res.write(
        'data: ' +
          JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) +
          '\n\n',
      )
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const isFirst = i === 0
    const data = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: isFirst ? { role: 'assistant' } : {},
          content: chunks[i],
        },
      ],
    }
    res.write('data: ' + JSON.stringify(data) + '\n\n')
    i++
    setTimeout(send, 60)
  }
  send()
}

route('POST', /^\/ai\/ai_proxy\.php\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    // legacy 路径分发:有 messages → chat,否则 completions
    if (Array.isArray(body.messages)) {
      return streamChatCompletion(res, body)
    }
    // 默认走 completions
    return sendJson(res, 200, {
      id: genId('cmpl'),
      object: 'text_completion',
      created: nowEpoch(),
      model: body.model || 'flymd-mock-1',
      choices: [
        {
          text: '[mock] ' + (body.prompt || '').toString().slice(0, 200),
          index: 0,
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('POST', /^\/ai\/ai_proxy\.php\/v1\/chat\/completions\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    // stream=true → SSE
    if (body.stream === true || body.stream === 'true') {
      return streamChatCompletion(res, body)
    }
    // 非流式:返回完整 completion
    const messages = Array.isArray(body.messages) ? body.messages : []
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user')
    const userText = lastUser ? String(lastUser.content || '') : ''
    sendJson(res, 200, {
      id: genId('chatcmpl'),
      object: 'chat.completion',
      created: nowEpoch(),
      model: body.model || 'flymd-mock-1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `[mock] 收到消息: "${userText.slice(0, 200)}"。本地 mock 不会调用真实 AI。`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('POST', /^\/ai\/ai_proxy\.php\/v1\/completions\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    sendJson(res, 200, {
      id: genId('cmpl'),
      object: 'text_completion',
      created: nowEpoch(),
      model: body.model || 'flymd-mock-1',
      choices: [
        {
          text: '[mock completion] ' + (body.prompt || '').toString().slice(0, 200),
          index: 0,
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('POST', /^\/ai\/ai_proxy\.php\/v1\/embeddings\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    const input = Array.isArray(body.input) ? body.input : [String(body.input || '')]
    sendJson(res, 200, {
      object: 'list',
      data: input.map((t, i) => ({
        object: 'embedding',
        embedding: new Array(8).fill(0).map((_, j) => Math.sin((i + 1) * (j + 1) * 0.13)),
        index: i,
      })),
      model: body.model || 'flymd-mock-embed',
      usage: { prompt_tokens: 0, total_tokens: 0 },
    })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

route('POST', /^\/ai\/audio_proxy\.php\/?$/, async (req, res) => {
  // 音频转录 mock:返回固定文本
  try {
    await readJsonBody(req).catch(() => ({}))
    sendJson(res, 200, {
      text: '[mock] 这是音频转录 mock 返回的固定文本。本地服务器不做真实 ASR。',
      language: 'zh',
      duration: 0,
      segments: [],
    })
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) })
  }
})

// ---------- D. AI 小说引擎(/xiaoshuo/*) ----------

// 这套 API 是 Tauri Rust 后端代理透传给前端的,基本是上面 ASR/AI 的子集
// 实现最常用的 auth/billing/ai/proxy 端点

route('POST', /^\/xiaoshuo\/auth\/(login|register)\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    const username = String(body.username || body.email || '').trim()
    const password = String(body.password || '')
    if (!username || !password) {
      return sendJson(res, 400, { ok: false, error: 'username/password required' })
    }
    let u = users.get(username)
    if (!u) {
      u = asrGetOrCreateUser(username)
      u.password = password
    } else if (u.password !== password) {
      return sendJson(res, 401, { ok: false, error: 'invalid credentials' })
    }
    const tok = asrIssueToken(u)
    sendJson(res, 200, { ok: true, token: tok, username })
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) })
  }
})

route('GET', /^\/xiaoshuo\/billing\/(status|me)\/?$/, (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (!u) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
  sendJson(res, 200, {
    ok: true,
    username: u.username,
    balance_min: u.balance_min,
    used_min: u.used_min,
    plan: u.plan,
  })
})

route('POST', /^\/xiaoshuo\/billing\/redeem\/?$/, async (req, res) => {
  const u = findUserByToken(getAuthToken(req))
  if (!u) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
  try {
    const body = await readJsonBody(req)
    const key = String(body.token || body.code || '').trim()
    if (!key) return sendJson(res, 400, { ok: false, error: '卡密为空' })
    u.balance_min += key.startsWith('MOCK-') ? 1000 : 100
    sendJson(res, 200, { ok: true, balance_min: u.balance_min })
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) })
  }
})

// AI 代理:复用 OpenAI 兼容逻辑
route('POST', /^\/xiaoshuo\/ai\/proxy\/?$/, async (req, res) => {
  try {
    const body = await readJsonBody(req)
    if (body.stream === true || body.stream === 'true') {
      return streamChatCompletion(res, body)
    }
    const messages = Array.isArray(body.messages) ? body.messages : []
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user')
    const userText = lastUser ? String(lastUser.content || '') : ''
    sendJson(res, 200, {
      ok: true,
      id: genId('chatcmpl'),
      object: 'chat.completion',
      created: nowEpoch(),
      model: body.model || 'flymd-mock-1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `[xiaoshuo mock] "${userText.slice(0, 200)}"`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) })
  }
})

// 兜底 /xiaoshuo/* → 同上
route('POST', /^\/xiaoshuo\/(.+)$/, async (req, res) => {
  // 任何未匹配的 /xiaoshuo/* 路径:用 body 推断
  try {
    const body = await readJsonBody(req)
    const lastUser = (body.messages || []).slice(-1)[0]
    const userText = lastUser ? String(lastUser.content || '') : ''
    sendJson(res, 200, {
      ok: true,
      id: genId('chatcmpl'),
      object: 'chat.completion',
      created: nowEpoch(),
      model: body.model || 'flymd-mock-1',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: `[xiaoshuo fallback] "${userText.slice(0, 100)}"` },
          finish_reason: 'stop',
        },
      ],
    })
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e.message || e) })
  }
})

// ---------- E. PDF 服务 ----------

route('GET', /^\/pdf\/shop\.png$/, (req, res) => {
  sendBuffer(res, 200, TRANSPARENT_PNG, 'image/png')
})

// 兜底 /pdf/*  → 200 + JSON
route(['GET', 'POST'], /^\/pdf\/(.+)$/, (req, res) => {
  sendJson(res, 200, {
    status: 'mock',
    file: req.url.replace(/^\/pdf\//, ''),
    message: 'PDF mock server: 真实服务请部署 pdf2doc 后端',
  })
})

// ============================================================
// HTTP 服务器
// ============================================================

const server = http.createServer(async (req, res) => {
  const t0 = Date.now()
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const method = req.method.toUpperCase()

  // CORS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // 路由匹配(r.method 可能是字符串或字符串数组,统一走 includes)
  for (const r of handlers) {
    const methodMatch = Array.isArray(r.method)
      ? r.method.includes(method)
      : r.method === method
    if (methodMatch && r.regex.test(pathname)) {
      try {
        await r.handler(req, res, url)
        const ms = Date.now() - t0
        // 如果 handler 没自己 end,补 204
        if (!res.writableEnded) {
          res.end()
        }
        logLine(method, pathname, res.statusCode, ms)
        return
      } catch (e) {
        console.error('[handler error]', e)
        if (!res.writableEnded) {
          sendJson(res, 500, { error: 'internal error: ' + String(e.message || e) })
        }
        logLine(method, pathname, 500, Date.now() - t0)
        return
      }
    }
  }

  // 兜底 404
  sendJson(res, 404, {
    error: 'not found',
    method,
    path: pathname,
    hint: '查看 https://github.com/flyhunterl/flymd 或 /home/hoping/htdocs/mdeditor/.omc/autopilot/spec.md',
  })
  logLine(method, pathname, 404, Date.now() - t0)
})

server.listen(PORT, HOST, () => {
  console.log(`\nflymd mock server listening on http://${HOST}:${PORT}`)
  console.log(`(PORT=${process.env.PORT || '8787'}  HOST=${process.env.HOST || '127.0.0.1'})`)
  console.log('Endpoints:')
  console.log('  GET  /                                       — 主页')
  console.log('  GET  /announcements.json                     — 公告')
  console.log('  GET  /plugins/index.json                     — 插件索引')
  console.log('  POST /asr/api/auth/{login,register}/         — ASR 登录注册')
  console.log('  GET  /asr/api/billing/status/                — ASR 余额')
  console.log('  POST /ai/ai_proxy.php/v1/chat/completions    — OpenAI 兼容 chat')
  console.log('  POST /xiaoshuo/ai/proxy/                     — AI 小说代理')
  console.log('  GET  /pdf/shop.png                           — 占位 PNG')
  console.log('\n预设账号: demo/demo123 (999 分钟)  admin/admin123 (9999)  test/test123 (60)')
  console.log('Ctrl+C 退出\n')
})

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[server] SIGINT, 关闭中...')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000).unref()
})
