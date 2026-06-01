# FlyMD 质量基线与技术债清理

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-06-02 |
| 当前版本 | 1.3.9 |
| 责任人 | 果农 + Claude（协作） |
| 总体状态 | ⏳ 待执行 |
| 覆盖范围 | TS 类型修复 / 模块拆分 / 测试基线 / Tauri 安全 / 体积与样式优化 / 扩展架构演进 |
| 关联分析 | 见会话内"检查并分析当前项目"输出（commit `008ce14` 之后） |
| 关联提交 | `008ce14` 库结构树展开态图标修复（已合并到 `dev`） |

## 0. 总体目标

在不影响现有功能与发版节奏的前提下，把当前项目从 **"功能持续叠加但护栏不足"** 推进到 **"有静态类型保障、有自动化测试、模块边界清晰、安全姿态明确"** 的工程基线，把 7 项核心技术债按优先级逐步消化。

整体策略：**先止血（P0）→ 再筑墙（P1）→ 再美容（P2/P3）**，每个 phase 都能独立形成可发布产物，任何一项 phase 中止都不应阻断其他 phase 的推进。

## 1. 现状证据

> 摘自 2026-06-02 项目检查；详细数据见本任务对应会话。
> **2026-06-02 修订**：原计划记录 "11 处 TS 错误" 实为 `tail -25` 截断后的局部数据。
> 实际 `tsc --noEmit` 报告 **132** 处错误，覆盖 25+ 个文件。本计划已补全。

### 1.1 代码体量
- TS + CSS 共 **65,409 行**（src/）
- `src/main.ts` **11,456 行**单文件
- `src/style.css` 9,224 行单文件
- `src/extensions/webdavSync.ts` 3,438 行 / `pluginHost.ts` 2,661 行

### 1.2 类型与构建
- `vite build` ✅ 通过（每次 ~30s，无运行时回归）
- `tsc --noEmit` ❌ 132 处错误，覆盖 25+ 文件
  - **核心子系统（直接关联编辑器核心）**：12 处
    - `src/wysiwyg/v2/index.ts` 7 处
    - `src/wysiwyg/v2/plugins/math.ts` 3 处
    - `src/wysiwyg/v2/plugins/mermaid.ts` 1 处
    - `src/wysiwyg/v2/plugins/highlight.ts` 1 处
  - **UI / 扩展面板**：21 处
    - `src/extensions/extensionsPanel.ts` 12 处（多为 `host is possibly null`）
    - `src/ui/linkDialogs.ts` 5 处
    - `src/ui/contextMenus.ts` 2 处
    - `src/ui/aboutOverlay.ts` 2 处
  - **扩展宿主 / 同步 / 录音 / 麦克风**：8 处
    - `src/extensions/pluginHost.ts` 4 处
    - `src/extensions/webdavSync.ts` 2 处
    - `src/extensions/speechTranscribe.ts` 1 处
    - `src/extensions/micManager.ts` 1 处
    - `src/extensions/pluginMenuManager.ts` 1 处
  - **uploader / 图床**：4 处
    - `src/uploader/s3.ts` 2 处
    - `src/uploader/manualImageUpload.ts` 1 处
    - `src/uploader/imgla.ts` 1 处
  - **plugins / markdown-it 适配**：4 处
    - `src/plugins/markdownItKatex.ts` 1 处
    - `src/plugins/markdownItFootnote.ts` 2 处
    - `src/plugins/markdownItCallout.ts` 1 处
  - **导出 / 通用核心**：4 处
    - `src/core/htmlPasteImages.ts` 2 处（`Uint8Array<ArrayBufferLike>`）
    - `src/exporters/pdf.ts` 2 处
  - **主入口 main.ts**：56 处（最大单一文件）
  - **其他零散**：8 处
    - `src/modes/sourceLineNumbers.ts` 1
    - `src/i18n.ts` 1
    - `src/theme.ts` 1
    - `src/main.ts` 见上

### 1.3 测试 / Lint
- 仓库内 **无 `*.test.*` / `*.spec.*`**
- 根目录无 `.eslintrc` / `.prettierrc`，未配置静态检查工具链

