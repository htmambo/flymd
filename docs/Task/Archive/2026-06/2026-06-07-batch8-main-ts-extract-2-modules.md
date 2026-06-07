# Batch 8:抽离 codeCopyEvents / mainTopMenus

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**提交**: `c757f9b`(已推送 origin)
**复审**: Codex R2 APPROVED(0 blocker / 0 important / 3 nit)

## 目标

继续 Phase B main.ts 模块化拆分。本批抽离 2 个独立模块:
1. `codeCopyEvents`:纯 DOM 驱动的代码块"复制"按钮 click 委托,无 main-local 闭包
2. `mainTopMenus`:工厂模式构造文件/模式下拉菜单 items,封装 22 个闭包依赖

## 现状分析

- main.ts HEAD 10874 行,本批前批次已抽离 7 个模块(见归档索引)
- codeCopyEvents 原块(8648-8712,64 行):纯 DOM click 委托(capture 阶段),无 main-local 状态依赖
- showFileMenu/showModeMenu 原块(7237-7340,104 行):与 file-level `mode`/`wysiwyg` 闭包强耦合,适合工厂 + deps getter/setter 模式

## 子任务清单

### T1 ✅ `src/ui/codeCopyEvents.ts` 新建
- 导出 `initCodeCopyEvents()`(82 行,纯函数)
- capture 阶段 document click 委托
- 默认复制纯文本;Alt+click 复制 Markdown 围栏(向后兼容)
- clipboard API 失败 → textarea + execCommand 兜底
- 按钮文案:已复制/复制失败 + 1.2s 还原
- 9 个单元测试,覆盖:默认/Alt/无语言/data-copy-target/execCommand 兜底/按钮文案还原/非 .code-copy 忽略/__copyText 预设
- **pre-existing 行为保留**:`try { ok = true }` 在 finally 块内无条件执行,execCommand 返回 false 仍显示"已复制"(归档 TODO 后续 batch 修复,不属于本批范围)

### T2 ✅ `src/ui/mainTopMenus.ts` 新建
- 导出 `createMainTopMenus(deps: MainTopMenusDeps): { showFileMenu, showModeMenu }` 工厂(162 行)
- 22-deps 参数化接口:
  - 工具: `t` / `getAutoSave` / `isPortableModeEnabled`
  - 文件操作: `openFile2` / `saveFile` / `saveAs` / `renderRecentPanel` / `handleExportConfigFromMenu` / `handleImportConfigFromMenu` / `togglePortableModeFromMenu` / `openFileWatchPrefsDialog`
  - 模式/滚动: `saveScrollPosition` / `restoreScrollPosition` / `setWysiwygEnabled` / `notifyModeChange` / `syncToggleButton` / `updateChromeColorsForMode` / `renderPreview`
  - DOM 引用: `preview` / `editor`
  - 状态: `getMode` / `setMode` / `getWysiwyg`
  - 全局钩子: `flymdGetSplitPreviewEnabled?` (可选)
- 14 个单元测试,覆盖:文件菜单 9 项 label/自动保存 ✔ 前缀/便携模式 ✔ 前缀/翻译键缺失回退/锚点查找/缺锚点不做事/autoSave.toggle 调用;模式菜单 4 项/锚点/分屏 ✓ 前缀/编辑模式无 setMode/预览模式切编辑链路/阅读模式切换渲染/分屏缺全局函数时 alert 兜底

### T3 ✅ main.ts 接线
- 新增 import:`createMainTopMenus` + `initCodeCopyEvents`
- 删除 showFileMenu/showModeMenu 旧块(104 行) + .code-copy click listener 旧块(64 行)
- 添加 factory instantiation: `let mainTopMenusApi = createMainTopMenus({...22 deps...})` + 函数包装器 `function showFileMenu() { mainTopMenusApi.showFileMenu() }` / `function showModeMenu() { mainTopMenusApi.showModeMenu() }`
- `setMode: (m) => { mode = m }` 通过 deps setter 替代原直接 `mode = 'preview'` 写入
- `t: t as (key: string) => string` cast:main.ts `t` 是窄 i18n 键 union,工厂需宽 string

### T4 ✅ 验证
- `npx tsc --noEmit` 0 错误
- `npm test` 369/369 通过(原 346 + 新增 23)
- main.ts 净 -130 行(34+ / 164-):10874 → 10744

## 验收标准

- [x] tsc 0 错
- [x] 全部测试通过
- [x] 行为等价(从原块逐行迁移,无非预期改动)
- [x] Codex R2 APPROVED
- [x] 提交 + 推送完成

## Codex R2 复审结果

**VERDICT**: APPROVED
**Blockers (P0)**: None
**Important (P1)**: None
**Nits (P2)**:
- `codeCopyEvents.test.ts:45` `initCodeCopyEvents()` 在每个 beforeEach 调用无 listener 清理,跨测试累积,当前断言仍过但可能掩盖未来 call-count 回归
- `main.ts:7249` `t as (key: string) => string` 可接受但可用更窄的 menu-key 类型去除 cast
- `codeCopyEvents.ts:23` + `mainTopMenus.ts:148` 继承的 `as any` cast 可通过局部 element/global Window 接口收紧

## 风险与回滚

- **接线顺序**:`let mainTopMenusApi = createMainTopMenus({...})` 在 `function showFileMenu()` 包装器之后。函数声明 hoist 不会 TDZ,但首次调用点(`bindEvents` 内的 listener 注册)在文件很靠后,实际赋值的工厂调用远早于首次触发,无风险。Codex 复审确认。
- **pre-existing 行为**:`ok = true` in finally 是 main.ts 旧块既有问题,本批严格行为保留。`flymdGetSplitPreviewEnabled` 改用 deps getter 替代原 `window.flymdGetSplitPreviewEnabled?.()` 访问,语义等价。
- **回滚方案**:`git revert c757f9b`

## 工时估算

实际: ~1 小时(Batch 7 已建立模块化节奏,2 模块 + 23 测试 + 复审一次过)

## 备注

- Batch 7 事故教训应用:本次新 import 在删除旧块前加入,避免半残态 UI
- 累计 Phase B 抽离模块数:8(visualColumn / frontMatter / previewPath / taskList / outlineHeadsCache / recentFiles / calloutPreviewEvents / contextMenuContext / docPosition / previewMeta / libraryFileOps / topMenu / codeCopyEvents / mainTopMenus)
- main.ts 累计净减:约 1300 行(11692 → 10744)
- 测试覆盖:188 → 369(累计 +181 测试)
- 后续 batch 候选(待 R1 提名):menuManager 拆分 / plugin runtime 暴露块 / 杂项 setter 集中化
