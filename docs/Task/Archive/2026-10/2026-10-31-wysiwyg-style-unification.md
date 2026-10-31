# 所见模式与阅读模式样式统一（md-content 共享排版层）

**创建日期**: 2026-10-31
**创建者**: Mavis（minimax Code）
**状态**: ✅ Completed（完成时间: 2026-10-31）
**范围**: 前端样式层 + 两处内容根节点挂载 + 防漂移测试 + 浏览器级校验页
**基线提交**: `3eb6b34`（perf: 大文件视口渲染与 CM6 流畅编辑）

---

## 1. 目标（Goals）

1. **所见模式（WYSIWYG V2）的正文排版与阅读模式一致**——标题字号/间距、段落、列表、链接、图片、分割线、引用、表格、行内代码，以及全部 Markdown 主题（GitHub / Notion / Docs / 出版风 / 卡片风 / Typora / Obsidian / Bear / 极简风）。
2. **建立单一事实源**：排版规则只写一份，两种模式共用；后续新增/调整排版只改一处，不可能再漂移。
3. **把「不再漂移」从口号变成约束**：新增自动化测试，禁止在 `.preview` / `.ProseMirror` 作用域外声明排版属性（白名单外即失败）。
4. **所见模式采用阅读模式的两端对齐**（`text-align: justify`）——用户已确认接受打字时整行重排的效果。

**非目标（明确排除）**

- 代码块**内部结构**不统一（所见模式保持可编辑双层 + 语言选择器 + 复制/缩放按钮）；只统一代码块**外壳**的颜色/边框/圆角/内距。
- 不改 DOM 结构（只增加一个 class），不引入新的运行时依赖。
- 不动虚拟化阅读模式的分块渲染策略。

---

## 2. 现状分析（Context）

### 2.1 两套渲染器、两条互不相干的 CSS 树

| | 阅读模式 | 所见模式 V2 |
|---|---|---|
| DOM | `#preview > .preview-body` | `#md-wysiwyg-root > .milkdown > .ProseMirror` |
| 生成 | markdown-it → HTML 字符串 | Milkdown / ProseMirror 结构化文档 |
| 排版 CSS | `src/styles/preview.css`（`.preview h1`…） | `src/styles/editor.css`（`.container.wysiwyg-v2 .ProseMirror h1`…） |
| 主题 CSS | `theme-panel.css`（`.container.md-X .preview …`） | `theme-panel.css`（`.container.md-X.wysiwyg-v2 .ProseMirror …`） |

两套规则**互斥作用域**，因此每个 Markdown 元素（标题、段落、列表、表格…）的样式都被手写了两遍，并已实际漂移。

### 2.2 实测漂移清单（阅读 → 所见）

| 元素 | 阅读模式 | 所见模式 | 后果 |
|---|---|---|---|
| `h1`/`h2` | `letter-spacing: -0.02em` / `-0.01em` | **缺失** | 标题字距略宽 |
| `h4`/`h5`/`h6` | `font-size: 1.2em`/`1.05em`/`1em` + `line-height` | **两者均缺失** | **所见模式 h4–h6 与正文同号**，层级消失 |
| `h6` | `color: var(--muted)` | 缺失 | 颜色不一致 |
| `p` | `text-align: justify; text-justify: inter-character` | **缺失** | 段落不对齐 |
| `ul`/`ol` | `margin: 1em 0; padding-left: 2em; line-height: 1.8` | **完全缺失** | **所见模式列表无缩进、无行距** |
| `li` | `margin: .4em 0`、嵌套 `.3em` | **缺失** | 列表项粘连 |
| `a` | accent 色 + hover 下划线 + `font-weight: 500` | **基础层缺失**（仅个别主题覆盖） | 链接样式不可控 |
| `hr` | 渐变分割线 | **缺失** | 所见模式 hr 无样式 |
| `blockquote` | `padding: .8em 1.2em` + `box-shadow` + 内嵌 `p` margin | `padding-left: 1.2em`、无右内边距、无阴影、无内嵌规则 | 引用块形态不同 |
| `table` | JS 注入 `.table-wrapper`（边框/圆角/阴影/横向滚动），`th` padding `12px 16px`、`border-bottom: 2px` | 无 wrapper，表直接描边，`th/td` padding `10px 14px`、`border-bottom: 1px`、偶数行底色 `.5` vs `.02` | 表格形态明显不同 |
| 主题 | `theme-panel.css` **190** 条 `.preview` 规则 | **117** 条 `.ProseMirror` 规则，多为值不同的手写配对 | 换主题后两模式观感分叉 |
| 代码块 | `code-rendering.css` **70** 条 `.preview` 规则 | **110** 条 `.ProseMirror` 规则，padding/结构均不同 | 代码块外观不同（本次只统一外壳） |