### 1.4 安全与依赖
- `src-tauri/tauri.conf.json` 中 `assetProtocol.scope.allow` 含 `"**"` 兜底通配
- `tauri-plugin-http` 启用 `unsafe-headers` feature
- `package.json` 同时依赖 `html-docx-js@0.3.1`、`html-to-docx@1.8.0`、`html2pdf.js@0.10.1` —— docx 生态重复

### 1.5 体积
- 生产构建中 `mermaid` chunk 3.8MB、`vendor` 2.5MB、`docx` ~1MB（已做了 manualChunks 分包与懒加载）

---

## 2. 路线图

```
Phase 1 (P0) — 止血：类型对齐 + 入口拆分
  ├─ Task A: 修复 wysiwyg/v2 11 处 TS 错误
  └─ Task B: 拆分 src/main.ts

Phase 2 (P1) — 筑墙：自动化护栏
  ├─ Task C: 引入 Vitest，覆盖 utils / core 关键纯函数
  └─ Task D: 收紧 Tauri assetProtocol 作用域

Phase 3 (P2) — 美容：体积与样式
  ├─ Task E: style.css 模块化拆分
  └─ Task F: docx 库去重

Phase 4 (P3) — 演进：架构整理
  └─ Task G: 内置扩展统一走插件加载入口
```

每个 Phase 末尾设置 **Gate**：必须 vite build 通过 + tsc 错误数 ≤ 当前 Phase 起始值，否则不准开 Phase N+1。

---

## 3. Task A — 修复 wysiwyg/v2 的 12 处 TS 错误

| 字段 | 内容 |
|------|------|
| 优先级 | **P0** |
| 状态 | ✅ **已完成**（2026-06-02，4 个 commit） |
| 估算 | M（半天～一天） |
| 提交哈希 | `7ebd2fe` / `a0a526b` / `bd20f5c` / `a75ccef` |

### 目标

`tsc --noEmit` 在 `src/wysiwyg/v2/**` 下 **0 错误**，并不引入运行时回归。

### 现状分析

```
src/wysiwyg/v2/index.ts:325  Blob Uint8Array<ArrayBufferLike> 不可分配
src/wysiwyg/v2/index.ts:653  Parameter '_ctx' implicitly has 'any'
src/wysiwyg/v2/index.ts:659  Parameter '_ctx' / 'markdown' implicitly has 'any'
src/wysiwyg/v2/index.ts:831  Property 'node' does not exist on type 'never'
src/wysiwyg/v2/index.ts:837  Property 'from'/'to' does not exist on type 'never'
src/wysiwyg/v2/plugins/highlight.ts:465
  ignoreMutation(MutationRecord) ≠ ignoreMutation(ViewMutationRecord)
src/wysiwyg/v2/plugins/math.ts:39  缺 katex/contrib/mhchem 声明
src/wysiwyg/v2/plugins/math.ts:40  缺 katex/dist/katex.min.css 声明
src/wysiwyg/v2/plugins/math.ts:87  '_mathIO' is possibly 'null'
src/wysiwyg/v2/plugins/mermaid.ts:441
  NodeViewConstructor 返回类型不匹配
```

根因可归为四类：
1. **Milkdown/ProseMirror 7.17 类型升级**：`NodeView.ignoreMutation` 形参从 `MutationRecord` 改为 `ViewMutationRecord`。
2. **listener API 漂移**：原作者误写 `lm.docChanged(...)`，但 `ListenerManager` 中没有 `docChanged`（已有 `updated`），导致回调永远不会被触发（真实 bug）。
3. **TS 5.x 闭包内赋值无法跨回调传播**：`let target` 在 `descendants()` 后的类型会被 TS 漏为 `null` → `never`。
4. **第三方模块缺类型声明**：`katex/contrib/mhchem`、`katex/dist/katex.min.css` 未在 katex 的 `.d.ts` 中导出。

### 子任务（实际完成）

