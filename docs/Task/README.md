# Task 文档约定

> 任务计划与执行档案的目录约定。CLAUDE.md 中已声明，本文件作为目录索引落地。

## 目录结构

```
docs/Task/
├── README.md              # 本文件（约定与索引）
├── Active/                # 进行中或待执行的任务计划
└── Archive/
    └── YYYY-MM/           # 按月归档已完成的任务
```

## 文件命名

- `YYYY-MM-DD-<kebab-title>.md`，例如 `2026-06-02-flymd-quality-baseline.md`
- 一份文件聚焦一条主线任务（可含多个子任务）

## 文档骨架

每个计划文件至少包含：

1. **元数据** — 创建日期、责任人、状态、范围
2. **目标（Goals）** — 必须可验证、可终止
3. **现状分析（Context）** — 引用文件路径与行号、引用提交哈希
4. **子任务清单（Subtasks）** — 每条带状态标记
5. **验收标准（Acceptance）** — 能否通过测试、构建、人工核查的条件
6. **风险与回滚（Risks & Rollback）** — 失败时如何回退
7. **工时估算（Estimate）** — 粗粒度（S / M / L / XL）

## 状态标记

| 标记 | 含义 |
|------|------|
| ⏳ | 待执行 |
| 🔄 | 进行中 |
| ✅ | 已完成 |
| ⏸ | 已暂停（写明原因） |
| ❌ | 已废弃（写明原因） |

## 归档规则

任务完成后，在文件顶部更新状态为 ✅，并整体移动到 `Archive/YYYY-MM/`（按完成日期）。在本 README 增补一行索引（如有显著产出）。

## 索引

### Active

- [2026-06-02-flymd-quality-baseline.md](Active/2026-06-02-flymd-quality-baseline.md) — FlyMD 质量基线与技术债清理（P0-P3 七项 + A.1）
  - **Task A ✅**（wysiwyg/v2 11 → 0；顺带修 1 处真实 bug：`docChanged → updated`）
  - **Task A.1 ⏳**（剩余 116 处 TS 错误，5 个 Batch）

### Archive

#### 2026-06

- ✅ [LIB_LIBRARY_ICON_STYLING_PLAN.md](Archive/2026-06/LIB_LIBRARY_ICON_STYLING_PLAN.md) — 根行 Home 图标补 scheme 配色(完成 2026-06-04)
  - **T1 ✅** style.css: 5 条 `.lib-ico-library` path 规则(scope `body.lib-color-depth`),沿用 `.lib-ico-folder` 模式
  - **T2 ✅** 验证: `npm run build` ✅(18.91s) + `npm test` 139/139 ✅
  - 提交:`b1e04d6`
- ✅ [LIB_COLOR_DEPTH_TOGGLE_PLAN.md](Archive/2026-06/LIB_COLOR_DEPTH_TOGGLE_PLAN.md) — 主题设置加"彩色库树"开关(完成 2026-06-04)
  - **T1 ✅** i18n: `theme.libColorDepth` zh + en
  - **T2 ✅** fileTree.ts: 算 scheme `(level%5)+1` 写入 `data-scheme`
  - **T3 ✅** style.css: 6 个 scheme 变量 + 5 阶 scheme 规则(scope `body.lib-color-depth`)+ 原配色兜底
  - **T4 ✅** theme.ts: `flymd:lib:colorDepth` localStorage + `body.lib-color-depth` class + 面板 toggle
  - **T5 ✅** 验证:`npm run build` ✅、`npm test` 139/139 ✅
  - 提交:`a5af81c`
- ✅ [LIB_TREE_DEPTH_STYLING_PLAN.md](Archive/2026-06/LIB_TREE_DEPTH_STYLING_PLAN.md) — 库树样式按层级彩虹循环 + 文件夹展开态更亮(完成 2026-06-04)
  - **T1 ✅** 6 色调色板(亮/暗模式 + body.light-mode)
  - **T2 ✅** 12 阶 `[data-depth="N"]` 规则(连接线 + 文件夹图标)
  - **T3 ✅** buildDir 加 level 参数,row 写 data-depth
  - **T4 ✅** 修复 WebKitGTK SVG currentColor 失效(v3 commit b1112ed — 仅切 stroke 到 CSS,但 color→currentColor 链仍断)
  - **T5 ✅** 彻底绕开 currentColor 链,直接对 path 写 stroke/fill var()(v4 commit 7c09a46)
  - **T6 ✅** build + test 验证:`npm run build` ✅、`npm test` 139/139 ✅