### 2.3 外部审查结论（coding-bridge，session `243cf4a9-ace1-41da-81dd-649d1d18f043`）

判定「方向正确、机制可行，建议有条件通过」，要求补齐五项，已全部纳入本计划：

1. 明确 theme/code 层的裁决规则 → 用户已定：基础排版 + 主题风格全量统一，代码块只统一外壳。
2. 级联显式化，消除特异性平局 → 见 §3.2 分层设计。
3. 防漂移强制机制 → §4 子任务 T5（CSS 作用域审计测试）。
4. 浏览器级视觉验证 → §4 子任务 T6（校验页 + 计算样式逐项比对）。
5. 结构差异归一化 → §4 子任务 T3（`li > p`、`td/th > p` 归零 margin）。

审查另指出三处结构性差异与两条风险，已纳入：markdown-it 紧凑列表无 `<p>` 而 ProseMirror 恒有；表格 `table-layout` 差异；导出/打印链路复用 `.preview` 作用域（`src/exporters/pdf.ts:575` 注释明示）→ §4 子任务 T7 导出链路审计。

---

## 3. 设计

### 3.1 共享内容根类 `md-content`

在两个内容根上挂同一个中性语义类，作为「排版作用域锚点」：

- 阅读模式：`src/main.ts:3192` `buf.className = 'preview-body'` → `'preview-body md-content'`
- 虚拟化阅读模式：`src/core/virtualPreview.ts:113` `root.className = 'preview-body virtual-preview-body'` → 追加 `md-content`
- PDF 上下文导出：`src/exporters/pdfContextExport.ts:54` `previewBody.className = 'preview-body'` → 追加 `md-content`
- 所见模式：ProseMirror 插件 `src/wysiwyg/v2/plugins/contentRootClass.ts` 注入 `attributes: { class: 'md-content' }`，
  在 `src/wysiwyg/v2/index.ts:561` 通过 `ctx.update(prosePluginsCtx, ...)` 注册。

> **实现修正（与初稿不同）**：初稿打算用 Milkdown `editorViewOptionsCtx` 传 `attributes`，实测**不可行**——
> `src/wysiwyg/v2/editLock.ts:43` 的加解锁走 `ctx.set(editorViewOptionsCtx, { editable })`，会**整体替换**
> 该 ctx 的对象，把放在其中的 `attributes` 一并抹掉。改为走 `prosePluginsCtx` 的插件 `props.attributes`：
> ProseMirror 的 `attributes` prop 是**追加**语义（`computeDocDeco` 先置 `attrs.class = "ProseMirror"`，
> 再 `attrs.class += " " + value[attr]`），最终为 `class="ProseMirror md-content"`；且该值在每次 state 更新时
> 由 `computeDocDeco` 重算，编辑器重建/加解锁都不丢类。**不用** mount 后补 class 的写法。

不复用 `.preview` 类：它已承载结构语义并被 JS/导出链路大量查询（`querySelector('.preview-body')`），复用一个新中性类才是正确边界。

### 3.2 级联分层（消除特异性平局）

**最终采用「普通类 + 钉死 import 顺序」，不用 `:where()`**：

| 层 | 选择器形态 | 特异性 | 位置 |
|---|---|---|---|
| L0 共享基础排版 | `.md-content h1` | (0,1,1) | 新文件 `styles/markdown-content.css` |
| L1 主题覆盖 | `.container.md-github .md-content h1` | (0,3,1) | `styles/theme-panel.css` |
| L2 模式专属 | `.container.wysiwyg-v2 .ProseMirror h1` | (0,3,1) | `styles/editor.css` |

取舍理由（与初稿不同）：

1. **不用 `:where()`**：`:where(.md-content)` 把共享层特异性归零后，阅读模式里「主题层 (0,3,X) > 共享层 (0,0,X)」
   没问题，但会让共享层输给任何裸元素级规则；更关键的是 **Safari 13/14 不支持 `:where()`**，而本项目跑在
   Tauri WebView 上，老系统 WebView 会整条规则失效 → 静默回退浏览器默认样式。改用普通 `.md-content`（0,1,X）。
