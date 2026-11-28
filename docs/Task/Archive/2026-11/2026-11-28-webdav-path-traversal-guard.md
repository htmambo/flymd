# WebDAV 同步路径穿越防护（webdav-path-traversal-guard）

**状态**: ✅ 已完成 (开始时间: 2026-11-28，完成时间: 2026-11-28)

## 任务目标

WebDAV 远端返回的文件名/相对路径不可信。本轮在扫描与执行两个环节加校验，确保同步写入不会落到库根之外。

## 问题分析

- `listRemoteDir` 对 `href` 先 `decodeURIComponent`，再按 `/` 切段取最后一段作为文件名；反斜杠不参与切分，`..\..\x.md` 这类名字可以穿过。
- `scanLocal` 的本地条目名同样不做分隔符校验；Linux 上含反斜杠的名字上传后，Windows 端会按目录分隔符解释。
- 执行阶段统一拼接 `localRoot + sep + act.rel`（共 8 处），旧元数据里的历史键也可能带 `..`。

攻击后果：恶意/被控 WebDAV 服务器返回 `a%5C..%5C..%5Cevil.md`，同步即写出库根（Windows 上尤其成立）。

## 改动内容

- 新增 `src/extensions/webdavPath.ts`：
  - `sanitizeRemoteEntryName`：单段名，拒绝 `/`、`\`、NUL、控制字符、冒号（Windows ADS）、`.`/`..`；
  - `sanitizeSyncRelPath`：`\` 归一为 `/`，丢弃空段与 `.`，出现 `..` 直接拒绝；
  - `resolveLocalSyncPath`：安全拼接，不安全返回 `null`。
- `webdavSync.ts`：
  - `listRemoteDir` / `tryListRemoteInfinity` / `scanLocal` 三处入口过滤不安全名字，并写同步日志 `[*-skip-unsafe-name|rel]`；
  - `processTask` 执行前对 `act.rel` 复验（覆盖旧元数据与未来新增分支），不安全则跳过并返回失败结果。
- 新增 `src/extensions/webdavPath.test.ts`：8 个用例覆盖 POSIX/Windows 拼接、`..`、反斜杠、ADS、控制字符。

## 验收标准

- `vitest run src/extensions/webdavPath.test.ts`：8/8 通过。
- 全量 `pnpm test`：97 文件 / 1187 用例通过；`pnpm typecheck` 通过。
- 正常文件名（含中文、空格、点）同步行为不变。

## 风险与缓解

- 含冒号的文件名（Linux/macOS 合法）会被跳过并记日志；跨平台同步本身无法在 Windows 落地此类名字，属可接受的行为收敛。
- 只做字符串层校验，不做符号链接检测；远端 WebDAV 无法创建本地符号链接，本地扫描侧由既有逻辑处理。

## QA 记录

- 定向 8/8；全量 1187/1187；typecheck 通过。
- 外部审核：未参与（coding-bridge HTTP 429 月度配额耗尽；codex MCP 连接关闭）。
