# 动态 fs scope（Tauri 文件访问收窄）

**状态**: ✅ 已完成 (完成时间: 2026-11-28)
**创建**: 2026-11-28
**创建者**: Claude Code

## 任务目标

把 Tauri 文件系统访问从静态 `**` 全开收敛为“运行时按当前库根 / 当前文档所在目录动态授予”的 scope，同时让后端 any 路径命令与前端 fsSafe 兜底不再绕过该 scope。

## 问题分析

- `tauri.conf.json`：14 类 fs 权限均为 `allow: ["**"]`，`$HOME/**` 等递归权限仍在；assetProtocol.scope 也含 `**`。
- 前端约 575 处 fs 调用、60+ 模块，含用户任意路径（打开/新建/重命名/图片/WebDAV/插件/导出）。
- 后端 `read_text_file_any` / `write_text_file_any` / `read_file_bytes_any` / `list_dir_any` / `stat_any` / `write_file_atomic` / `try_lock_file` 无 scope 约束；前端 `fsSafe` 在 fs 权限失败时回退到这些命令。
- 仅改配置不解决实际问题；必须前后端一起改。

## 子任务列表

- ✅ 1. 调研完成：库根由 libraryConfig.LibraryScope 维护；Tauri v2 FsExt::allow_directory 支持运行时授予
- ✅ 2. 设计完成：grant_fs_scope 命令授予库根 + 后端 any 命令统一校验
- ✅ 3. 前端：libraryConfig.setLibraryScopeCache 变化时调用 grant_fs_scope
- ✅ 4. 后端：AppState.library_root + ensure_path_in_library_scope，接入 7 个 any 命令与 2 个 locked wrapper
- ✅ 5. cargo test 43+15 通过、typecheck/vitest/build 通过；真机路径形态回归待用户执行
- ✅ 6. 归档与提交（用户真机验证通过）

## 预期效果和 acceptance criteria

- 静态配置不再含 `**`；fs 权限按运行时 scope 动态授予。
- 后端 any 命令无法访问 scope 外路径（除明确标记为可信的内部路径，如插件目录/缓存）。
- 现有打开/保存/新建/重命名/图片/WebDAV/导出/插件安装功能不回归。
- `cargo test`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。

## 风险评估和缓解措施

- 风险：动态 scope 覆盖不全导致正常文件访问失败。缓解：先只收敛明确可知的库根/当前文档路径，保留插件目录/缓存等内部路径；分阶段实施，每阶段真机回归。
- 风险：后端命令太多、语义不同。缓解：先做只读/写入两大类的统一校验函数，逐个接入。
- 风险：assetProtocol scope 与 fs scope 不同机制。缓解：本次先做 fs，asset 单独评估。

## 实施顺序和依赖关系

1 → 2 → 3 → 4 → 5 → 6；调研结果决定能否安全实施，若不可行则记录结论并停止。

## 外部审核意见

- 未调用：coding-bridge HTTP 429 / codex 未连接；本次未经过 External Review MCP 审查。


## 实施结论与剩余风险

- 已实现：运行时动态授予（库切换时 `grant_fs_scope`）+ 后端 any 路径命令的库根约束，替代纯静态 scope 的“全开”作为真正生效的防线。
- 未实施：静态 `tauri.conf.json` 中 `**` 权限的移除。原因：前端 205 处 plugin-fs 调用中有大量绝对路径在 fsSafe 之前直接调用；库切换、打开对话框路径、临时库、WebDAV 目录的覆盖不完整，贸然收窄到 `$APPLOCALDATA/**` 会在真机造成大范围文件访问失败，且只能靠人工逐项回归发现。
- 需要用户真机验证：打开/保存/新建/重命名任意路径文档、WebDAV 同步、图片/资产加载、插件安装、PDF 导出，确认 grant_fs_scope 的库根约束不误伤正常路径。
- 后续若要做静态收窄，需先把所有 plugin-fs 绝对路径调用收口到统一 helper（带 scope 申请），再逐类改配置。