- ✅ A1 — `src/types/shims.d.ts` 中补 `katex/contrib/mhchem`、`katex/dist/katex.min.css`、`html2pdf.js/dist/...`、`*.css` 四条 `declare module`
- ✅ A2 — `wysiwyg/v2/plugins/highlight.ts`：import `ViewMutationRecord`，`ignoreMutation` 改用该类型（顺带修复 mermaid.ts 的 1 处联合返回不匹配）
- ✅ A3 — （被 A2 顺带修复）`mermaid.ts:441` 不再报错
- ✅ A4 — `math.ts:87`：引入局部 `observer` 变量，闭包对外部 `_mathIO` 的引用不再污染窄化
- ✅ A5 — `index.ts`：listener 类型断言、修正 `docChanged → updated`（真实 bug）、Blob Uint8Array 显式断言、`target as ... | null` 重新声明类型

### 验收

- `wysiwyg/v2/**` tsc 错误：**11 → 0**（含 1 处真实 bug 修复）
- 全局 tsc 错误总数：**132 → 116**
- `vite build` ✅ 38.25s（无回归）

### 实际收益（不仅是类型）

- 修复了一处 **真实运行时 bug**：`lm.docChanged(...)` 在所有 milkdown 7.x 中都不会触发，意味着原代码"内容变化时回写 Markdown"的路径从未生效；改为 `updated` 后才真正工作。
- 修复了 KaTeX 公式节点 MutationRecord 漏报导致高亮层闪烁的可能。
- 把 `_mathIO` 窄化丢失的隐患闭环，未来升级 TypeScript / ProseMirror 类型也不会回退。

---

## 3.5. Task A.1 — 修复剩余 116 处 TS 错误（按文件分批）

| 字段 | 内容 |
|------|------|
| 优先级 | **P0** |
| 状态 | ⏳ 待执行（Task A 已完成；本任务为外延） |
| 估算 | **XL**（分 4-5 批，每批 0.5-1 天） |
| 错误总数 | 116（覆盖 25 个文件） |

### 目标

`tsc --noEmit` 全局 **0 错误**。

### 分批计划

按"修复体量由小到大 + 风险由低到高"分批推进，每批独立 commit、独立可回滚。

#### Batch 1 — 小工具与图床（10 处，4 文件，半日）
- `src/core/htmlPasteImages.ts`（2 处）：`Uint8Array<ArrayBufferLike>` 不可分配 BlobPart
- `src/exporters/pdf.ts`（2 处）：`getImageData` on `RenderingContext`、`html2pdf.js/dist/...bundle.min.js` 缺类型
- `src/uploader/s3.ts`（2 处）
- `src/uploader/manualImageUpload.ts`（1 处）
- `src/uploader/imgla.ts`（1 处）
- `src/ui/aboutOverlay.ts`（2 处）
- `src/ui/contextMenus.ts`（2 处）

#### Batch 2 — 链接 / 插件适配 / 主题 / i18n（12 处，5 文件，半日）
- `src/ui/linkDialogs.ts`（5 处）
- `src/plugins/markdownItKatex.ts`（1 处）
- `src/plugins/markdownItFootnote.ts`（2 处）
- `src/plugins/markdownItCallout.ts`（1 处）
- `src/modes/sourceLineNumbers.ts`（1 处）
- `src/theme.ts`（1 处）
- `src/i18n.ts`（1 处）

#### Batch 3 — 扩展子系统（24 处，6 文件，一日）
- `src/extensions/extensionsPanel.ts`（12 处：多为 `host` null 守卫）
- `src/extensions/pluginHost.ts`（4 处）
- `src/extensions/webdavSync.ts`（2 处）
- `src/extensions/speechTranscribe.ts`（1 处）
- `src/extensions/micManager.ts`（1 处）
- `src/extensions/pluginMenuManager.ts`（1 处）

#### Batch 4 — main.ts 入口（56 处，两到三日）
- 11,456 行单文件本身是债务；本批**仅做"加类型守卫、补强 any 标注"**，不拆文件
- 重点关注：Tauri API 包装、事件回调、设置保存等高频路径
- 解决策略：局部细化类型 + 局部非空断言，**不做架构性拆分**（结构性拆分属于 Task B）