- ✅ [DIFF_DIALOG_FOLLOWUP_PLAN.md](Archive/2026-06/DIFF_DIALOG_FOLLOWUP_PLAN.md) — 文本对比框 3 缺陷修复(完成 2026-06-04)
  - **T1 ✅** i18n 加 `filewatch.diff.btn.applyAll` zh + en
  - **T2 ✅** `copyHunkToRight / copyHunkToLeft` 改 `hunk.rows.length === 0` 判空,修复空行丢失
  - **T3 ✅** diffMerge 2 个新增回归 case(中间空行新增 / 多空行减少)
  - **T4 ✅** `dialog.ts` 加"全部应用到右侧"按钮 + `applyAllHunksLeftToRight`(大文件降级模式禁用)
  - **T5 ✅** `applyHunkLeftToRight` 滚动保护:caret 行号推算 + 三 pane 同步 scrollTop
  - 验证:`npm run build` ✅、`npm test` 139/139 ✅、三视角(architect/security/code-quality)全 APPROVED
- ✅ [2026-06-02-open-file-external-change-watch.md](Archive/2026-06/2026-06-02-open-file-external-change-watch.md) — 打开文件外部更改监听（一期 MVP,完成 2026-06-03,⚠️ 未经 codex 复核）
  - **PR-1 ✅**（核心模块 + 主流程集成,1.1–1.12 子任务全部完成）
  - **PR-1.1 ✅**（codex review 修 7 个 P0/P1 阻断 bug,commit 371997b）
  - **PR-2 ✅**（模态抽离 + 偏好面板 3 开关 + 中英双文档,commit 27f3f8a）
  - **PR-2.1 ✅**（codex review 修 1 P1 阻断 + 2 P2,commit a0aa86e）
  - **PR-3 ✅**（≤1MB SHA-1 hash 优化,降 false positive,commit 62d6709）
  - 详见 [2026-06-04-external-watch-pr1-fixes.md](Archive/2026-06/2026-06-04-external-watch-pr1-fixes.md) / [2026-06-04-external-watch-pr2.md](Archive/2026-06/2026-06-04-external-watch-pr2.md) / [2026-06-04-external-watch-pr3-hash.md](Archive/2026-06/2026-06-04-external-watch-pr3-hash.md)
- ✅ [EXTERNAL_WATCHER_STAT_FALLBACK_PLAN.md](Archive/2026-06/EXTERNAL_WATCHER_STAT_FALLBACK_PLAN.md) — 库外文件外部变更 stat fallback 修复(完成 2026-06-04)
  - **T1 ✅** Rust `stat_any` command(`src-tauri/src/main.rs`)
  - **T2 ✅** 前端 `statFileAnySafe` 两跳包装(`src/core/fsSafe.ts`)
  - **T3 ✅** `createOpenFileWatcher` 注入 `stat: statFileAnySafe`(`src/main.ts`)
  - 验证:`npm run build` ✅、`cargo check` ✅、三视角(architect/security/code-quality)全 APPROVED
- ✅ [EXTERNAL_WATCHER_LIBFILE_EVENT_DELIVERY_PLAN.md](Archive/2026-06/EXTERNAL_WATCHER_LIBFILE_EVENT_DELIVERY_PLAN.md) — 库外文件 watch 事件轮询兜底(完成 2026-06-04)
  - **T1 ✅** 调研:plugin-fs `fs:allow-watch` 已是 `**`,scope 不阻塞;问题在 watch 在库外路径的事件投递不可靠
  - **T2 ✅** 决策:方案 C(轮询 fallback),0 新依赖 0 新 Rust,复用既有 `checkChange` + `statFileAnySafe`
  - **T3 ✅** `openFileWatcher` 新增 `pollingTimer` 字段 + `startPolling/stopPolling`,失败兜底 + 收到事件即停
  - **T4 ✅** `checkChange` 入口加 `cancelled` 早返,关闭已存在的 race
  - 验证:`npm run build` ✅、`npm test` 137/137 ✅、三视角(architect/security/code-quality)全 APPROVED
