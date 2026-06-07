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