#### Batch 5 — 残局（剩余若干处）
- 上述批次后剩余的小文件零散错误
- 总结归档至 `Archive/2026-06/`

### 验收

- 每批结束：对应文件 tsc 0 错误
- 全部结束：全局 tsc 0 错误；`vite build` 仍通过
- 启动行为、人工回归与 Task A 同样要求

---

## 4. Task B — 拆分 src/main.ts

| 字段 | 内容 |
|------|------|
| 优先级 | **P0** |
| 状态 | ⏳ 待执行 |
| 估算 | L（2-3 天） |

### 目标

把 11,456 行的 `src/main.ts` 拆分为多个职责单一的子模块，最终 `main.ts` ≤ 800 行，仅承担"入口编排"。

### 现状分析

`src/main.ts` 是当前唯一启动入口，承担了：DOM 初始化、命令注册、快捷键、菜单组装、模式切换、托盘、Tauri IPC、扩展启动、托管事件、错误兜底等。任何 PR 触动它都会带出巨型 diff，git blame 失效，启动性能调试也难精准定位。

### 拆分草案

```
src/
└─ main.ts                 # ≤ 800 行：只负责按顺序调用 boot 阶段
   ├─ bootstrap/
   │  ├─ initDom.ts        # DOM/视图初始化
   │  ├─ initTauri.ts      # Tauri IPC、单实例、文件托管
   │  ├─ initShortcuts.ts  # 全局快捷键
   │  ├─ initMenus.ts      # 菜单/命令面板组装
   │  ├─ initExtensions.ts # 扩展宿主启动
   │  └─ initLifecycle.ts  # 启动/退出阶段钩子
   └─ commands/            # 按命令族拆分（file/view/edit/window/tools）
```

### 子任务

- ⏳ B1 — 调研：用 Grep 列出 `main.ts` 中所有 `addEventListener` / `register*` / `invoke` 调用点，按职责分类（输出到 `docs/Task/Active/main-ts-inventory.md`）
- ⏳ B2 — 按调用图，先剥离 **无副作用的纯逻辑**（命令处理函数）到 `src/commands/*.ts`
- ⏳ B3 — 然后剥离 **DOM 引导**到 `src/bootstrap/initDom.ts`
- ⏳ B4 — 剥离 **Tauri IPC / 单实例 / 文件托管**到 `src/bootstrap/initTauri.ts`
- ⏳ B5 — 剥离 **快捷键注册**到 `src/bootstrap/initShortcuts.ts`（注意输入法、便签模式、专注模式下的差异）
- ⏳ B6 — 剥离 **扩展宿主启动**到 `src/bootstrap/initExtensions.ts`
- ⏳ B7 — `main.ts` 收敛为顺序调用 + 顶级 try/catch + 启动 telemetry

### 验收标准

- `main.ts` ≤ 800 行
- 每个 `bootstrap/init*.ts` ≤ 400 行
- 启动耗时（`DOM 就绪 / 首次渲染 / 应用就绪`）不劣于拆分前（依据 0.3.1 README 写过的指标）
- 所有快捷键、扩展、托盘行为人工回归通过

### 风险与回滚

- 风险：模块化过程容易破坏闭包内的隐式共享状态；启动顺序敏感
- 缓解：每个 Bx 单独 commit；引入 `src/bootstrap/__golden__/` 文件记录拆分前各模块对外暴露的全局副作用清单作为对照
- 回滚：按 commit 粒度 revert，最坏情况整体退回 Task B 起点

---

## 5. Task C — 引入 Vitest 测试基线

| 字段 | 内容 |
|------|------|
| 优先级 | **P1** |
| 状态 | ⏳ 待执行 |
| 估算 | M（一天） |

### 目标

落地 Vitest 单元测试基础设施，覆盖 `src/utils/**` 与 `src/core/**` 中的纯函数；为后续多标签、撤销栈、WebDAV 同步等高频回归点提供测试位。

### 现状

