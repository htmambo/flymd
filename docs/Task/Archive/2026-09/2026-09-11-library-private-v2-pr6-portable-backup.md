# PR-6 — 便携模式 + 配置备份语义重定义

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-1 ~ PR-5（库私有化 v2 整体） |
| 范围 | `src/core/configBackup.ts`（扩 includeLibraries）+ `src/core/portable.ts`（注释更新）+ i18n + 新增导出 helper + 测试 |

## 0. 目标

澄清便携模式与库私有化的边界：
- **便携模式**：仅打包全局（主题/快捷键/全局扩展）—— **不** 包含任何库
- **库配置导出**：新增独立入口，库设置菜单提供"导出此库配置"按钮
  - 不含凭据：仅 config.json（共享段）
  - 含凭据：config.json + local.json（**二次确认**）

## 1. 现状

- `configBackup.ts:collectConfigBackupFiles()` 仅打包 `appdata` + `applocal` 两块
- `portable.ts:exportPortableBackupSilent()` 直接复用 collectConfigBackupFiles → 同样不打包库
- 库设置面板（`librarySettingsDialog.ts`）无"导出"入口

## 2. 子任务清单

- [x] **T1** `configBackup.ts` 扩 `collectConfigBackupFiles(opts?: { includeLibraries?: LibraryBackupSpec[] })`
- [x] **T2** `portable.ts` 注释更新：明示"便携 = 全局 only,库私有跟库走"
- [x] **T3** 新增 `src/core/libraryExport.ts` 库配置导出 helper
- [x] **T5** i18n 加 `lib.settings.exportConfig.*` 中英（7 个 key）
- [x] **T6** `libraryExport.test.ts` 新建 13 用例
- [x] **T7** 验证：tsc 0 错 / test 13 新增通过 / build 2.88s
- [ ] **T4** `librarySettingsDialog.ts` UI 集成（留 PR-7）

## 3.5 实际结果

- 改动文件：4（1 configBackup 扩 / 1 portable 注释 / 1 libraryExport 新模块 / 1 i18n）
- 新增测试：13 用例（全部通过）
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm test` 13 新增通过（总 784/785，1 pre-existing 与本 PR 无关）
  - `npm run build` 成功 2.88s
- UI 集成（库设置面板的"导出"按钮）留 PR-7 收尾（核心 helper 已就绪可被 UI 调用）

## 3. 验收标准

- `npx tsc --noEmit` 0 错误
- `npm test` 全过（新增 8-10 测试）
- `npm run build` 成功
- 手动：库设置面板点"导出"→ 不含凭据导出 → 看是 config.json
- 手动：库设置面板点"导出"→ 含凭据导出 → 二次确认 → local.json + config.json

## 4. 风险与回滚

- **风险**：低。纯增量 + 二次确认护栏。
- **回滚**：1 commit revert 即可。

## 5. 工时

- 估算：M（1-2 小时）
- 实际：S（约 30 分钟,UI 集成未做但核心 helper 完成,留 PR-7 收尾）

## 6. 不在本 PR 范围

- 库"导入"功能（v2.1+ 再议）
- 跨设备 3-way merge 工具
- 库的 zip 打包（用现有的 .flymdconfig 格式）