2. **阅读模式级联胜负不变**：改造前共享排版就在 `.preview`（0,1,X）上，改造后搬到 `.md-content`（0,1,X），
   同级同权重；主题层仍是 `.container.md-X .md-content`（0,3,X，与改造前 `.container.md-X .preview` 同级），
   暗色层仍是 `body.dark-mode .md-content`（0,2,X，与改造前同级）→ 阅读模式最终计算样式**逐项不变**（已用
   浏览器 `getComputedStyle` 逐元素指纹基线验证）。
3. **所见模式特异性下降需要钉顺序**：主题层合并后，所见模式命中的规则从 (0,4,X) 降为 (0,3,X)，与模式专属层
   (0,3,X) **平级** → 胜负由 `index.css` 的 `@import` 顺序决定。因此顺序被审计测试硬钉死：
   共享层 → 基础层 → 模式层（editor/preview/code-rendering）→ 主题层 → 暗色层；校验页的 CSS 拼接顺序
   也必须与 `index.css` 完全一致（否则校验页算出的样式不代表真实应用）。

### 3.3 共享层内容（阅读模式取值为准）

新建 `src/styles/markdown-content.css`，承接：

- 根盒：`max-width` / `margin: auto` / `font-family` / `font-size` / `line-height` / `letter-spacing` / `color`
- `h1`–`h6`：字号、字重、行高、margin、字距、border-bottom、padding-bottom、h6 颜色
- `p`：margin、`text-align: justify`、`text-justify: inter-character`
- 首行缩进：`.md-content > p { text-indent: var(--layout-text-indent, 0) }`
- 列表：`ul`/`ol` margin + `padding-left: 2em` + `line-height: 1.8`；`li` margin；嵌套列表 margin
- 链接 `a`（含 hover）、图片 `img`、`hr`、`blockquote`（含内嵌 `p` 规则）
- 表格：单元格边框/padding/底色（`.table-wrapper` 属阅读模式专属，留在 `preview.css`）
- 行内代码：`.md-content :not(pre) > code`

**不进入共享层的部分（各归其位）**：

- 代码块外壳（`pre` / `pre code` / hljs token）→ `styles/code-rendering.css` 的 `.md-content` 作用域，
  保持「代码渲染层」职责边界；共享层不碰代码块。
- `li > p` / `td > p` / `th > p` 归零 → **只放在所见模式专属层**（`editor.css` 的
  `.container.wysiwyg-v2 .ProseMirror …`）：阅读模式的宽松列表节奏靠 `p` 的 margin 与
  `blockquote p` 等规则共同形成，贸然归零会改变阅读模式观感（初稿把归一化放进共享层，实现阶段修正）。
- 行内代码在所见模式的复位（所见模式 `code` 的父节点是 `.code-layers` 而非 `pre`，会被行内代码规则命中）
  → 由 `code-rendering.css` 的 `!important` 复位 + 新变量 `--code-text` 把两端锁死。
  **不用** `code:not(pre code)` 这类复杂 `:not()`（Safari 兼容风险）。

### 3.4 保留的所见模式专属差异（白名单）

| 项 | 原因 |
|---|---|
| `white-space: pre-line`（`p`/`li`） | 单换行渲染成换行，不改 Markdown 语义 |
| 表格无 `.table-wrapper` | ProseMirror 表格由 NodeView 管理，无法注入横向滚动容器；外壳样式已统一 |
| 任务列表 `li[data-item-type=task]` 伪元素勾选框 | Milkdown 不输出 `<input>`；与阅读模式 `.task-list-item-checkbox` 结构不同 |
| 代码块双层可编辑结构 | 见 §1 非目标 |
| 数学 / Mermaid 节点编辑按钮、浮层 | 所见模式专属交互 |
| 光标、行高亮、边界逃逸 | 所见模式专属交互 |

### 3.5 顺带修复：暗色主题表格边框不可见（用户中途反馈）

**现象**：暗色主题下表格边框线几乎看不见。

**根因**（用改造前的基线提交 `3eb6b34` 复现，确认**非本次重构引入**）：

