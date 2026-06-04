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
