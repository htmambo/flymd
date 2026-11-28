# 插件更新检查加固（plugin-update-check-hardening）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

插件更新检查会对每个已安装插件拉取远端 manifest。旧实现 `Promise.all` 全量并发、且远端 manifest 无体积上限：插件较多时一次性打出几十个请求，异常/恶意响应可把内存打满。

## 问题分析

- `getPluginUpdateStates` 对 N 个插件同时发起请求，无并发控制。
- `fetchRemoteManifestVersion` 复用 `fetchTextSmart`，但没有 manifest 体积上限；安装路径已加上限，更新路径遗漏。
- 并发逻辑与网络细节耦合，难以稳定单测（测试环境中并发动态 import 有干扰，真实应用不受影响）。

## 改动内容

- 新增 `src/core/concurrency.ts`：`runWithConcurrency(items, limit, fn)`，固定并发上限，任一任务抛错整体 reject，空列表/非法上限安全降级。
- `src/extensions/runtime.ts`：
  - 新增导出 `PLUGIN_UPDATE_CHECK_CONCURRENCY = 4`；
  - `getPluginUpdateStates` 改用 `runWithConcurrency` 分 4 路处理；
  - `fetchRemoteManifestVersion` 超过 `MAX_PLUGIN_MANIFEST_CHARS` 直接视为无更新。
- 测试：
  - `src/core/concurrency.test.ts`：并发上限、条目少于上限、空列表/非法上限、错误传播（4 用例）；
  - `src/extensions/pluginUpdateCheck.test.ts`：版本读取、超限降级、更高版本返回更新、同版本不返回、无 URL 不发请求（5 用例）。

## 验收标准

- 定向测试 9/9 通过；全量 `pnpm test`：100 文件 / 1203 用例通过。
- `pnpm typecheck`、`pnpm build` 通过。
- 单插件更新检测行为不变；多插件时同时在途请求不超过 4。

## 风险与缓解

- 并发降低后总耗时上限约为 `ceil(N/4) × 单请求预算`；更新检查在后台进行，不阻塞界面。
- 超限 manifest 视为"无更新"而非报错，避免单个异常插件干扰其它插件的检查结果。

## QA 记录

- 定向 9/9；全量 1203/1203；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
