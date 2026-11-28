# 目录文档预扫描结果可观测性（scan-result-observability）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

`scan_dirs_doc_presence` 发生截断（超过 50,000 条目）或遍历错误时，结果只是正例子集；旧实现仅 `eprintln`，前端与用户都看不到。本轮把状态变成结构化返回值并在前端记录。

## 问题分析

- 命令返回裸 `Vec<String>`，前端 `invoke<string[]>` 无法得知 `truncated` / `errors`。
- `docs/perf/startup-bench-2026-09.md` 已把「升级到结构体返回」列为后续工作。
- 缓存不变量「只写 true、缺失走懒检查」意味着截断不影响正确性，但排障时缺少信号。

## 改动内容

- `src-tauri/src/main.rs`：
  - 新增 `DocPresenceScanResult { dirs, truncated, errors, visited }`；
  - `scan_dirs_doc_presence` 返回该结构体（`allow` 为空时返回全零结构），保留原有 `eprintln`。
- 新增 `src/core/docPresenceResult.ts`：`normalizeDocPresenceScanResult` 同时接受新结构体与旧数组（回滚/旧测试桩兼容），过滤非字符串。
- `src/fileTree.ts`：预取读取结构体；`truncated || errors > 0` 时 `logWarn('[扫描] 目录文档预扫描结果不完整', ...)`。
- 新增 `src/core/docPresenceResult.test.ts`（3 个用例）。
- `docs/perf/startup-bench-2026-09.md` 更新该行状态。

## 验收标准

- `vitest run src/core/docPresenceResult.test.ts`：3/3；`fileTreeWatchPresence.test.ts` 13 用例整体通过。
- 全量 `pnpm test`：98 文件 / 1190 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- `cargo test`：40 单元 + 15 集成通过。

## 风险与缓解

- 前后端返回类型必须同步升级；前端归一函数对旧数组做了兼容，回滚后端不会崩。
- `error_samples` 未实现（仅计数），如需采样可后续在 Rust 侧保留前 N 条错误路径。

## QA 记录

- 定向 3/3；全量 1190/1190；Rust 55/55；build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