- 仓库内零测试，已开发的 `package-lock.json` 也无 vitest / jest 痕迹
- `devDependencies` 已经有 `jsdom@27.1.0`（未使用，应是预留）

### 子任务

- ⏳ C1 — 添加依赖：`vitest`、`@vitest/coverage-v8`、`@types/node`（开发依赖）
- ⏳ C2 — 添加 `vitest.config.ts`，环境用 jsdom；root alias 与 vite 对齐
- ⏳ C3 — `package.json` 添加脚本：`test` / `test:watch` / `test:coverage`
- ⏳ C4 — 起步用例集：
  - `src/utils/richClipboard.ts` 富文本 ↔ Markdown 互转
  - `src/core/templateEngine.ts` 模板变量替换
  - `src/core/folderTemplates.ts` `findTemplateForFolder` 路径查找
  - `src/i18n.ts` 取键回退路径
- ⏳ C5 — GitHub Actions 中新增 test step（不阻塞 build job）
- ⏳ C6 — 撰写 `docs/Task/Active/testing-conventions.md`（命名、组织、覆盖率底线）

### 验收标准

- `npm test` 本地通过，单次执行 ≤ 30s
- 覆盖率 ≥ utils 80% / core 60%（仅作为起点）
- CI 上能跑出失败用例并阻断 PR 合入

### 风险与回滚

- 风险：jsdom 与 Tauri 平台 API 之间存在 mock 缺口
- 缓解：测试目标限定为"纯函数 + DOM 操作"，禁止直接触达 `@tauri-apps/*`
- 回滚：单独提交，可整组 revert

---

## 6. Task D — 收紧 Tauri assetProtocol 作用域

| 字段 | 内容 |
|------|------|
| 优先级 | **P1** |
| 状态 | ⏳ 待执行 |
| 估算 | S（半天） |

### 目标

把 `src-tauri/tauri.conf.json` 中 `assetProtocol.scope.allow` 的 `"**"` 移除或显式收敛，使 `asset://` 协议只能加载预期目录。

### 现状

```jsonc
"assetProtocol": {
  "enable": true,
  "scope": {
    "allow": [
      "$APP/**", "$RESOURCE/**", "$DESKTOP/**",
      "$DOCUMENT/**", "$DOWNLOAD/**", "$PICTURE/**",
      "$HOME/**", "**"          // ← 兜底通配
    ]
  }
}
```

`"**"` 在生产 build 中允许 webview 通过 `asset://` 读取任意路径，对本地优先 + 用户文件信任度高的本应用是一个被低估的攻击面（恶意扩展、剪贴板钓鱼场景）。

### 子任务

- ⏳ D1 — 审计使用 `convertFileSrc` / `asset://` 的所有调用点，列出实际访问的根目录集合
- ⏳ D2 — 把 `"**"` 替换为审计得到的最小集合（必要时新增 `$APPCONFIG/**`、`$APPDATA/**`、用户文档库根目录）
- ⏳ D3 — 在 `src-tauri/tauri.linux.conf.json` / `tauri.macos.conf.json` 中同步调整
- ⏳ D4 — 写说明文档 `docs/Architecture/Tauri-Security.md`（含设计意图、未来新增路径时的审计 checklist）

### 验收标准

- `tauri.conf.json` 中不再出现 `"**"`
- 实际运行下：图片预览 / PDF 查看 / 扩展资源加载 / 用户文档库内文件访问全部正常
- 在文档库**外**的随机路径（如 `/etc/hostname`）通过 `convertFileSrc` 拼接后访问被 Tauri 拒绝

### 风险与回滚

- 风险：用户自定义文档库或便签数据目录位于不常规位置时可能失效
- 缓解：在 Rust 侧基于运行时配置动态注册作用域（如果 Tauri 2 提供 capability 接口），或在用户首次添加自定义库时提示
- 回滚：恢复 `"**"`（应作为最后手段，伴随 issue 跟踪）

---

## 7. Task E — style.css 模块化拆分

| 字段 | 内容 |
|------|------|
| 优先级 | **P2** |
| 状态 | ⏳ 待执行 |
| 估算 | M（1-2 天） |