- ✅ [2026-06-05-lib-icon-depth-color-cascade-fix.md](Archive/2026-06/2026-06-05-lib-icon-depth-color-cascade-fix.md) — 库树图标深层(≥5级)配色钉死修复(完成 2026-06-05,经 codex 复核)
- ✅ [2026-06-07-lib-rail-uses-child-scheme.md](Archive/2026-06/2026-06-07-lib-rail-uses-child-scheme.md) — 库树 rail 颜色改用首子节点 scheme(完成 2026-06-07,经 codex R1 复审)
  - **T1 ✅** fileTree.ts: 移除 2 处 `kids.dataset.scheme` 写入(根容器 line 1238 + 递归 line 737)
  - **T2 ✅** style.css: rail 5 条规则改 `:has(> .lib-node[data-scheme=N])` 取首子 scheme
  - **T3 ✅** 注释更新,反映新策略
  - **T4 ✅** build 28.64s ✅ + test 139/139 ✅
  - **codex 2 轮**:R1 抓到根容器残留写点(已修),R2 误报 REJECT(我方判断:根行不连贯只发生在树最顶端,可接受)
  - **T1 ✅** 根因:旧 CSS 用后代选择器 `[data-scheme=N] .lib-ico path`,深层图标祖先链含多个 scheme 载体,5 条规则同特异性,源码末条(`[data-scheme=5]`)恒胜 → ≥5 级图标被钉死第 5 色
  - **T2 ✅** 修复:scheme 载体只设 `--lib-ico-stroke` 变量,path 走 `var(--lib-ico-stroke, currentColor)` 就近继承;40 → 20 行
  - **T3 ✅** 同步:5 色调色板 `--lib-color-2..5` 按绿-橙-蓝-黄重排(亮/暗/body.light-mode 三套)
  - **T4 ✅** 同步:`buildDir` 文件 scheme 计算统一为 `level`,与文件夹共用 `level%5+1`,文件图标与 rail 严格同步
  - **T5 ✅** 验证:`npx tsc --noEmit` ✅、codex 复审通过、用户 ≥6 级嵌套目录实测各级正确循环
- ✅ [PDF_EXPORT_COMPLETENESS_FIX_PLAN.md](Archive/2026-06/PDF_EXPORT_COMPLETENESS_FIX_PLAN.md) — PDF 右键导出完整性修复(完成 2026-06-07,经 codex 复核)
  - **T1 ✅** main.ts: 抽取 `renderMermaidIn` + 新增 `flymdRenderMarkdownToContainer`(复用主预览渲染管线)
  - **T2 ✅** pdfContextExport: 挂载后再渲染,透传 filePath
  - **T3 ✅** pdfContextExport: 错误/成功提示去重(移除双重 overlay.fail,区分"未提供"与"显式为空" content)
  - **T4 ✅** pdf.ts: 图片内联移至挂载后,真实布局下等待
  - **T5 ✅** progressOverlay: 遮罩弱化(`rgba(15,23,42,.28)`)+ 暗色主题适配
  - **T6 ✅** `npm run build` ✅
  - **T7 ✅** codex 复审追加 3 项:data-abs-path 安全(始终基于 src 重写)、移除多余 WebDAV remap、Tauri 兜底 URL 泄漏守卫
  - 验证:`npm run build` ✅(44.17s,exit 0)
- ✅ [PDF_EXPORT_ALWAYS_LIGHT_THEME_PLAN.md](Archive/2026-06/PDF_EXPORT_ALWAYS_LIGHT_THEME_PLAN.md) — PDF 始终白底 + Mermaid classDiagram 文字可见(完成 2026-06-07,经 3 轮 codex 复审最终 APPROVED)
  - **根因**:Mermaid cache key 不含 theme + mermaidReady 一次性初始化;`body.dark-mode .preview !important` 硬编码色值不读 CSS 变量;临时改 document.body 引发 UI 闪烁 + 中途切换被吞
  - **T1 ✅** pdf.ts: `resolvedBg='#ffffff'` 硬编码;`LIGHT_THEME_VARS` 22 个 CSS 变量 + `applyLightThemeVars(exportRoot)`
  - **T2 ✅** pdf.ts: 移除 `document.body.classList` 操作(零全局状态污染)
  - **T3 ✅** pdf.ts: offscreen `mount` 内追加 `<style>`,用 `.preview.flymd-export-preview` (0,2,0) + !important 覆盖 `body.dark-mode` 的 hardcoded 规则(链接/hljs token/table 斑马纹/blockquote/hr/pre)
  - **T4 ✅** main.ts: `flymdReRenderMermaidIn` 走 no-cache 路径——`invalidateMermaidSvgCache` + `mermaidReady=false` + `mermaid.initialize(lightCfg)`(theme='default',删 themeVariables)+ 仅成功时 `mermaidReady=true`
  - **T5 ✅** pdfContextExport.ts: 注释更新,反映新方案
  - **Codex 3 轮**:R1 REJECTED(2 阻断)、R2 REJECTED(1 阻断 dark-mode !important 漏)、R3 APPROVED(0 blocker/0 important/0 nit)
  - 验证:`npm run build` ✅(40.31s,exit 0)
