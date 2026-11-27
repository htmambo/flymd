# 安全与性能加固（体检建议落地）

**状态**: ✅ 已完成 (完成时间: 2026-11-27)
**责任人**: fullauto
**范围**: 预览 XSS 链、应用内 DOM 注入、CSP、Tauri 权限、更新链路、入口分包、大文档渲染、web/server 默认配置
> 对应 fullauto 状态：.omc/fullauto/sec-perf-hardening/state.json

## 任务目标

把 2026-11-27 体检报告中的 P0/P1 项落地为可验证的代码改动，P2/P3 项按可行性取舍并记录。

## 问题分析

- 预览默认不消毒 + `html: true` + `innerHTML` 注入 + `csp: null` + 文件系统能力 `"**"`，构成「打开恶意 md → 任意文件读写 → 提权执行」的完整链。
- 大纲面板、最近文件面板把文档标题/文件名拼进 `innerHTML`，可独立触发 XSS。
- 所见模式 Mermaid `securityLevel: 'loose'`。
- 更新下载走第三方代理且无摘要校验；`run_installer` 把路径拼进 PowerShell 命令串。
- 入口静态闭包 7.04MB，其中 Mermaid 6.32MB（根因是入口静态导入了落在 mermaid 块里的 `__vitePreload`）。
- 分屏/编辑模式大文档每 150ms 全量重渲染。
- `web/server` 在配置里写有明文默认管理员口令与可预测的 JWT 密钥回退值，口令为快哈希，登录无限流。

## 子任务列表

- [x] T1 预览消毒默认开启 + 单测（fail-closed、DEV-only 逃生开关）
- [x] T2 CSP 落地 + 启动错误脚本外置
- [x] T3 大纲 / 最近文件 DOM 注入修复 + 单测
- [x] T4 所见模式 Mermaid strict（二次 SVG 消毒撤销，见 Runtime Decisions）
- [x] T5 Tauri capability 收敛 + 关闭 devtools
- [x] T6 更新链路硬化（https/域名/文件名/大小/摘要、安装器参数注入）
- [x] T7 Mermaid 移出入口闭包 + 门禁增强（7.04MB → 0.69MB）
- [x] T8 大文档渲染防抖自适应
- [x] T9 web/server 默认配置与认证硬化
- [x] T10 文档归档与验收记录

## 每个子任务的改动内容

见 `.omc/plans/fullauto-sec-perf-hardening-impl.md`。

## 预期效果和验收标准

- `pnpm build` 通过，入口闭包不含 Mermaid 且 ≤ 3MB。
- `pnpm typecheck`、`pnpm test` 全绿。
- 恶意 HTML 在预览/大纲/最近文件三处均不产生可执行节点。
- 发行版 CSP 生效（人工冒烟：阅读、KaTeX、Mermaid、图片、WebDAV、AI 请求）。

## 风险评估和缓解措施

- 消毒/CSP 可能误伤渲染：保留本地逃生开关；新增渲染冒烟单测；CSP 放宽到 http/https/data/blob。
- 分包调整可能引入循环依赖：构建后静态检查入口 HTML 与 chunk 闭包。
- Rust 改动无法完整编译验证：最小化改动，`cargo check` 尽力验证并记录未测试项。

## 实施顺序和依赖关系

T1 → T3 → T4 → T2 → T5 → T6 → T7 → T8 → T9 → T10。
T2/T5 只改配置，可与 T1 并行；T7 独立于安全项。

## 阶段 0 输出（spec）

- 路径：.omc/fullauto/sec-perf-hardening/spec.md
- 包含：## Assumptions Made / ## Decisions Made / 非目标 / 残余风险

## 实施计划

- 路径：.omc/plans/fullauto-sec-perf-hardening-impl.md（含 ## Runtime Decisions）

## 外部审核意见（Phase 0/1/4）

- provider: coding-bridge
- verdict: 未参与
- 原因：`API HTTP 429: Token Plan Person monthly quota limit exceeded`；codex MCP 本会话未连接。
- 替代：本地 typecheck / 1156 单测 / build / cargo check / 3 个独立 subagent 复核（计划阶段 2 个、实现阶段 3 个）。

## QA 记录

- `pnpm typecheck`：通过
- `pnpm test`：92 个文件 / 1157 个用例通过
- `pnpm build`：通过；入口静态闭包 0.69MB，不含 mermaid；`drag-ghost.js` 已外置
- `cargo check --manifest-path src-tauri/Cargo.toml --tests`：通过（exit 0）
- `cargo test ... download_hardening_tests`：5 passed
- web/server：依赖未安装，未跑 tsc/vitest；esbuild 语法检查通过；限流单测 4/4 通过

## 验证

- 路径：.omc/fullauto/sec-perf-hardening/validation.md
- 未测试项：Tauri 真机冒烟（PDF/插件/字体/Mermaid/KaTeX/本地图片/WebDAV/AI）、Windows 更新安装、web/server 全量构建。

## 验收结论

- 代码门禁全绿；安全链的“执行 JS”入口已关闭。
- 残余风险：webview 仍具备 fs `"**"` / opener `"**"` / http `*:*` 能力；插件无签名；凭据仍存于 Tauri Store 明文。均记录为后续项。