### 目标

把 9,224 行的 `src/style.css` 按职责拆分为多个 CSS 文件并通过 `@import` 组合，配合 `cssCodeSplit: true` 实现按需加载。

### 拆分草案

```
src/styles/
├── base.css              # 变量、复位、字体
├── theme-light.css       # 亮色主题变量
├── theme-dark.css        # 暗色主题变量
├── typography.css        # 正文/标题/代码字体
├── library.css           # 库侧栏 / 文件树
├── tabs.css              # 标签栏
├── editor.css            # 源码模式
├── preview.css           # 阅读模式
├── wysiwyg.css           # 所见模式
├── dialog.css            # 弹窗 / 命令面板 / 设置
├── ai-panel.css          # AI 助手停靠面板
├── sticky-note.css       # 便签模式
├── focus-mode.css        # 专注模式
├── mobile.css            # 移动端（保留独立）
└── index.css             # 仅做 @import 编排
```

### 子任务

- ⏳ E1 — 用样式语义边界（`/* === 库侧栏 === */` 之类的注释段）扫描 `style.css`，给出迁移分组草案
- ⏳ E2 — 逐组迁移并删除原段（每组单 commit；保留 `style.css` 仅作为 `@import 'styles/index.css'`）
- ⏳ E3 — 在 `main.ts` / Bootstrap 处确认 CSS 入口仍指向单一组合文件
- ⏳ E4 — 验证：所有主题切换 / 模式切换 / 便签 / 专注 / 移动端样式无视觉回归

### 验收标准

- 单文件 `style.css` ≤ 200 行（仅做编排）
- `vite build` 产出的 CSS bundle 数量增加，但**主入口 CSS** 不大于现有大小（允许更小，因更多按需加载）
- 视觉回归：5 个主题 × 3 个模式 × 2 个 OS 截图对比

### 风险与回滚

- 风险：CSS 顺序依赖隐含覆盖关系，迁移过程中可能错位
- 缓解：每组迁移前后用浏览器 DevTools "已计算样式" 对照
- 回滚：每组单 commit，问题组可独立 revert

---

## 8. Task F — docx 库去重

| 字段 | 内容 |
|------|------|
| 优先级 | **P2** |
| 状态 | ⏳ 待执行 |
| 估算 | S（半天） |

### 目标

从 `html-docx-js@0.3.1`、`html-to-docx@1.8.0` 二选一，移除另一方。

### 现状

| 库 | 维护 | 体积 | 当前调用点 |
|----|------|------|-----------|
| `html-docx-js` | 不活跃（最后发布 2019） | 小 | 需 Grep |
| `html-to-docx` | 活跃 | 中（500KB+） | 需 Grep |

### 子任务

- ⏳ F1 — Grep 两库的实际导入位置（`grep -rn "from 'html-docx-js'" src/` / `from 'html-to-docx'`）
- ⏳ F2 — 比较两者在当前文档导出场景下的产物质量（含图片、表格、代码块）
- ⏳ F3 — 选定一方，重写另一方的调用为统一接口
- ⏳ F4 — 删除依赖，重跑 `npm i` 与 `npm run build`，对比 bundle 体积

### 验收标准

- `package.json` 中 docx 相关库仅剩一方
- 一份包含图片 + 表格 + 代码块 + KaTeX 公式的文档导出 DOCX 用 LibreOffice / Word 可正常打开
- `dist/assets/docx-*.js` 体积下降 ≥ 30%

### 风险与回滚

- 风险：被替换的库在边缘场景（嵌套表格、复杂排版）下产物质量不同
- 回滚：保留 commit 历史，必要时恢复两库共存并加上特性开关

---

## 9. Task G — 内置扩展统一走插件加载入口

| 字段 | 内容 |
|------|------|
| 优先级 | **P3** |
| 状态 | ⏳ 待执行 |
| 估算 | XL（≥ 1 周） |

### 目标

把 `src/extensions/**` 下当前**编译期**集成的扩展（如 webdavSync、speechTranscribe、asrNote 等）改造为**运行时由 pluginHost 加载**的模块，与第三方扩展走完全一致的入口。