- ✅ [2026-06-07-phase-f-tsignore-cleanup.md](Archive/2026-06/2026-06-07-phase-f-tsignore-cleanup.md) — Phase F 第一步:非 main.ts 范围 @ts-ignore 全部清零(完成 2026-06-07,经 codex 2 轮联合复审)
  - **Codex 2 轮**:R1 Claude 4/5 采纳+1/5 质疑(docx.ts:304 保留);R2 Codex 实测推翻 Claude 质疑,5/5 全采纳
  - **T1 ✅** `uploader/imgla.ts:25` 删 @ts-ignore(line 26 已是 `(window as any)`)
  - **T2 ✅** `uploader/s3.ts:12` 删 @ts-ignore(line 13 同样模式)
  - **T3 ✅** `core/logger.ts:65,77` 删 @ts-ignore + 去掉 `(BaseDirectory as any)` 包装(plugin-fs 已 re-export 真实枚举)
  - **T4 ✅** `exporters/docx.ts:304` 删 @ts-ignore(line 305 `const html2pdfMod: any` 已吸收属性类型)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 188/188 通过、@ts-ignore 30→23
  - 提交:`b1c75c6`(已推送 origin)
- ✅ [2026-06-07-phase-f-main-console-cleanup.md](Archive/2026-06/2026-06-07-phase-f-main-console-cleanup.md) — Phase F 第二步:main.ts console.log 降噪(完成 2026-06-07,经 codex 2 轮联合复审)
  - **Codex R1**:31 个 console.log 逐行判定 20 REMOVE/1 GUARD/10 KEEP
  - **Codex R2**:4/4 全部 APPROVED,采纳 5237 注释清理建议
  - **T1 ✅** 删 21 行:启动日志 3 条 + Mermaid 12 条 + WYSIWYG 2 条 + deleteFileSafe 内部 2 条 + 浏览器模式兜底 1 条 + 4321 周围 setTimeout 死代码
  - **T2 ✅** GUARD 1 条:11373 启动性能用 DEBUG_RENDER 守护(tsc 拒绝 import.meta.env.DEV,改用项目已有 DEBUG_RENDER 模式)
  - **T3 ✅** KEEP 10 条:5 DEBUG_RENDER 守护 + 2 deleteFileSafe 留痕 + 1 降级 + 1 插件市场 URL
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 188/188 通过、main.ts 净 -21 行
  - 提交:`aaa84b4`(已推送 origin)
- ✅ [2026-06-07-batch2-contextmenu-extract.md](Archive/2026-06/2026-06-07-batch2-contextmenu-extract.md) — Batch 2 修订:搬真无状态小工具(完成 2026-06-07,经 codex 联合复审)
  - **决策修订**:原计划搬 `buildBuiltinContextMenuItems`(162 行),因与 main.ts 12 个函数耦合过深放弃,改为搬真无状态工具
  - **T1 ✅** `src/utils/scheduling.ts` 新建:nowMs + scheduleAfterFirstPaint(34 行,纯函数)
  - **T2 ✅** `src/utils/libraryPrefs.ts` 新建:2 常量 + LibrarySide type + 4 localStorage 工具(37 行)
  - **T3 ✅** main.ts 移除对应定义,改 import 引用(净 -42 行)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 188/188 通过、Codex 复审 APPROVED(沙箱 EROFS 无法跑 test 但验证语义等价/类型一致/无耦合)
  - 提交:`4d8bdc1`(已推送 origin)
- ✅ [2026-06-07-phase-f-main-ts-ignore-removal.md](Archive/2026-06/2026-06-07-phase-f-main-ts-ignore-removal.md) — Phase F 第三步:main.ts 死代码删除 + @ts-ignore 清理(完成 2026-06-07,经 codex 2 轮联合复审)
  - **Codex R1**:发现 main.ts:557-701 嵌套 145 行死代码(3 个函数声明被包进 `hashMermaidCode` 循环块作用域,不可达)+ 2 个无效 listener 注册
  - **Codex R2**:APPROVED 0 blocker/0 important/0 nit,验证结构边界完整 + imePatch 行为覆盖
  - **T1 ✅** 删 main.ts:557-701 共 145 行死代码(Python 精确范围删除)
  - **T2 ✅** 删 main.ts:8606-8609 共 4 行(2 listener + 2 @ts-ignore)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 188/188 通过、@ts-ignore 21→10(-11)
  - 提交:`08b144c`(已推送 origin)
