# flymd 本地 Mock Server

`flymd.llingfei.com` 的本地开发服务器,基于全项目 16 处该域名引用提取端点。

## 快速开始

```bash
# 1. 启动(默认 127.0.0.1:8787)
node web/server.js

# 2. 自定义端口
PORT=9000 node web/server.js

# 3. 监听所有接口
HOST=0.0.0.0 node web/server.js
```

## 覆盖范围

| 路径 | 用途 | 引用方 |
|---|---|---|
| `GET /` | 官网首页 | `update-extra.json` 等 |
| `GET /extensions.html` | 插件市场页 | `README.md` |
| `GET /announcements.json` | 在线公告 | `src/core/onlineAnnouncements.ts` |
| `GET /plugins/index.json` | 插件市场索引 | `src/extensions/market.ts` |
| `GET /update-extra.json` | 更新附加 | `public/update-extra.json` |
| `GET /pdf/shop.png` | 占位 PNG | `ai-novel` / `pdf2doc` |
| `GET /Flymdnew.png` | 占位 PNG | `ai-assistant` |
| `GET /favicon.ico` | 占位 ICO | aboutOverlay 等 |
| `POST /asr/api/auth/{login,register}/` | ASR 登录注册 | `src/extensions/asrNote.ts` |
| `GET/POST /asr/api/billing/{status,redeem}/` | ASR 计费 | 同上 |
| `GET/POST /asr/api/auth/{me,logout}/` | ASR 用户 | 同上 |
| `POST /ai/ai_proxy.php/v1/chat/completions` | OpenAI 兼容 chat | `ai-assistant` / `flymd-RAG` |
| `POST /ai/ai_proxy.php/v1/completions` | OpenAI 兼容 completion | 同上 |
| `POST /ai/ai_proxy.php/v1/embeddings` | OpenAI 兼容 embeddings | 同上 |
| `POST /ai/ai_proxy.php` legacy | AI 代理分发 | `ai-novel` |
| `POST /ai/audio_proxy.php` | 音频转录 | `src/extensions/speechTranscribe.ts` |
| `POST /xiaoshuo/auth/{login,register}/` | AI 小说登录 | `src-tauri/src/main.rs:ai_novel_api` |
| `GET/POST /xiaoshuo/billing/*` | AI 小说计费 | 同上 |
| `POST /xiaoshuo/ai/proxy/` | AI 小说代理 | 同上 |
| `GET/POST /pdf/*` | PDF 服务 | `public/plugins/pdf2doc/main.js` |

## 预设账号

| 账号 | 密码 | 余额(分钟) |
|---|---|---|
| `demo` | `demo123` | 999 |
| `admin` | `admin123` | 9999 |
| `test` | `test123` | 60 |

调用 `POST /asr/api/auth/register/` 可以注册新账号。

## 与 mdeditor 配合

### Web 端

`vite dev` / `vite preview` 默认运行在 `127.0.0.1:5173` / `4173`,与 mock server `8787` 是不同端口。
如需让前端使用本地 mock,需把前端代码里的 `https://flymd.llingfei.com` 替换为 `http://127.0.0.1:8787`,或者:

1. 修改项目源码中的常量(临时方案):
   - `src/extensions/asrNote.ts:11` `ASR_BACKEND_BASE_DEFAULT` → `http://127.0.0.1:8787/asr`
   - `src/core/onlineAnnouncements.ts:29` `DEFAULT_URL` → `http://127.0.0.1:8787/announcements.json`
   - `src/extensions/market.ts:116` `officialUrl` → `http://127.0.0.1:8787/plugins/index.json`
   - 等等(共 16 处)
2. 或者:用 hosts 绑定 `flymd.llingfei.com` → `127.0.0.1`(需要 sudo 改 `/etc/hosts`)

### Tauri 桌面端

Tauri 2 webview 默认不允许 `http://` 跨域请求(只允许 `https://` 或配置的 localhost)。
在 `tauri.conf.json` 的 capabilities 中加 `http://127.0.0.1:8787` 到 `csp` / `dangerousDisableAssetCspModification` 等设置。
或者:让 Rust 端 `ai_novel_api` 等代理函数读 `MOCK_BACKEND_URL` 环境变量,启动时把 base 切到本地。

## 测试示例

```bash
# 1. 主页
curl -s http://127.0.0.1:8787/

# 2. 公告
curl -s http://127.0.0.1:8787/announcements.json

# 3. 插件索引
curl -s http://127.0.0.1:8787/plugins/index.json

# 4. ASR 登录
curl -s -X POST http://127.0.0.1:8787/asr/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo123"}'

# 5. ASR 余额
curl -s http://127.0.0.1:8787/asr/api/billing/status/ \
  -H 'Authorization: Bearer <token_from_step_4>'

# 6. OpenAI chat completion (非流式)
curl -s -X POST http://127.0.0.1:8787/ai/ai_proxy.php/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"flymd-mock","messages":[{"role":"user","content":"hi"}]}'

# 7. OpenAI chat completion (流式 SSE)
curl -N -s -X POST http://127.0.0.1:8787/ai/ai_proxy.php/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"flymd-mock","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

## 不做

- **不持久化**:重启清空所有用户和余额(in-memory `Map`)
- **不实现真实 AI**:所有 AI 回复都是固定文本(前缀 `[mock]`)
- **不实现 WebSocket**:`/asr/ws` 暂未实现(本地开发不需要)
- **不反向代理真实 flymd.llingfei.com**:本机纯 mock,完全离线可用

## 设计取舍

- **零依赖**:仅用 Node 18+ 内置模块(`http`, `url`, `crypto`, `fs`, `path`)
- **单文件**:500 行,可读可改
- **CORS 全开放**:`Access-Control-Allow-Origin: *`,方便 web 端跨域
- **请求日志**:每条请求 `console.log(method path status ms)`,便于排查
- **CORS 预检 OPTIONS 直接 204**:避免前端 CORS 失败
