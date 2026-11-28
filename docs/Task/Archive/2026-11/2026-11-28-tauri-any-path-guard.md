# Tauri 任意路径命令参数加固

**状态**: ✅ 已完成 (完成时间: 2026-11-28)
**创建**: 2026-11-28
**创建者**: Claude Code

## 任务目标

给后端 `read_text_file_any` / `write_text_file_any` 等“任意路径”命令增加输入校验，拒绝空路径、NUL、控制字符与明显非法路径，避免畸形输入导致非预期行为或 panic。

## 问题分析

审计发现 fs scope 实际是 `**` 全开（前端 14 类操作 × `allow: ["**"]` + 多个 `$HOME/**` 递归权限），asset scope 同样含 `**`；后端 `read_text_file_any` / `write_text_file_any` 无路径约束，前端 `fsSafe` 在 fs 权限失败时回退到它们。

直接收窄 frontend fs scope 的收益有限（调用会掉进后端任意路径命令），且需要动态 scope + 全路径形态真机覆盖，属于跨前后端大改造，风险超出本轮加固范围。

本次只做后端命令层的输入卫生：拒绝 NUL / 控制字符 / 空路径 / 纯空白，保留所有正常绝对路径行为。

## 子任务列表

- ✅ 1. 梳理后端任意路径命令清单与现有校验
- ✅ 2. 抽取通用路径参数校验函数并接入 6 个任意路径命令
- ✅ 3. Rust 单测覆盖合法与畸形路径
- ✅ 4. cargo test / typecheck / vitest / build 验证

## 预期效果和 acceptance criteria

- 正常绝对路径（Unix / Windows 盘符 / UNC）行为不变。
- NUL / 控制字符 / 空 / 纯空白路径返回明确错误，不进入文件操作。
- `cargo test` 与前端全量验证通过。

## 风险评估和缓解措施

- 风险：某些合法路径含非 ASCII 控制区字符。缓解：只拒绝 C0（U+0000–U+001F）与 U+007F，UTF-8 多字节正常路径不受影响。
- 风险：首个命令调用方传入相对路径。缓解：只做卫生校验，不改变路径解析语义。

## 实施顺序和依赖关系

1 → 2 → 3 → 4。

## 外部审核意见

- review_plan 未调用：外部审核 MCP 配额耗尽（coding-bridge HTTP 429）/ codex 未连接；本次未经过 External Review MCP 审查，以 Rust 单测与本地交叉验证兜底。