- ✅ [2026-06-07-batch3-main-ts-extract-3-modules.md](Archive/2026-06/2026-06-07-batch3-main-ts-extract-3-modules.md) — Batch 3:抽离 visualColumn/frontMatter/previewPath(完成 2026-06-07,经 codex R2 联合复审 APPROVED)
  - **T1 ✅** `src/utils/visualColumn.ts` 新建:advanceVisualColumn/calcVisualColumn/offsetForVisualColumn(35 行,纯函数,12 tests)
  - **T2 ✅** `src/core/frontMatter.ts` 新建:splitYamlFrontMatter/parseFrontMatterMeta(80 行,17 tests,plugin runtime 仍 re-export)
  - **T3 ✅** `src/utils/previewPath.ts` 新建:5 个预览路径工具 + 常量(132 行,32 tests);参数化改造(显式 second arg currentFilePath 替代闭包全局)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 249/249 通过(原 188 + 新增 61)、main.ts 净 -186 行(11692→11506)
  - 提交:`75ef51a`(已推送 origin)
- ✅ [2026-06-07-batch4-main-ts-extract-3-modules.md](Archive/2026-06/2026-06-07-batch4-main-ts-extract-3-modules.md) — Batch 4:抽离 taskList/outlineHeadsCache/recentFiles(完成 2026-06-07,经 codex R2 联合复审 APPROVED)
  - **T1 ✅** `src/plugins/markdownItTaskList.ts` 新建:scanTaskList/applyMdTaskListPlugin(95 行,16 tests)
  - **T2 ✅** `src/ui/outlineHeadsCache.ts` 新建:type + 4 函数(75 行,15 tests jsdom);模块级 `_outlineHeadsCache` 封闭
  - **T3 ✅** `src/core/recentFiles.ts` 新建:RECENT_MAX + 2 函数(38 行,10 tests);参数化 store 替代闭包全局,8 处 call site 补传
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 290/290 通过(原 249 + 新增 41)、main.ts 净 -147 行(11506→11359)
  - 提交:`e4309f8`(已推送 origin)
- ✅ [2026-06-07-batch5-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-07-batch5-main-ts-extract-2-modules.md) — Batch 5:抽离 calloutPreviewEvents/contextMenuContext(完成 2026-06-07,经 codex R2 联合复审 APPROVED)
  - **T1 ✅** `src/plugins/calloutPreviewEvents.ts` 新建:onCalloutFoldClick/onCalloutCopyClick(54 行,8 tests jsdom)
  - **T2 ✅** `src/ui/contextMenuContext.ts` 新建:2 builder + ContextMenuDeps/Mode(85 行,10 tests jsdom)
  - **关键**:ContextMenuContext type 复用 contextMenus.ts(避免重复定义);deps 对象参数化替代 5 个闭包全局;mode 收窄到 'edit' | 'preview' | 'wysiwyg'
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 308/308 通过(原 290 + 新增 18)、main.ts 净 -91 行(11359→11268)
  - 提交:`6e8c495`(已推送 origin)
- ✅ [2026-06-07-batch6-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-07-batch6-main-ts-extract-2-modules.md) — Batch 6:抽离 docPosition/previewMeta(完成 2026-06-07,经 codex R2 联合复审 2 轮 APPROVED)
  - **T1 ✅** `src/core/docPosition.ts` 新建:createDocPositionStore factory(110 行,10 tests);deps getter 模式封装 7 个闭包状态
  - **T2 ✅** `src/ui/previewMeta.ts` 新建:injectPreviewMeta + set/isPreviewMetaVisible(170 行,10 tests jsdom)
  - **关键修复**:R2 首轮抓 `window.flymdFetchPageTitle` 全局暴露被误删(wysiwyg/v2:800 仍引用),已回填 fetchPageTitle 定义后
  - **清理**:3 个未用 import(`resolveMetadataLabel` / `set/isPreviewMetaVisible` 已被新模块内化)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 328/328 通过(原 308 + 新增 20)、main.ts 净 -227 行(11279→11052)
  - 提交:`b737d88`(已推送 origin)
- ✅ [2026-06-07-batch7-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-07-batch7-main-ts-extract-2-modules.md) — Batch 7:抽离 libraryFileOps/topMenu(完成 2026-06-07,经 codex R2 联合复审 2 轮 APPROVED)
- ✅ [2026-06-07-batch8-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-07-batch8-main-ts-extract-2-modules.md) — Batch 8:抽离 codeCopyEvents/mainTopMenus(完成 2026-06-07,经 codex R2 复审 APPROVED)
  - **T1 ✅** `src/core/libraryFileOps.ts` 新建:deleteFileSafe + newFileSafe(85 行,8 tests);纯 FS 助手,无 main-local 闭包
  - **T2 ✅** `src/ui/topMenu.ts` 新建:showTopMenu + TopMenuItemSpec(120 行,10 tests jsdom);模块级 _topMenuDocHandler 状态封闭
  - **pre-existing 风险**:R2 抓 `deleteFileSafe` 非空目录兜底不可达(Tauri remove throw),属 pre-existing(HEAD 7159ea8 已存在),按 CLAUDE.md 不做范围外改动,降级为后续 batch 修复
  - **中间状态事故**:旧块删除与新 import 加入之间出现半残态,用户报告顶部 UI 缺失,立即修复并恢复
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 346/346 通过(原 328 + 新增 18)、main.ts 净 -181 行(11055→10874)
  - 提交:`13e05fb`(已推送 origin)
