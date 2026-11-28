# 插件安装链路 hostile 输入集成测试（plugin-install-integration-tests）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

`pluginPath` 的净化函数已有单测，但 `runtime.ts` 的安装流程（远端 manifest 下载、本地目录复制）尚未被端到端验证。本轮补一组集成测试，锁定"恶意 manifest / 恶意源目录不会写出 `${PLUGINS_DIR}/<id>` 边界"。

## 问题分析

- 此前只有 `pluginPath.test.ts` 覆盖纯函数，`installPluginFromGitCore` / `installPluginFromLocalCore` 的组合行为（净化发生在写盘之前、assets 逐个跳过、本地条目名与 symlink 过滤）没有回归保护。
- 这类测试需要 Tauri IPC，直接调用会依赖真实文件系统；用内存假实现可以在 vitest node 环境里完整跑通。

## 改动内容

- 新增 `src/extensions/runtimeInstall.test.ts`：
  - `vi.mock('@tauri-apps/plugin-fs')` 提供内存文件系统（记录所有写盘路径）；
  - `vi.mock('@tauri-apps/plugin-http')` 提供 URL 路由表，替代真实网络；
  - 远端安装：`id: "../evil"` 拒绝且零写盘；`main: "../../x.js"` 拒绝；`assets` 中 `../escape.png` / `C:/abs.png` / `CON.png` 被跳过，合法资源全部落在 `flymd/plugins/good-plugin/` 内；
  - 本地安装：条目名 `..`、`a/b.js`、symlink 被跳过，仅复制合法文件；manifest `id: ".."` 拒绝且零写盘。

## 验收标准

- `vitest run src/extensions/runtimeInstall.test.ts`：5/5 通过。
- 全量 `pnpm test`：96 文件 / 1179 用例通过。
- `pnpm typecheck` 通过。

## 风险与缓解

- 断言基于 mock 调用记录，若将来安装流程改走其他 fs 封装（如 Rust 命令），测试会失败而不是静默失效——属于期望行为。
- mock 的 `writeFile` 不校验 `baseDir`，但断言了路径前缀，边界覆盖等价。

## QA 记录

- 定向测试 5/5；全量 1179/1179；typecheck 通过。
- 外部审核：未参与（coding-bridge 返回 HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
