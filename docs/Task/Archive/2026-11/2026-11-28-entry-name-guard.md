# 新建 / 重命名单段名校验（entry-name-guard）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

库内新建文件 / 文件夹 / 重命名最终都是 `dir + sep + name` 拼接。name 可能来自模板 `tp.filename`、重命名对话框或上下文菜单输入；含分隔符或 `..` 时会直接写到库外。

## 问题分析

- `newFileSafe` / `newFolderSafe`（`libraryFileOps.ts`）对 name 不做校验。
- 模板路径：`extractFilenameFromTemplate` 会把 `\ / : * ? " < > |` 替换为 `_`，模板来源基本安全；
- 但 `openRenameDialog` 返回原始输入，`main.ts` 的 `renamePathWithDialog` 直接 `base + sep + newStem + ext`；输入 `../x` 或 `a/b` 就能把文件移出原目录。`renameFileSafe`（fsSafe）同样未校验。
- 上下文菜单的新建文件/文件夹复用上述两个函数，输入同样未过滤。

## 改动内容

- 新增 `src/core/pathSafety.ts`：`assertSafeEntryName`——拒绝空名、`.`/`..`、`/`、`\`、冒号（盘符 / ADS）、控制字符；不做 trim（保留 POSIX 合法空格）。
- `src/core/libraryFileOps.ts`：`newFileSafe` / `newFolderSafe` 入口校验。
- `src/core/fsSafe.ts`：`renameFileSafe` 校验新名。
- `src/main.ts`：`renamePathWithDialog` 在校验失败时 alert 并中止（不再依赖 catch 里的通用错误提示）。
- `src/ui/libraryContextMenu.ts`：新建文件/文件夹失败时把错误信息提示给用户（此前仅 console.error）。
- 测试：
  - 新增 `src/core/pathSafety.test.ts`（2 用例）；
  - `libraryFileOps.test.ts` 增加 newFileSafe / newFolderSafe 的越界与非法名用例，并断言拒绝时零写盘；
  - mock 增加 `mkdir` 以覆盖 newFolderSafe。

## 验收标准

- 定向：pathSafety / libraryFileOps / fsSafe / libraryFileOpsGuard 共 37 用例通过。
- 全量 `pnpm test`：103 文件 / 1218 用例通过；`pnpm typecheck`、`pnpm build` 通过。
- 正常命名（含 Unicode、空格、点）行为不变。

## 风险与缓解

- 含 `/` 的名字不再支持“顺手建子目录”；原实现也没有该语义（会直接拼成路径），现在改为明确报错。
- `renameFileSafe` 的其它调用点（AI 标题重命名）传入的是已净化名字，不受影响。

## QA 记录

- 定向 37/37；全量 1218/1218；typecheck / build 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽，codex MCP 连接关闭）。