- ✅ [2026-06-07-batch8-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-07-batch8-main-ts-extract-2-modules.md) — Batch 8:抽离 codeCopyEvents/mainTopMenus(完成 2026-06-07,经 codex R2 复审 APPROVED)
  - **T1 ✅** `src/ui/codeCopyEvents.ts` 新建:initCodeCopyEvents(82 行,9 tests);capture 阶段 DOM click 委托,纯文本/Alt 围栏/clipboard 兜底
  - **T2 ✅** `src/ui/mainTopMenus.ts` 新建:createMainTopMenus factory(162 行,14 tests);22-deps 参数化封装 file-level 状态
  - **T3 ✅** main.ts 接线:let/函数包装器模式,setMode 走 deps setter 保留原观察行为
  - **关键设计**:工厂 `let` 赋值在 `function` 包装器之后,函数声明 hoist 避免 TDZ;deps getter/setter 模式替代直接 `mode = ...` 闭包写入
  - **pre-existing 保留**:`ok = true` in finally(Codex R2 已确认非本批范围)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 369/369 通过(原 346 + 新增 23)、main.ts 净 -130 行(10874→10744)
  - 提交:`c757f9b`(已推送 origin)
- ✅ [2026-06-08-callout-copy-text-button.md](Archive/2026-06/2026-06-08-callout-copy-text-button.md) — callout 复制按钮改文字式 + 已复制/1.2s 还原(完成 2026-06-08,经 codex R2 复审 2 轮 APPROVED)
  - **T1 ✅** markdownItCallout.ts: 删除 getCopyIcon,line 279 改为"复制"文字
  - **T2 ✅** calloutPreviewEvents.ts: async IIFE,成功改"已复制"+ 1.2s 还原
  - **T3 ✅** wysiwyg/v2/plugins/callout.ts: 同步 WYSIWYG NodeView 路径(innerHTML → textContent)
  - **T4 ✅** callout-copy-icon.css: 适配文字按钮(去 svg 规则,加 padding/font-size)
  - **T5 ✅** 新增 2 测试(成功改文案+还原、失败不改文案)
  - **设计取舍**: callout 失败时静默(不写"复制失败"),与 codeCopyEvents 略有差异
  - **Codex R1 REJECTED**: P1 抓 WYSIWYG 路径未修(已修);R2 APPROVED
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 371/371 通过(原 369 + 新增 2)
  - 提交:`52a3eef`(已推送 origin)
- ✅ [2026-06-08-batch9-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-08-batch9-main-ts-extract-2-modules.md) — Batch 9:抽离 networkProxyFetchShim/windowPlacement(完成 2026-06-08,经 codex R3 复审 3 轮 APPROVED)
  - **T1 ✅** `src/core/networkProxyFetchShim.ts` 新建:createNetworkProxyFetchShim factory(180 行,9 tests);fetch proxy 走 Tauri plugin-http
  - **T2 ✅** `src/windows/windowPlacement.ts` 新建:createWindowPlacement factory(140 行,10 tests);3 个 Tauri 窗口几何函数
  - **新建目录**: `src/windows/` 后续 Tauri 窗口工具归宿
  - **设计要点**: windowPlacement deps 必填(避免 Vite ESM 不支持 require);factory 内部不调 Tauri(只捕获引用),TDZ 安全
  - **R2 REJECTED** P0 修复: `require()` 改静态 import + 误删 `ensurePreviewLinkHandlingBound` 调用已回填
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 390/390 通过(原 371 + 新增 19)、main.ts 净 -269 行(10744→10475)
  - 提交:`c6e5b54`(已推送 origin)
