# Phase F 第二步:main.ts console.log 降噪(Codex 联合决策)

| 字段 | 内容 |
|---|---|
| 创建日期 | 2026-06-07 |
| 责任人 | 果农 + Claude + Codex 复审 |
| 状态 | 🔄 进行中 |
| 关联 | `2026-06-07-phase-f-tsignore-cleanup.md` |

## 0. 决策依据

**生产构建已剥离 console**(vite.config.ts:28-31 `esbuild.drop: ['console', 'debugger']`),所以降噪是**开发期收益**,不影响生产。

Codex read-only 审查 31 个 main.ts console.log,逐行给出 KEEP/REMOVE/GUARD 判定,结果 **20 REMOVE / 1 GUARD / 10 KEEP**。所有 REMOVE 决定均经 Claude 交叉验证:每条删除点都有 `logInfo`/`console.error` 失败兜底或属于 normal-path 噪音。

## 1. 待删除清单(20 条 REMOVE)

| 行 | 内容 | 兜底 |
|---|---|---|
| 2755 | `[WYSIWYG] buildWysiwygV2FromTextarea, editor.value length` | 失败走 catch 块 |
| 3776 | `初始化应用存储...` | 3781 `logInfo('应用存储初始化成功')` |
| 3780 | `存储初始化成功` | 3781 `logInfo('应用存储初始化成功')` |
| 4230 | `=== 开始 Mermaid 渲染流程 ===` | 408/422/435 已 DEBUG_RENDER 守护 |
| 4233 | `找到 language-mermaid 代码块数量` | 同上 |
| 4247 | `找到 pre.mermaid 元素数量` | 同上 |
| 4259 | `找到 N 个 Mermaid 节点` | 同上 |
| 4284 | `Mermaid 已初始化` | 失败走 catch |
| 4297 | `渲染 Mermaid 图表 N` | 同上 |
| 4303 | `Mermaid 图表 N 使用缓存` | 同上 |
| 4309 | `Mermaid 图表 N 首次渲染完成` | 同上 |
| 4314 | `Mermaid 图表 N SVG 元素` | 同上 |
| 4328 | `Mermaid 图表 N 已插入 DOM` | 同上 |
| 4331 | `Mermaid 图表 N 检查 DOM 中是否存在` | 同上 |
| 5254 | `[WYSIWYG] 打开文档后自动启用所见模式` | 5256 `console.error` 失败路径 |
| 8040 | `[deleteFileSafe] 调用 move_to_trash` | 8035/8046 KEEP |
| 8044 | `[deleteFileSafe] 回收站删除后检查文件是否存在` | 8035/8046 KEEP |
| 10888 | `窗口关闭监听注册失败(浏览器模式)` | 浏览器模式预期,无 action |
| 11079 | `flyMD (飞速MarkDown) 应用启动...` | 11080 `logInfo('打点:JS启动')` |
| 11401 | `应用初始化完成` | 11402 `logInfo('应用初始化完成')` |
| 11421 | `[WYSIWYG] 默认启用所见模式` | 11423 `console.error` 失败路径 |

## 2. GUARD(1 条)

| 行 | 内容 | 处理 |
|---|---|---|
| 11393 | `[启动性能] { initMs, domReadyMs, firstRenderMs }` | 改为 `if (import.meta.env.DEV) console.log(...)` —— 开发期性能数据有用 |

## 3. KEEP(10 条)

408, 422, 435, 3910, 4054(DEBUG_RENDER 守护);8035, 8046(删除文件留痕);11447(降级绑定);11617(插件市场 URL);20043? (无)— 实际只 9 条 KEEP,加 1 GUARD = 10。

## 4. 风险

| 风险 | 缓解 |
|---|---|
| 4331 周围有 setTimeout 死代码 | Codex 已提示,删除时一并清理 |
| 用户/开发者依赖特定 log 排错 | KEEP 列表保留所有失败路径与关键状态点 |
| logInfo 写入磁盘,log 不写 | 实际上 logInfo 是用 console.warn/error 包装,等价 |

## 5. 验收

- [ ] main.ts console.log 数量: 31 → 11(-20)
- [ ] `npx tsc --noEmit` 0 错误
- [ ] `npm test` 188/188 通过
- [ ] Codex 第二轮复审通过
