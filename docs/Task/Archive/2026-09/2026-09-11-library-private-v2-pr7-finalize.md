# PR-7 — 文档 + UI 收尾 + 审计（库私有化 v2 最后一个 PR）

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-09-11 |
| 责任人 | 果农 + Claude（协作） |
| 状态 | ✅ 已完成（2026-09-11） |
| 关联 | PR-1 ~ PR-6 全部 |
| 范围 | 3 个新文档 + UI 集成 + main.ts 启动序列 + 注释更新 |

## 0. 目标

库私有化 v2 系列的收尾 PR：
1. **新文档**：主指南（用户角度）+ 插件开发指南 + WebDAV 排除项更新
2. **UI 集成**（PR-6 留尾）：库设置面板加"导出此库配置"按钮 + 二次确认
3. **审计清理**：
   - `libraryConfig.ts` 顶部注释更新（指向 libraryPrivate.ts）
   - main.ts 启动序列加 `installLibraryChangedBridge()` 调用
   - 边界字段审计（ai / search / palette 等已确认全局，文档说明）
4. **不删旧 Store key**（v2.0 兜底保留，v2.1 清理）

## 1. 子任务清单

- [x] **T1** `LIBRARY_PRIVATE_CONFIG_GUIDE.md` (~180 行: 双通道 / 库搬走 / 凭据保护 / 故障排查 / 备份恢复)
- [x] **T2** `PLUGIN_PRIVATE_DATA_GUIDE.md` (~90 行: storage vs scoped 选择指引)
- [x] **T3** `EXTERNAL_FILE_WATCH_GUIDE.md` 加 .flymd 排除说明
- [x] **T4** `librarySettingsDialog.ts` 加"导出此库配置"按钮(无凭据默认 + 探测凭据后二次确认)
- [x] **T5** main.ts 启动序列: 注册 store getter + 挂 library changed 桥接
- [x] **T6** `libraryConfig.ts` 顶部注释更新(三通道说明 + 指向 libraryPrivate.ts)
- [x] **T7** 验证: tsc 0 错 / test 784/785(1 pre-existing 与本 PR 无关) / build 3.20s

## 3.5 实际结果

- 改动文件：8(2 新文档 + 1 i18n + 1 注释 + 1 main.ts + 1 librarySettingsDialog + 1 EXTERNAL_FILE_WATCH 注释 + 1 任务文档)
- 验证：
  - `npx tsc --noEmit` 0 错误
  - `npm test` 784/785 (1 pre-existing previewMeta 失败与本 PR 无关)
  - `npm run build` 成功 3.20s
- 关键设计：
  - 导出 UI 简化流程:无凭据默认导出 → 探测凭据 → 询问是否含凭据重导(避免首次点击即触发敏感操作)
  - 通知用 `NotificationManager.show('announcement', ...)`(NotificationType enum 不含 'info'/'ok')
  - i18n 加 1 个 `common.export` + 复用 PR-6 的 7 个 `lib.settings.exportConfig.*`

## 2. 验收标准

- 3 个文档完整
- 库设置面板"导出"按钮可见可用
- main.ts 启动期正确挂桥 + 注册 store getter
- tsc 0 错 / 全测试通过 / build 成功

## 3. 风险与回滚

- **风险**：低。文档 + UI + 注释，纯增量。
- **回滚**：1 commit revert 即可。

## 4. 工时

- 估算：M（1-2 小时）
- 实际：M（约 1.5 小时）