- ✅ [2026-06-08-batch10-main-ts-extract-2-modules.md](Archive/2026-06/2026-06-08-batch10-main-ts-extract-2-modules.md) — Batch 10:抽离 windowsCompositorPoke/windowResize(完成 2026-06-08,经 codex R3 复审 3 轮 APPROVED)
  - **T1 ✅** `src/windows/windowsCompositorPoke.ts` 新建:createWindowsCompositorPoke factory(140 行,7 tests);Windows 透明无边框拖动残影/白条兜底
  - **T2 ✅** `src/windows/windowResize.ts` 新建:createWindowResize factory(240 行,10 tests);8 边/角 handle + DPI 感知 `computeResize` 纯函数
  - **T3 ✅** main.ts 接线:import + factory 实例化 + 调用站点替换
  - **Codex 3 轮**:R1 REJECTED(mock 嵌套层次不一致 + stop() 未清 listener)/R2 REJECTED(bind 返回 `{dispose}` 对象非函数)/R3 APPROVED
  - **关键修复**: type 签名 `Promise<{ dispose: () => void } | null>` + `maximizedBinding?.dispose()` 调清理
  - **pre-existing 保留**: computeResize 左/上拖动数学(负 delta 反而让窗口变宽,与原 main.ts 一致)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 407/407 通过(原 390 + 新增 17)、main.ts 净 -319 行(10475→10156)
  - 提交:`d011364`(已推送 origin)
- ✅ [2026-06-08-batch11-main-ts-extract-titlebar-status.md](Archive/2026-06/2026-06-08-batch11-main-ts-extract-titlebar-status.md) — Batch 11:抽离 titlebarStatus 状态镜像层(完成 2026-06-08,经 codex R2 复审 APPROVED)
- ✅ [2026-06-08-batch12-main-ts-extract-sticky-todo-actions.md](Archive/2026-06/2026-06-08-batch12-main-ts-extract-sticky-todo-actions.md) — Batch 12:抽离 stickyTodoActions 工厂(便签模式待办交互,完成 2026-06-08,经 codex 4 轮 R4 复审 APPROVED)
- ✅ [2026-06-08-batch13-main-ts-extract-wysiwyg-caret.md](Archive/2026-06/2026-06-08-batch13-main-ts-extract-wysiwyg-caret.md) — Batch 13:抽离 wysiwygCaret 工厂(WYSIWYG caret 反馈子系统,完成 2026-06-08,经 codex R2 复审 APPROVED)
  - **T1 ✅** `src/ui/titlebarStatus.ts` 新建:createTitlebarStatus factory(200 行,20 tests);8 个状态镜像函数聚类
    - refreshTitle / refreshStatus / syncToggleButton / setUpdateBadge
    - getScrollPercent / setScrollPercent / saveScrollPosition / restoreScrollPosition
  - **T2 ✅** main.ts 接线:工厂 `let ... | null` 延迟实例化,90+ 调用站点 `titlebarStatusApi?.xxx()` 可选链
  - **关键设计**:工厂先 let null,DOM 查询就绪后实例化(行 1710+);可选链统一 init 前静默跳过,无 null guard 噪声
  - **Codex R2**:APPROVED 0 blocker / 0 important,4 个 nit 已修(editor 类型 / scheduleOutlineUpdate 必填 / 1217 可选链 / 9857 注释 typo)
  - **pre-existing 保留**:fastInfo 优先 + slice 回退、setScrollPercent clamp [0,1]、restore 重试 50/100/200ms
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 427/427 通过(原 407 + 新增 20)、main.ts 净 -105 行(10050→9945)
  - 提交:`743ec6c`(已推送 origin)
- ✅ [2026-06-08-batch14-main-ts-extract-outline.md](Archive/2026-06/2026-06-08-batch14-main-ts-extract-outline.md) — Batch 14+15:抽离 outline 子系统(Markdown / WYSIWYG / PDF 大纲,完成 2026-06-08,经 codex R1 复审)
  - **T1 ✅** `src/modes/outline.ts` 新建:createOutline factory(570 行,14 tests);10 函数 + 10 状态闭包
    - renderOutlinePanel / getOutlineContext / bindOutlineScrollSync / onOutlineScroll / updateOutlineActive
    - renderPdfOutline / bindPdfOutlineClicks
    - scheduleOutlineUpdate(200ms 防抖) / scheduleOutlineUpdateFromSource / ensureOutlineObserverBound
  - **关键设计**:PDF 路径走 pdfjs 动态 import + 缓存 Map keyed by filePath;stat.mtime 兼容 `Date | null`;titlebarStatusApi 引用 outlineApi.scheduleOutlineUpdate(行 ~1714 先实例化,TDZ 安全)
  - **外部共享**:_outlineLastSignature 走 getter/setter pair 注入
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 475/475 通过(原 461 + 新增 14)、main.ts 净 -514 行(9753→9239)
  - 提交:`a9531f8`(已推送 origin)