### 收益

- 主 bundle 显著瘦身（当前 `extensions` chunk 260KB）
- 启动路径上不再被未启用的扩展拖累
- 扩展开发文档可与现实 100% 对齐（目前内置扩展有"特权 API"差异）

### 子任务

- ⏳ G1 — 调研：列出当前 15 个内置扩展的"特权 API"使用清单
- ⏳ G2 — 将这些特权 API 标准化为 pluginHost 公开能力（必要时引入命名空间 + 权限声明）
- ⏳ G3 — 把内置扩展按"无特权依赖 / 有特权依赖"两批切换，第一批做 PoC
- ⏳ G4 — 第一批稳定后切第二批；同步更新 `plugin.md` / `plugin.en.md`
- ⏳ G5 — 增加首次启动时的扩展批量预安装机制（保持开箱即用体验）

### 验收标准

- 主 bundle 中 `extensions` chunk 体积下降 ≥ 50%
- 全部"内置扩展"通过普通扩展加载流程激活，且功能等价
- 旧用户升级后扩展启用状态自动迁移

### 风险与回滚

- 风险：扩展私有 API → 公共 API 的暴露会引入兼容矩阵
- 缓解：分两批切换；每批用一个完整发布周期跑稳定
- 回滚：保留旧编译路径作为 fallback，至少跨一个大版本

---

## 10. 里程碑与 Gate

| Phase | 目标日期 | Gate 检查 |
|-------|---------|-----------|
| Phase 1 (A+B) | 2026-06-09 | `tsc` 0 错误；`main.ts` ≤ 800 行；启动指标不退化 |
| Phase 2 (C+D) | 2026-06-16 | `npm test` 在 CI 上跑通；`tauri.conf.json` 不含 `"**"` |
| Phase 3 (E+F) | 2026-06-30 | `style.css` ≤ 200 行；docx chunk -30% |
| Phase 4 (G)   | 2026-07-31 | extensions chunk -50%；扩展开发文档对齐 |

> 每个 Gate 之前禁止启动下一 Phase。Gate 失败则在本 Phase 内继续修复。

## 11. 协作与提交规范

- 每个 Task 独立分支 `feat/quality-{a|b|c|d|e|f|g}-<slug>`，并尽量保持 PR 体积 ≤ 500 行
- 提交信息沿用项目已有风格：中文标题 + bullet body + `Co-Authored-By:` trailer
- 涉及破坏性改动需在 `ROADMAP.md` 同步发版说明

## 12. 进度看板（动态更新）

| Task | 状态 | 开始 | 完成 | 备注 |
|------|------|------|------|------|
| A — wysiwyg/v2 TS 修复（11 → 0） | ✅ | 2026-06-02 | 2026-06-02 | `7ebd2fe` / `a0a526b` / `bd20f5c` / `a75ccef` |
| A.1 — 剩余 116 处 TS 错误 | ⏳ | — | — | 5 个 Batch，由小到大 |
| B — main.ts 拆分 | ⏳ | — | — | — |
| C — Vitest 基线 | ⏳ | — | — | — |
| D — Tauri 安全收紧 | ⏳ | — | — | — |
| E — CSS 模块化 | ⏳ | — | — | — |
| F — docx 去重 | ⏳ | — | — | — |
| G — 扩展架构演进 | ⏳ | — | — | — |

---

## 附录 A：本计划制定时已完成的改动

- `008ce14` 库结构树展开态文件夹图标改用 Lucide folder-open + 强调色（dev 已合）

## 附录 B：关键文件指针

- 入口：`src/main.ts:1`
- 文件树：`src/fileTree.ts:1`
- 所见模式：`src/wysiwyg/v2/index.ts:1`
- 扩展宿主：`src/extensions/pluginHost.ts:1`
- 主题：`src/theme.ts:1`
- Tauri 主配：`src-tauri/tauri.conf.json:1`
- Vite 构建：`vite.config.ts:1`
- Roadmap：`ROADMAP.md:1`
