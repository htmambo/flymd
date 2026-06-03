# 打开文件外部更改监听 — PR-2

> PR-1 + PR-1.1 已完成并归档。本期做体验/可维护性收尾:把模态抽到 dialog.ts、接偏好面板 3 开关、写 User 文档。

## 元数据

| 字段 | 值 |
|---|---|
| 创建日期 | 2026-06-04 |
| 状态 | ✅ 已完成 (完成时间: 2026-06-04) |
| 范围 | UX 收尾 + 文档(不影响 PR-1 核心行为) |
| 预计工时 | M(半天) |

## 子任务

### 2.1 模态抽到 dialog.ts(本轮先做)
- 文件:`src/dialog.ts`(已有)
- 新增 `showFileWatchConflictChoice(filePath: string): Promise<'reload' | 'keep' | 'cancel'>`
- 同时把 `escapeHtml` 工具函数也抽到 dialog.ts(避免 main.ts 末尾重复)
- main.ts 删除内联 `showFileWatchConflictDialog` / `escapeHtml`,装配改 import
- 复用 dialog.ts 现有 `.custom-dialog-*` 样式(已存在,无需新增 CSS)

### 2.2 偏好面板 3 开关 + 持久化
- 文件:`src/core/uiPreferences.ts`(或类似),`src/i18n.ts`,`src/main.ts`(偏好 UI 段)
- Store key:`externalFileWatch` = `{ enabled, autoReloadClean, debugLog }`,默认值 `{ enabled: true, autoReloadClean: true, debugLog: false }`
- extWatcherIntegration deps 改为**动态读取** store 状态(从 `() => boolean` 改为 `() => store.get('externalFileWatch')?.enabled ?? true`)
- 偏好面板加 3 个开关 UI 控件(checkbox 或 switch),即时写回 store
- 监听 store 变化:enabled 变化时调 extWatcherIntegration.setEnabled(enabled)
- 调试日志开关:watcher 内部 logDebug 已支持,集成层可读 store 控制更细粒度调试

### 2.3 User 文档
- 文件:`docs/Usage/EXTERNAL_FILE_WATCH_GUIDE.md`(中文)+ `docs/Usage/EXTERNAL_FILE_WATCH_GUIDE.en.md`(英文)
- 内容:功能范围、行为策略(干净标签自动重载 / 脏标签弹模态 / 删除转草稿)、限制(仅激活标签、无网盘兜底)、troubleshooting(为什么没弹提示)

### 2.9 验收 + 归档 + commit
- tsc 0 错误;build 干净
- 桌面环境跑偏好面板三开关 + 模态 + 文档链接可达
- 任务文档归档到 Archive/2026-06/
- git commit

## 风险

- 2.2 偏好面板接入可能与现有偏好系统冲突(需 grep 现有偏好 UI 模式)
- 2.2 setEnabled 现在已完整(#7 PR-1.1 修过),但 setEnabled 频繁切换可能引发 watcher 句柄反复建立/释放(性能可接受)
- 2.3 文档需中英双份,工作量加倍

## 验收

- 2.1:确认 main.ts 末尾的 showFileWatchConflictDialog / escapeHtml 删除,import from dialog.ts,功能不变
- 2.2:打开偏好面板,看到 3 开关;关闭"总启用"后外部修改无任何反应;重新开启后恢复;关-开-关各跑一次
- 2.3:从主菜单的"帮助/文档"或类似入口能看到 EXTERNAL_FILE_WATCH_GUIDE 链接

## 完成情况

- **2.1** ✅:showFileWatchConflictDialog / escapeHtml 抽到 dialog.ts 顶部;`FileWatchConflictChoice` 类型导出;integration.ts 删 `conflictModalMessage` 死代码 + `basenameOf` 死函数;main.ts 改 import。tsc 0,build 干净。
- **2.2** ✅:`FileWatchPrefs` 类型 + `getFileWatchPrefs()` / `setFileWatchPrefs(p)` store-backed 工具;`showFileWatchPrefsDialog` 模态(3 switch,i18n 全量接入,默认焦点在"关闭");`文件` 菜单加入口;logger 注入受 `debugLog` 控制;总开关变化时 setEnabled 同步刷新 watcher 句柄;`window.flymdOpenFileWatchPrefs` 暴露。tsc 0,build 干净。
- **2.3** ✅:`docs/Usage/EXTERNAL_FILE_WATCH_GUIDE.md`(中文)+ `.en.md`(英文),含概述/行为/偏好/限制/故障排查/实现细节。