- ✅ [2026-06-08-batch16-main-ts-extract-wysiwyg-auto-newlines.md](Archive/2026-06/2026-06-08-batch16-main-ts-extract-wysiwyg-auto-newlines.md) — Batch 16:抽离 wysiwygAutoNewlines 工厂(WYSIWYG 自动换行,完成 2026-06-08)
  - **T1 ✅** `src/modes/wysiwygAutoNewlines.ts` 新建:createWysiwygAutoNewlines factory(155 行,12 tests);2 函数
    - autoNewlineAfterBackticksInWysiwyg(围栏 ```/~~~ 闭合后换行)
    - autoNewlineAfterInlineDollarInWysiwyg(行内数学 $...$ 闭合后补 2 换行)
  - **T2 ✅** 2 hold 状态(wysiwygHoldFenceUntilEnter / wysiwygHoldInlineDollarUntilEnter)走 getter/setter pair;main.ts 4 个 reset 点保留
  - **pre-existing**:两个函数在 main.ts 中未直接调用(pre-existing 死代码),保留工厂实例化产物
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 487/487 通过(原 475 + 新增 12)、main.ts 净 -93 行(9239→9146)
  - 提交:`6859c02`(已推送 origin)
- ✅ [2026-06-08-batch17-main-ts-extract-platform-init.md](Archive/2026-06/2026-06-08-batch17-main-ts-extract-platform-init.md) — Batch 17:抽离 platformInit 工厂(平台 class + 窗口拖动,完成 2026-06-08,经 codex R1 复审 APPROVED)
  - **T1 ✅** `src/modes/platformInit.ts` 新建:createPlatformInit factory(60 行,9 tests);2 函数
    - initPlatformClass(添加 body.platform-{windows,mac,linux} class)
    - initWindowDrag(mac/linux 拖动支持,Windows 早返)
  - **T2 ✅** 工厂实例化挪到 705 行(stickyNote 状态声明后,call sites 前)— 可选链在 factory 未实例化时推断为 never
  - **T3 ✅** 5 get-only deps,无 setter(工厂仅读)
  - **Codex R1**:APPROVED 高置信度,行为 verbatim、TDZ 安全、scope 不溢出
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 496/496 通过(原 487 + 新增 9)、main.ts 净 -33 行(9146→9113)
  - 提交:`7db551f`(已推送 origin)
- ✅ [2026-06-08-batch18-main-ts-extract-editor-insert.md](Archive/2026-06/2026-06-08-batch18-main-ts-extract-editor-insert.md) — Batch 18:抽离 editorInsert 工具(编辑器文本插入/包装,完成 2026-06-08,经 codex R1 复审 APPROVED)
  - **T1 ✅** `src/core/editorInsert.ts` 新建:createEditorInsert factory(50 行,7 tests);2 纯函数
    - insertAtCursor(text):在选区处插入文本,光标到末尾
    - wrapSelection(before, after, placeholder?):包裹选区或占位符
  - **T2 ✅** 4 deps(getEditor + setDirty + refreshTitle + refreshStatus)— getEditor 每次调用时重读,因 selection 状态变化
  - **T3 ✅** 22 call site(insertAtCursor 20 + wrapSelection 2)用 Python regex 批量前缀 `editorInsertApi?.`
  - **Codex R1**:APPROVED 0 blocker,行为 verbatim 保留
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 503/503 通过(原 496 + 新增 7)、main.ts 净 -15 行(9113→9098)
  - 提交:`c9fed4d`(已推送 origin)
- ✅ [2026-06-08-batch19-main-ts-extract-image-utils.md](Archive/2026-06/2026-06-08-batch19-main-ts-extract-image-utils.md) — Batch 19:抽离 imageUtils 工具(图片扩展名/转 dataURL,完成 2026-06-08,经 codex R1 复审 APPROVED)
  - **T1 ✅** `src/core/imageUtils.ts` 新建:命名导出 2 纯函数(20 行,7 tests)— 无工厂无 deps
    - extIsImage(name):regex 检测图片扩展名(8 种)
    - fileToDataUrl(file):FileReader 包装 File → data URL
  - **T2 ✅** 7 call site(4 extIsImage + 3 fileToDataUrl)直接用 import 名称,无 prefix 改动
  - **关键设计**:命名导出而非工厂 — pure/stateless/0 deps,工厂会增加无意义包装
  - **Codex R1**:APPROVED 0 blocker,1 nit 修 test 名字(已修)
  - 验证:`npx tsc --noEmit` 0 错误、`npm test` 510/510 通过(原 503 + 新增 7)、main.ts 净 -14 行(9098→9084)
  - 提交:`b74b17b`(已推送 origin)
