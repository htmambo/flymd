# 配置备份恢复路径校验（config-backup-path-guard）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

`.flymdconfig` 备份文件可由用户从任意来源导入。恢复流程把 `entry.path` 解析为 `{ baseDir, relPath }` 后直接写盘，需要确保恶意条目不能写到应用数据目录之外。

## 问题分析

- `normalizeBackupPath` 会**丢弃** `.` / `..` 段，相对路径穿越已被折叠回前缀内（例如 `applocal/../../evil` → `applocal/evil`），不会逃出 baseDir。
- 但盘符限定路径没有被处理：`applocal/C:/Windows/System32/drivers/etc/hosts` 归一后仍保留 `C:/...` 段。Tauri 的路径解析是 `baseDir.join(relPath)`，在 Windows 上遇到绝对路径会替换 base —— 等于写到任意位置。冒号同时覆盖 NTFS ADS。
- 恢复前按前缀统计 `hasAppDataScope` / `hasAppLocalScope` 并清理目录，因此这类条目不止能写盘，还能触发一次数据清理。

## 改动内容

- `src/core/configBackup.ts`
  - 新增 `hasUnsafeBackupSegment`：拒绝空段、`.`、`..`、含冒号段（盘符 / ADS）、控制字符；
  - `resolveBackupPath` 在归一化后先过该检查，不安全条目返回 `null`（调用方 `continue` 跳过）。
- 新增 `src/core/configBackup.test.ts`（4 用例）：合法前缀解析、相对穿越被折叠、盘符/ADS/控制字符/绝对路径/未知前缀拒绝。

## 验收标准

- `vitest run src/core/configBackup.test.ts`：4/4 通过。
- 全量 `pnpm test`：102 文件 / 1213 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- 正常备份（appdata / applocal / flymd / settings）恢复行为不变。

## 风险与缓解

- 含冒号的合法文件名会被拒绝；备份来源只有应用自身与插件目录，插件 id 正则已排除冒号，实际不受影响。
- `libraryConfig:<id>/...` 这类扩展条目原本就不在 `resolveBackupPath` 的处理范围内（返回 `null`），行为不变。

## QA 记录

- 定向 4/4；全量 1213/1213；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽，codex MCP 连接关闭）。
