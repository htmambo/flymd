# flymd web

`flymd.llingfei.com` 的本地服务,基于 [sync_server](../onetcli/sync_server) 技术栈:

- **server**: Fastify 5 + better-sqlite3 + zod + TypeScript
- **web-client**: Vue 3 + Vite 7 + Pinia + Vue Router + Tailwind 4 + zod

## 目录结构

```
web/
├── package.json              # npm workspaces 根
├── server/                   # Fastify 后端
│   ├── src/
│   │   ├── main.ts
│   │   ├── config/env.ts
│   │   ├── db/
│   │   │   ├── database.ts    # better-sqlite3 客户端
│   │   │   └── migrations.ts
│   │   ├── services/
│   │   │   ├── auth.ts
│   │   │   └── settings.ts
│   │   ├── http/
│   │   │   ├── app.ts         # Fastify 工厂
│   │   │   ├── plugins/auth.ts
│   │   │   └── routes/
│   │   │       ├── auth.ts            # /api/v1/auth/*
│   │   │       ├── settings.ts        # /api/v1/admin/* + /api/v1/settings/*
│   │   │       ├── health.ts
│   │   │       └── legacy-mock.ts     # 旧的 27 端点(/asr/* /ai/* /xiaoshuo/* /pdf/* + 静态)
│   │   ├── types/             # 共享类型
│   │   ├── utils/             # crypto, http
│   │   └── scripts/
│   │       └── reset-password.ts
│   ├── tsconfig.json
│   └── package.json
├── web-client/               # Vue 3 前端
│   ├── src/
│   │   ├── main.ts           # 全局 mouse spotlight 监听
│   │   ├── App.vue
│   │   ├── style.css         # .hover-card 等全局样式
│   │   ├── router/index.ts
│   │   ├── services/api.ts   # 统一 fetch + Bearer
│   │   ├── stores/auth.ts    # Pinia auth store
│   │   ├── types/api.ts
│   │   ├── layouts/AppLayout.vue   # 侧边栏 + 内容区
│   │   └── views/
│   │       ├── auth/LoginView.vue  # 登录/注册(切换模式)
│   │       ├── auth/RegisterView.vue
│   │       └── admin/SettingsView.vue  # 设置 + 用户管理
│   ├── vite.config.mts
│   ├── tsconfig.json
│   └── package.json
└── data/                     # 运行时生成的 SQLite db
```

## 快速开始

```bash
# 安装所有 workspace 依赖
cd web
npm install

# 启动(开发模式:server + web-client 并发)
npm run dev
# → server:   http://127.0.0.1:8787
# → web:      http://127.0.0.1:5173 (Vite dev)
# → 管理后台: http://127.0.0.1:5173/app

# 仅启动 server(serve 静态 + Vite dev middleware)
npm run dev:server

# 仅启动 web-client(纯 Vite dev)
npm run dev:web

# 生产 build
npm run build
# → web-client/dist/  ← 静态资源
# → server/dist/      ← Fastify 编译产物

# 生产启动
npm run start  # server 跑在 8787,serves web-client/dist + API
```

## 默认账号

| 邮箱 | 密码 | 角色 |
|---|---|---|
| `admin@flymd.local` | `admin123` | admin |

可通过 `/login` 切换到"注册"模式创建新账号。

通过环境变量覆盖:
```bash
ADMIN_EMAIL=alice@example.com ADMIN_PASSWORD=new-pw-1234 npm run dev:server
```

## API 一览

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/register` | 注册新账号(`{ email, password, nickname? }`) |
| POST | `/api/v1/auth/login` | 登录(`{ email, password }`)→ `{ token, refreshToken, expiresAt, user }` |
| GET | `/api/v1/auth/me` | 当前用户(需 Bearer) |
| POST | `/api/v1/auth/refresh` | 刷新 token(`{ refreshToken }`) |
| POST | `/api/v1/auth/logout` | 登出(需 Bearer) |
| POST | `/api/v1/auth/change-password` | 改密(需 Bearer) |
| PATCH | `/api/v1/auth/profile` | 改昵称(需 Bearer) |

### 管理(admin role)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/overview` | 总览(总用户 / 活跃 / 禁用 / 设置项数) |
| GET | `/api/v1/admin/users` | 用户列表 |
| PATCH | `/api/v1/admin/users/:id` | 改 role / status |
| DELETE | `/api/v1/admin/users/:id/data` | 清空该用户所有 session |
| GET | `/api/v1/admin/settings?category=ai&unmask=true` | 列出设置(`unmask=true` 显示完整 apiKey,默认 `****xxxx` 脱敏) |
| GET | `/api/v1/admin/settings/grouped?unmask=true` | 按 4 类(ai / apikey / system / user)分组返回 |
| GET | `/api/v1/admin/settings/:key?unmask=true` | 单个设置 |
| PUT | `/api/v1/admin/settings` | 创 / 改设置(`{ key, value, category, visibility?, description? }`) |
| DELETE | `/api/v1/admin/settings/:key` | 删除 |

