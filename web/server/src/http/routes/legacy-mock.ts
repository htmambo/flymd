/**
 * 旧 mock 端点迁移(从 web/server.js 移植)
 *
 * 保留所有 27 个端点,确保 mdeditor 项目中 16 处 flymd.llingfei.com 引用继续工作。
 *
 * 端点类别:
 *  A. 主页 + 静态资源
 *  B. ASR 后端(/asr/api/*)
 *  C. AI 代理(OpenAI 兼容,/ai/ai_proxy.php/*)
 *  D. AI 小说引擎(/xiaoshuo/*)
 *  E. PDF 服务(/pdf/*)
 */
import type { FastifyInstance } from "fastify";
import { sendError, sendOk } from "../../utils/http.js";

// ============================================================
// 1×1 透明 PNG + 占位 ICO
// ============================================================

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const PLACEHOLDER_ICO = Buffer.from(
  "AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAAA=",
  "base64",
);

// ============================================================
// A. 主页 + 静态资源
// ============================================================

const HOMEPAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>flymd · 飞速 Markdown</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  :root { --bg:#fff; --fg:#1f2937; --muted:#6b7280; --accent:#2563eb; --accent2:#7c3aed; --card:#f9fafb; --border:#e5e7eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1020; --fg:#e5e7eb; --muted:#9ca3af; --card:#111827; --border:#1f2937; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--fg); }
  .wrap { max-width: 920px; margin: 0 auto; padding: 56px 24px 80px; }
  .hero { text-align: center; margin-bottom: 64px; }
  .logo { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { font-size: 20px; color: var(--muted); margin: 12px 0 0; }
  .lede { font-size: 17px; max-width: 640px; margin: 24px auto 0; color: var(--fg); opacity: 0.85; }
  .cta { margin-top: 32px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: transform 0.12s ease, box-shadow 0.12s ease; cursor: pointer; border: 0; font-size: 15px; }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.18); }
  .btn-primary { background: var(--accent); color: white; }
  .btn-secondary { background: var(--card); color: var(--fg); border: 1px solid var(--border); }
  h2.section { font-size: 22px; margin: 56px 0 16px; text-align: center; }
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 48px 0; }
  .usecases { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  code { background: var(--card); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .footer { text-align: center; margin-top: 64px; color: var(--muted); font-size: 13px; }
  .footer a { color: var(--accent); text-decoration: none; }

  /* ============================================================
   * 卡片 hover 效果(参考 sync_server .hover-card):
   *   - 基础:hover translateY + border accent + box-shadow
   *   - glow 变体:鼠标位置 radial-gradient 跟随高光(::before + CSS 变量)
   * ============================================================ */
  .hover-card {
    position: relative;
    cursor: pointer;
    transition:
      transform 220ms ease,
      border-color 220ms ease,
      box-shadow 220ms ease,
      background-color 220ms ease;
    will-change: transform;
  }
  .hover-card:hover {
    transform: translateY(-3px);
    border-color: var(--accent);
    box-shadow:
      0 12px 32px rgba(37, 99, 235, 0.10),
      0 0 0 1px rgba(37, 99, 235, 0.18);
  }
  @media (prefers-color-scheme: dark) {
    .hover-card:hover {
      box-shadow:
        0 16px 40px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(96, 165, 250, 0.25);
    }
  }
  .hover-card-glow {
    overflow: hidden;
    isolation: isolate;
  }
  .hover-card-glow::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 300ms ease;
    background: radial-gradient(
      420px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%),
      rgba(37, 99, 235, 0.16),
      transparent 55%
    );
  }
  .hover-card-glow:hover::before { opacity: 1; }
  .hover-card-glow > * { position: relative; z-index: 1; }

  /* 应用到特性卡和人群卡 */
  .feature {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 24px;
  }
  .feature h3 { margin: 0 0 8px; font-size: 16px; font-weight: 700; }
  .feature p { margin: 0; color: var(--muted); font-size: 14px; }
  .feature .icon { font-size: 22px; margin-bottom: 6px; display: block; }
  .usecase {
    background: var(--card);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 14px;
  }
  .usecase b { display: block; margin-bottom: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="logo">flymd</div>
    <p class="tagline">飞速 Markdown 编辑器</p>
    <p class="lede">为写作者打造的轻量级桌面 Markdown 编辑器。打开即用、双栏预览、插件生态、可云同步。</p>
    <div class="cta">
      <a class="btn btn-primary" href="/app">立即开始 →</a>
      <a class="btn btn-secondary" href="#features">了解特性</a>
    </div>
  </div>

  <h2 class="section" id="features">核心特性</h2>
  <div class="features">
    <div class="feature hover-card hover-card-glow">
      <span class="icon">⚡</span>
      <h3>极速启动</h3>
      <p>基于 Tauri 构建,体积小,启动快,毫秒级打开大文件。</p>
    </div>
    <div class="feature hover-card hover-card-glow">
      <span class="icon">📝</span>
      <h3>边写边看</h3>
      <p>源码 / 预览 / WYSIWYG 三模式自由切换,所见即所得。</p>
    </div>
    <div class="feature hover-card hover-card-glow">
      <span class="icon">🔌</span>
      <h3>插件生态</h3>
      <p>RAG 检索、AI 助手、图床、PDF 处理… 按需安装,无限扩展。</p>
    </div>
    <div class="feature hover-card hover-card-glow">
      <span class="icon">☁️</span>
      <h3>云同步</h3>
      <p>多端无缝同步,文件级冲突检测与合并,告别丢稿烦恼。</p>
    </div>
    <div class="feature hover-card hover-card-glow">
      <span class="icon">🎨</span>
      <h3>主题与外观</h3>
      <p>暗色 / 亮色自由切换,代码高亮、字体、行距皆可定制。</p>
    </div>
    <div class="feature hover-card hover-card-glow">
      <span class="icon">🔒</span>
      <h3>本地优先</h3>
      <p>文件存于本地,数据主权归你。可选加密同步,隐私无忧。</p>
    </div>
  </div>

  <h2 class="section">适用人群</h2>
  <div class="usecases">
    <div class="usecase hover-card hover-card-glow"><b>✍️ 写作者</b>专注写作,沉浸编辑,所见即所得。</div>
    <div class="usecase hover-card hover-card-glow"><b>👨‍💻 开发者</b>写技术文档、博客、笔记,代码高亮 + AI 助手。</div>
    <div class="usecase hover-card hover-card-glow"><b>🎓 学生 / 研究者</b>记笔记、写论文,多端同步随时查阅。</div>
    <div class="usecase hover-card hover-card-glow"><b>📚 团队 / 企业</b>私有部署、定制插件、本地优先协作。</div>
  </div>

  <h2 class="section">现在就试试</h2>
  <p style="text-align:center;color:var(--muted);max-width:560px;margin:0 auto 24px">
    打开 web 管理后台,登录后即可管理 AI 配置、API_KEY、用户与插件。<br>
    默认管理员: <code>admin@flymd.local</code> / <code>admin123</code>(生产环境请立即修改)
  </p>
  <div class="cta">
    <a class="btn btn-primary" href="/app">进入管理后台</a>
  </div>

  <div class="footer">
    <p>
      <a href="https://github.com/htmambo/flymd" target="_blank" rel="noopener">GitHub</a> ·
      <a href="/extensions.html">插件市场</a> ·
      <a href="/api/v1/admin/overview">API 状态</a>
    </p>
    <p style="margin-top:8px;font-size:12px">本地 mock + 登录/设置服务 · 由 web/server/ Fastify 提供</p>
  </div>
</div>
<script>
  // 鼠标位置光晕跟随:为 .hover-card-glow 元素设置 --spotlight-x/y CSS 变量
  // 复用 web-client style.css 的同款实现,这里用 vanilla JS 等价版
  document.addEventListener('mousemove', (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const card = target.closest('.hover-card-glow');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--spotlight-x', x.toFixed(1) + '%');
    card.style.setProperty('--spotlight-y', y.toFixed(1) + '%');
  }, { passive: true });
</script>
</body>
</html>`;

const EXTENSIONS_HTML = `<!doctype html>
<html><head><meta charset="UTF-8"><title>flymd 插件市场</title></head>
<body><h1>flymd 插件市场</h1><p>(mock)</p></body></html>`;

function registerStaticRoutes(app: FastifyInstance) {
  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(HOMEPAGE_HTML);
  });

  app.get("/extensions.html", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(EXTENSIONS_HTML);
  });

  app.get("/pdf/shop.png", async (_request, reply) => {
    return reply.type("image/png").send(TRANSPARENT_PNG);
  });

  app.get("/Flymdnew.png", async (_request, reply) => {
    return reply.type("image/png").send(TRANSPARENT_PNG);
  });

  app.get("/favicon.ico", async (_request, reply) => {
    return reply.type("image/x-icon").send(PLACEHOLDER_ICO);
  });

  app.get("/update-extra.json", async (_request, reply) => {
    return sendOk(reply, 200, {
      items: [
        { text: "官方网站", href: "http://127.0.0.1:8787/" },
        { text: "插件市场", href: "http://127.0.0.1:8787/extensions.html" },
      ],
    });
  });

  app.get("/announcements.json", async (_request, reply) => {
    return sendOk(reply, 200, {
      version: 1,
      announcements: [
        {
          id: "mock-welcome",
          title: "欢迎使用 flymd web server",
          message: "由 web/server/ Fastify 提供服务。",
          duration_ms: 5000,
        },
      ],
    });
  });

  app.get("/plugins/index.json", async (_request, reply) => {
    return sendOk(reply, 200, {
      version: 1,
      updated_at: new Date().toISOString(),
      items: [
        {
          id: "mock-plugin-hello",
          name: "Hello World (mock)",
          version: "1.0.0",
          author: "flymd web server",
          description: "由 Fastify 提供的占位插件。",
          main: "main.js",
        },
      ],
    });
  });
}

// ============================================================
// B. ASR 后端(/asr/api/*)
// ============================================================

function registerAsrRoutes(app: FastifyInstance) {
  app.post("/asr/api/auth/login", async (request, reply) => {
    const body = (request.body || {}) as { username?: string; password?: string };
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return sendError(reply, 400, "username/password required");

    // legacy 模式:用 in-memory users(从 web/server.js 移植)
    const u = legacyUsers.get(username);
    if (!u || u.password !== password) return sendError(reply, 401, "invalid credentials");
    u.token = "tok_" + Math.random().toString(36).slice(2, 18);
    return sendOk(reply, 200, { token: u.token, username, balance_min: u.balance_min });
  });

  app.post("/asr/api/auth/register", async (request, reply) => {
    const body = (request.body || {}) as { username?: string; password?: string };
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (username.length < 3 || username.length > 32) return sendError(reply, 400, "username 长度需为 3~32");
    if (password.length < 6 || password.length > 64) return sendError(reply, 400, "password 长度需为 6~64");
    if (legacyUsers.has(username)) return sendError(reply, 409, "username already exists");
    const u = { password, balance_min: 999, token: null as string | null };
    legacyUsers.set(username, u);
    u.token = "tok_" + Math.random().toString(36).slice(2, 18);
    return sendOk(reply, 201, { token: u.token, username, balance_min: u.balance_min });
  });

  app.get("/asr/api/auth/me", async (request, reply) => {
    const u = findLegacyByToken(getBearer(request));
    if (!u) return sendError(reply, 401, "unauthorized");
    return sendOk(reply, 200, { username: u.username, balance_min: u.balance_min });
  });

  app.post("/asr/api/auth/logout", async (_request, reply) => {
    return sendOk(reply, 200, { ok: true });
  });

  app.get("/asr/api/billing/status", async (request, reply) => {
    const u = findLegacyByToken(getBearer(request));
    if (!u) return sendError(reply, 401, "unauthorized");
    return sendOk(reply, 200, {
      balance_min: u.balance_min,
      used_min: 0,
      plan: "mock",
      server_time: Math.floor(Date.now() / 1000),
    });
  });

  app.post("/asr/api/billing/redeem", async (request, reply) => {
    const u = findLegacyByToken(getBearer(request));
    if (!u) return sendError(reply, 401, "unauthorized");
    const body = (request.body || {}) as { token?: string };
    const key = String(body.token || "").trim();
    if (!key) return sendError(reply, 400, "卡密为空");
    u.balance_min += key.startsWith("MOCK-") ? 1000 : 100;
    return sendOk(reply, 200, { ok: true, balance_min: u.balance_min });
  });
}

// ============================================================
// C. AI 代理(OpenAI 兼容)
// ============================================================

function registerAiRoutes(app: FastifyInstance) {
  app.post("/ai/ai_proxy.php", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    if (Array.isArray(body.messages)) {
      return streamChatCompletion(reply, body);
    }
    return sendOk(reply, 200, {
      id: "cmpl-" + Math.random().toString(36).slice(2, 10),
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: (body.model as string) || "flymd-mock-1",
      choices: [{ text: "[mock] " + String(body.prompt || ""), index: 0, finish_reason: "stop" }],
    });
  });

  app.post("/ai/ai_proxy.php/v1/chat/completions", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    if (body.stream === true) return streamChatCompletion(reply, body);
    const messages = (body.messages as Array<{ role: string; content: string }>) || [];
    const last = [...messages].reverse().find((m) => m?.role === "user");
    return sendOk(reply, 200, {
      id: "chatcmpl-" + Math.random().toString(36).slice(2, 10),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: (body.model as string) || "flymd-mock-1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: `[mock] 收到:"${last?.content?.slice(0, 200) || ""}"` },
          finish_reason: "stop",
        },
      ],
    });
  });

  app.post("/ai/ai_proxy.php/v1/completions", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    return sendOk(reply, 200, {
      id: "cmpl-" + Math.random().toString(36).slice(2, 10),
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: (body.model as string) || "flymd-mock-1",
      choices: [{ text: "[mock completion] " + String(body.prompt || ""), index: 0, finish_reason: "stop" }],
    });
  });

  app.post("/ai/ai_proxy.php/v1/embeddings", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const input = Array.isArray(body.input) ? body.input : [String(body.input || "")];
    return sendOk(reply, 200, {
      object: "list",
      data: input.map((_, i) => ({
        object: "embedding",
        embedding: Array.from({ length: 8 }, (_, j) => Math.sin((i + 1) * (j + 1) * 0.13)),
        index: i,
      })),
      model: (body.model as string) || "flymd-mock-embed",
    });
  });

  app.post("/ai/audio_proxy.php", async (_request, reply) => {
    return sendOk(reply, 200, {
      text: "[mock] 音频转录 mock 返回的固定文本。",
      language: "zh",
      duration: 0,
    });
  });
}

function streamChatCompletion(reply: any, body: Record<string, unknown>) {
  const model = (body.model as string) || "flymd-mock-1";
  const messages = (body.messages as Array<{ role: string; content: string }>) || [];
  const last = [...messages].reverse().find((m) => m?.role === "user");
  const userText = last?.content || "";
  const reply2 = `[mock] 你说:"${userText.slice(0, 100)}"。这是 mock 响应。`;
  const id = "chatcmpl-" + Math.random().toString(36).slice(2, 10);
  const created = Math.floor(Date.now() / 1000);

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const chunks: string[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const s = Math.floor((reply2.length * i) / n);
    const e = Math.floor((reply2.length * (i + 1)) / n);
    chunks.push(reply2.slice(s, e));
  }
  let i = 0;
  function send() {
    if (i >= chunks.length) {
      reply.raw.write(
        "data: " +
          JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }) +
          "\n\n",
      );
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
      return;
    }
    const isFirst = i === 0;
    reply.raw.write(
      "data: " +
        JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            { index: 0, delta: isFirst ? { role: "assistant" } : {}, content: chunks[i] },
          ],
        }) +
        "\n\n",
    );
    i++;
    setTimeout(send, 60);
  }
  send();
  return reply;
}

// ============================================================
// D. AI 小说引擎(/xiaoshuo/*)
// ============================================================

function registerXiaoshuoRoutes(app: FastifyInstance) {
  app.post("/xiaoshuo/auth/login", async (request, reply) => {
    const body = (request.body || {}) as { username?: string; password?: string };
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return sendError(reply, 400, "username/password required");
    let u = legacyUsers.get(username);
    if (!u) {
      u = { password, balance_min: 999, token: null };
      legacyUsers.set(username, u);
    } else if (u.password !== password) {
      return sendError(reply, 401, "invalid credentials");
    }
    u.token = "tok_" + Math.random().toString(36).slice(2, 18);
    return sendOk(reply, 200, { ok: true, token: u.token, username });
  });

  app.post("/xiaoshuo/auth/register", async (request, reply) => {
    const body = (request.body || {}) as { username?: string; password?: string };
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return sendError(reply, 400, "username/password required");
    if (legacyUsers.has(username)) return sendError(reply, 409, "username already exists");
    const u = { password, balance_min: 999, token: null as string | null };
    legacyUsers.set(username, u);
    u.token = "tok_" + Math.random().toString(36).slice(2, 18);
    return sendOk(reply, 201, { ok: true, token: u.token, username });
  });

  app.get("/xiaoshuo/billing/status", async (request, reply) => {
    const u = findLegacyByToken(getBearer(request));
    if (!u) return sendError(reply, 401, "ok: false");
    return sendOk(reply, 200, { ok: true, username: u.username, balance_min: u.balance_min });
  });

  app.post("/xiaoshuo/billing/redeem", async (request, reply) => {
    const u = findLegacyByToken(getBearer(request));
    if (!u) return sendError(reply, 401, "ok: false");
    const body = (request.body || {}) as { token?: string };
    const key = String(body.token || "").trim();
    if (!key) return sendError(reply, 400, "ok: false");
    u.balance_min += key.startsWith("MOCK-") ? 1000 : 100;
    return sendOk(reply, 200, { ok: true, balance_min: u.balance_min });
  });

  app.post("/xiaoshuo/ai/proxy", async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    if (body.stream === true) return streamChatCompletion(reply, body);
    return sendOk(reply, 200, {
      ok: true,
      id: "chatcmpl-" + Math.random().toString(36).slice(2, 10),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: (body.model as string) || "flymd-mock-1",
      choices: [
        { index: 0, message: { role: "assistant", content: "[xiaoshuo mock]" }, finish_reason: "stop" },
      ],
    });
  });
}

// ============================================================
// E. PDF 服务
// ============================================================

function registerPdfRoutes(app: FastifyInstance) {
  app.get("/pdf/:rest", async (request, reply) => {
    const params = request.params as { rest: string };
    if (params.rest === "shop.png") {
      return reply.type("image/png").send(TRANSPARENT_PNG);
    }
    return sendOk(reply, 200, {
      status: "mock",
      file: params.rest,
      message: "PDF mock server: 真实服务请部署 pdf2doc 后端",
    });
  });
}

// ============================================================
// 共享:legacy users 内存表 + bearer token 工具
// ============================================================

type LegacyUser = { password: string; balance_min: number; token: string | null; username?: string };

const legacyUsers = new Map<string, LegacyUser>();
[
  { username: "demo", password: "demo123", balance_min: 999 },
  { username: "admin", password: "admin123", balance_min: 9999 },
  { username: "test", password: "test123", balance_min: 60 },
].forEach((u) => legacyUsers.set(u.username, { ...u, token: null }));

function getBearer(request: any): string | null {
  const h = String(request.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function findLegacyByToken(token: string | null): (LegacyUser & { username: string }) | null {
  if (!token) return null;
  for (const [name, u] of legacyUsers.entries()) {
    if (u.token === token) return { ...u, username: name };
  }
  return null;
}

// ============================================================
// 入口
// ============================================================

export function registerLegacyMockRoutes(app: FastifyInstance) {
  registerStaticRoutes(app);
  registerAsrRoutes(app);
  registerAiRoutes(app);
  registerXiaoshuoRoutes(app);
  registerPdfRoutes(app);
}