1. 暗色 `--table-border: #4b5563`（slate-600）在应用背景 `#12100d` 上的对比度只有 **2.4:1**，低于 WCAG AA 对
   图形元素的 3:1 门槛；md-docs（`#202733`）、md-typora（`#2d333b`）、md-bear（`#262a33`）背景更暗，更难辨认。
2. `body.dark-mode .md-content table th, td { border-color: var(--table-border) !important }` 用 `!important`
   盖掉了各主题暗色下的表格边框色，主题之间的边框差异也被抹平。

**修复**：把暗色 `--table-border` 提到 `#64748b`（slate-500，对比度 **4.2:1 / 4.6:1**，满足 AA），
两处定义（`base.css` 暗色块与 `dark-mode.css`）同步；删除 md-docs 暗色表格边框覆盖；md-docs 暗色代码块边框
`#202733` → `#30363d`。实测两模式计算样式均为 `rgb(100, 116, 139)`。

### 3.6 顺带修复：暗色模式代码块背景与内容区背景「同色」（用户第二次反馈）

**现象**：暗色模式下代码块的整体背景色与内容区背景色看起来是同一个颜色，代码块「陷进」页面底色里。

**根因**（用基线提交 `3eb6b34` 的源码核对，确认**非本次重构引入**）：

1. 暗色下代码块外壳背景被一条硬编码规则压平：
   `body.dark-mode .preview pre { background: #0f1114 !important }`（阅读）与
   `body.dark-mode .ProseMirror pre { background: #0f1114 !important }`（所见）。
2. 内容区背景是 `--preview-bg: #12100d`（阅读）与 `--wysiwyg-bg: #0b1016`（所见）。
   `#0f1114` 与 `#12100d` 只差 3 / 1 / 9 个色阶 → 肉眼无法分辨。
3. 连带效应：各主题自己声明的暗色代码块背景（md-github `#0d1117`、md-docs `#0f1217`、
   md-typora `#161b22`、md-bear `#16181d`、md-notion `#1c1c1a`…）全部被这条 `!important` 压死，
   在暗色下从未生效（既有缺陷，本次未扩大范围处理）。

**修复**：暗色 `--code-bg` 从 `#0f1114` / `#111827` 统一提到 **`#1a1f27`**（明显亮于 `#12100d` / `#0b1016`），
三处变量定义同步（`base.css` 系统暗色块、`code-rendering.css` 系统暗色块、`dark-mode.css` 强制暗色块），
并把 `body.dark-mode .md-content pre` 的硬编码 `#0f1114` 改为 `background: var(--code-bg) !important`。
实测两模式暗色代码块背景均为 `rgb(26, 31, 39)`，与内容区背景明确区分；parity 仍为未知差异 0。

---

## 4. 子任务清单

| # | 子任务 | 状态 |
|---|---|---|
| T1 | 挂载 `md-content`：阅读模式 / 虚拟化预览 / PDF 上下文导出 / 所见模式（ProseMirror 插件） | ✅ 完成 |
| T2 | 新建 `src/styles/markdown-content.css` 共享排版层，纳入 `styles/index.css` | ✅ 完成 |
| T3 | `preview.css` 移除已上移的排版规则；`editor.css` 移除 ProseMirror 重复排版规则，保留专属差异 | ✅ 完成 |
| T4 | `theme-panel.css` 合并 `.preview` / `.ProseMirror` 成对规则（阅读取值为准，WYSIWYG 独有声明并入）；`code-rendering.css`、`dark-mode.css` 同步合并 | ✅ 完成 |
| T5 | 新增 CSS 作用域审计测试（vitest）：排版属性只允许出现在 `.md-content` 作用域或白名单内 | ✅ 完成 |
| T6 | 新增浏览器级校验页 `scripts/style-parity/`：同 fixture 双模式渲染，逐元素 `getComputedStyle` 比对，输出差异报告 | ✅ 完成 |
| T7 | 导出/打印链路审计：`print.css`、`core/print.ts`、`exporters/pdf.ts`、`exporters/docx.ts` 的选择器依赖 | ✅ 完成 |
| T8 | 五门禁验证 + 校验页实测 + 外审 | ✅ 完成（代码轮 `VERDICT: APPROVED`，session `38a8d692-c535-4719-8214-fadae6816ddf`） |
| T9 | 追加：DOM 侧挂载不变量测试（`src/styles/markdownContentMount.test.ts`） | ✅ 完成 |