### 普通用户

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/settings/public` | 列出 `visibility: public` 的设置 |

### 健康

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{ status: 'ok', service, timestamp }` |

### Legacy mock(保留旧 27 端点)

| 路径 | 说明 |
|---|---|
| `GET /announcements.json` `/plugins/index.json` `/update-extra.json` `/extensions.html` `/pdf/shop.png` `/Flymdnew.png` `/favicon.ico` | 静态资源 |
| `POST /asr/api/auth/{login,register}` `GET /asr/api/auth/me` `GET /asr/api/billing/status` `POST /asr/api/billing/redeem` | ASR 后端(in-memory users) |
| `POST /ai/ai_proxy.php[/v1/{chat/completions,completions,embeddings}]` `POST /ai/audio_proxy.php` | OpenAI 兼容 AI 代理(支持 SSE 流式) |
| `POST /xiaoshuo/auth/{login,register}` `GET /xiaoshuo/billing/{status,me}` `POST /xiaoshuo/billing/redeem` `POST /xiaoshuo/ai/proxy` | AI 小说引擎 |
| `GET/POST /pdf/*` | PDF 服务 |

## 配置(环境变量)

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | server 监听地址 |
| `PORT` | `8787` | server 端口 |
| `NODE_ENV` | `development` | `production` 时 serve 静态 web-client/dist |
| `ENABLE_VITE` | `true` | dev 模式启用 Vite middleware |
| `ADMIN_EMAIL` | `admin@flymd.local` | 初始化 admin 邮箱 |
| `ADMIN_PASSWORD` | `admin123` | 初始化 admin 密码 |
| `DATA_DIR` | `web/data` | SQLite 持久化目录 |
| `WEB_DIST_PATH` | `web/web-client/dist` | 生产模式 serve 的静态目录 |
| `CORS_ORIGIN` | `*` | CORS 允许来源 |
| `JWT_SECRET` | `flymd-dev-secret-please-change-in-prod` | 密码哈希 / token 加盐(生产必改) |

## 卡片 hover 效果

参考 sync_server 的 `.hover-card` 实现,本项目在 `web-client/src/style.css` 中实现了:

- `.hover-card` — 基础:200ms transition + hover translateY(-2px) + 边框 / 阴影
- `.hover-card-glow` — 增强:鼠标位置 radial-gradient 跟随高光(`::before` + CSS 变量 `--spotlight-x/y`)
- `.hover-card-danger` — 危险操作:hover 边框变红
- `.hover-row` — 表格行:hover 背景色

主入口 `main.ts` 全局监听 `mousemove` 事件,委托到 `.hover-card-glow` 元素上设置 CSS 变量。

使用方式:
```html
<div class="card hover-card">基础 hover</div>
<div class="card hover-card hover-card-glow">带光斑跟随</div>
<tr class="hover-row">表格行</tr>
```

## 安全注意事项

1. **JWT_SECRET 默认值仅用于本地开发** — 生产前必须改成强随机字符串
2. **默认 admin 密码 admin123** — 部署后立即通过 `/login` 改密,或用 `ADMIN_PASSWORD` 环境变量
3. **CORS_ORIGIN=*** — 生产应限定为前端域名
4. **设置项中的 apiKey 默认脱敏**(显示 `****xxxx` 末 4 位),`unmask=true` 时显示完整 — UI 调 `unmask=true` 时应警告用户

## 与 mdeditor 项目配合

`mdeditor` 项目中 16 处 `https://flymd.llingfei.com` 引用,本服务通过保留旧 mock 端点(`/asr/*` `/ai/*` `/xiaoshuo/*` 等)继续支持,无需修改 mdeditor 源码。

如果想让前端真正用本地 mock,可在 mdeditor 端修改常量(`src/extensions/asrNote.ts:11` 等 16 处)或用 hosts 绑定 `flymd.llingfei.com → 127.0.0.1`。