**依赖关系**：T1 → T2 → T3 → T4；T5 依赖 T3/T4 完成；T6 依赖 T1–T4 完成；T7 与 T4 交叉进行；T8 最后。

---

## 5. 验收标准与实测结果（Acceptance）

| # | 标准 | 实测结果 |
|---|---|---|
| 1 | `pnpm typecheck` 0 错误；`pnpm test` 全绿；`pnpm build` + 入口闭包校验通过 | ✅ typecheck 通过；vitest **76 文件 / 929 用例全绿**（含新增 10 条不变量用例）；build 通过，`[check-entry-closure] OK: 入口静态闭包 8 个文件` |
| 2 | 校验页逐元素计算样式比对：**除白名单外零差异** | ✅ **未知差异 = 0**（10 主题 × 明暗 = 20 组）；白名单内已知结构性差异 646 项 |
| 3 | 所见模式 `h4`/`h5`/`h6` 呈现 `1.2em`/`1.05em`/`1em`；列表 `padding-left: 2em` + `line-height: 1.8`；链接 accent 色；`hr` 渐变；表格单元格 padding 与阅读一致 | ✅ 全部命中（由共享层单点提供，两模式计算样式一致） |
| 4 | 全部 Markdown 主题下两模式观感一致 | ✅ 10 主题 × 明暗全部 parity PASS |
| 5 | 审计测试能拦住「在 `.preview`/`.ProseMirror` 作用域新增排版属性」 | ✅ `styleScopeAudit.test.ts` 4 项 + `markdownContentMount.test.ts` 6 项，共 10 项全绿 |
| 6 | PDF / DOCX / 打印导出样式与改造前一致 | ✅ 三条链路均复用阅读模式正文根（携带 `md-content`）；打印 iframe 复制应用样式表、PDF 导出挂载在应用 DOM 内，共享层规则照常命中；主题规则因缺 `.container` 祖先而**改造前后同样不命中**（行为未变） |
| 7 | 阅读模式观感不变（回归红线） | ✅ 对照改造前原始基线：正文排版（h1–h6 / p / ul / ol / li / a / strong / em / blockquote / hr / img）**零变更**；仅 `code` / `pre` / 暗色 `table`/`th`/`td` 变化，且全部是刻意修复（主题代码配色在阅读模式终于生效、暗色表格边框提亮、暗色代码块背景与内容区区分） |
| 8 | 暗色下代码块与表格必须可见 | ✅ 表格边框 `rgb(100,116,139)`（对比度 4.2:1）；代码块背景 `rgb(26,31,39)` 与内容区 `rgb(18,16,13)` 明确区分 |

---

## 6. 风险与回滚（Risks & Rollback）

| 风险 | 缓解 |
|---|---|
| 特异性平局 / import 顺序翻转现有行为 | §3.2 显式分层；阅读模式各层特异性保持现状值，级联胜负不变 |
| 导出链路静默失效（选择器改名） | T7 专项审计；导出克隆体携带 `md-content`，`.preview` 作用域保留 |
| `li > p` / `td > p` 归一化改变阅读模式紧凑列表观感 | 归一化只作用于 `> p`（ProseMirror 块级化产物）；markdown-it 紧凑列表无 `<p>`，不受影响；宽松列表有 `<p>`，但其 margin 本就被 `blockquote p` 等规则覆盖，视觉差异纳入校验页比对 |
| 两端对齐导致所见模式打字抖动 | 用户已确认接受；如后续反馈不佳，只需在 `markdown-content.css` 内对所见模式单点豁免，不影响其他同步项 |
| 大文档样式重算性能回退 | 新增层为纯选择器匹配，未引入 `*` 或宽泛属性选择器；校验页附带样式重算耗时对照 |
| 所见模式回归（编辑行为） | 专属差异全部列入白名单并由校验页锁定；代码块/任务列表/数学/Mermaid 交互不动 |

**回滚**：DOM 只增加 class、无结构改动，`git revert` 即可完整回退。按元素组分小批提交（标题 → 段落/链接 → 列表 → 引用/hr → 表格 → 主题），每批独立可 revert、可 bisect。

---

## 7. 工时估算（Estimate）

**M**（1.5–2 人日）。机械合并部分占多数；长杆是主题层逐对裁决与校验页 fixture 构造。代码块内部结构统一列为二期，不在本任务内。

---

## 8. 备注（Remarks）

- **外部审查记录**：需求轮 session `243cf4a9-ace1-41da-81dd-649d1d18f043`（通过）；计划轮 session
  `61774985-e45d-4e8f-bad0-e1d77a52162c`（通过，提出 2 个 P0：① 防漂移机制必须可自动校验；② 结构差异需归一化，
  均已落实为 T5 审计测试与 `li > p`/`td > p` 归零）；**代码轮 session `38a8d692-c535-4719-8214-fadae6816ddf`
  → `VERDICT: APPROVED`**（另有一次同主题的实质审查 session `9178552f-865f-458f-b02c-9e909d65191b`，
  提出 P1「共享层 CSS 串扰到可编辑 DOM」/ P2「根 class 由 PM 独占管理」/ P3「类名字符串漂移」三条风险）。
- **对代码轮风险的处置**：P1 已用代码与实测逐条核销——共享层 `markdown-content.css` 不含
  `user-select` / `pointer-events` / `cursor` / `outline` / `overflow` / `contain` / `white-space`
  （唯一的 `white-space` 声明是 `.md-content table td code { white-space: pre-wrap }`），
  结构伪类仅 `blockquote p:first-child/:last-child` 与表格 `:last-child`，在 ProseMirror 中结构一致；
  所见模式的 `pre-line` / `pre-wrap` 由 `editor.css` 模式专属作用域提供，未进共享层。
  P2 已核销——`rg` 全仓无任何代码对 `view.dom`（编辑器根）调 `classList.add/remove`，
  命中的 `classList` 操作全在 callout / mermaid / math / highlight 的 NodeView 子 DOM 上；
  主题类挂 `.container`、暗色类挂 `body`，均不在编辑器根上。
  P3「类名硬编码」**有意不采纳**：改为由 `markdownContentMount.test.ts` 断言四处挂载点，
  用测试锁漂移而不是引入跨模块常量（避免为一个字符串改动 4 个模块的导入链）。
  P2 的「class 合并顺序」提示已补进插件注释。
- **上游 MCP 稳定性备注**：本次代码轮前连续 5 次 `review_code` 超时（上游 Qianfan Token Plan
  对 `max_tokens=65536` + 长中文审查提示的请求会 500 或只回 `reasoning_content` 而正文为空，
  MCP 判为可重试 → 无限重试至 600s 超时）。实测规律：`max_tokens=8192`→86s、
  `16384`→166s、`65536`→186s 后 500；**载荷越大越慢，压缩提示词后一次成功**。
  后续复审请沿用「精简载荷 + 串行」策略（与 `docs/Task/README.md` 中 2026-10-17 的经验一致）。
- 「无新依赖」按审查意见修正为「无新增**运行时**依赖」：校验页与审计测试只用浏览器原生 API 与 vitest，
  不引入 Playwright/stylelint。
- 虚拟化阅读模式下 `.md-content > p` 首行缩进不生效（分块 DOM 更深），这是**改造前既有**的阅读模式内部
  不一致，本次不扩大范围处理，记录备查。
- 主题的代码块配色「在阅读模式不生效」判定为**既有 bug**（`editor.css` 的 (0,4,2) 覆盖盖掉主题层），
  按「阅读模式为准 + 修 bug」处理：删除覆盖，让主题规则在两模式同时生效。
- 代码正文行高以阅读模式实际值 **1.8** 为准（原 `.preview pre code { line-height: 1.8 !important }`），
  共享层写 1.8，删除该 `!important` 规则。
- 代码块块内文字色统一走新变量 `--code-text`（缺省 `var(--code-fg)`），把两端锁死；md-obsidian 设
  `--code-text: #cdd6f4`。
- 所见模式代码块 `pre` 顶部保留 `padding-top: 32px`（语言选择器占位）→ 进 parity 白名单，注明是结构差异。
- 校验页 CSS 用 `?raw` 手工拼接（顺序与 `index.css` 一致），暗色通过把 `@media (prefers-color-scheme: dark)`
  改写为 `@media all` 模拟；harness 容器挂在 `body`（非 `#stage`），可视化覆盖选择器不得带 `#stage`。
- 基线文件存逐元素指纹（v2），整页哈希改为「元素级」以定位变更；`baseline-original.json` 保留改造前基线，
  用于验证阅读模式回归。
