# 所见模式 HTML 直接编辑功能加固与治理方案

## 元数据

- 创建日期：2026-09-24
- 责任人：果农 / Kimi Code
- 状态：✅ 已完成（2026-09-24 全部子任务交付，CSP 按决策独立立项）
- 范围：所见模式（Milkdown/ProseMirror）HTML 块源码编辑功能及其依赖的 HTML 渲染链路

## 目标（Goals）

1. HTML 源码编辑入口可通过设置开关启停，默认开启、即时生效。✅
2. 消除失焦误保存：浮层仅在内容实际变更时写回文档。✅
3. 消除重构遗留的文案/注释失真，使代码描述与实现一致。✅
4. 消除 editLock 加锁竞态与兜底序列化路径的静默数据损失。✅
5. 明确预览链路 HTML 消毒与 CSP 的处置结论。✅（消毒已接线；CSP 独立立项）

## 现状分析（Context）

功能实体：所见模式下 HTML 块（`span[data-type="html"]`，由 `htmlMediaPlugin` 渲染）的源码直接编辑。表格块 hover 铅笔按钮或双击、其它 HTML 块双击，打开浮层 textarea 编辑原始 HTML，`updateHtmlBlockNode` 直接替换 ProseMirror `html` 节点的 `value` 属性（`src/wysiwyg/v2/index.ts`）。

关键提交：

- `4921e4a` feat(wysiwyg)：任务列表复选框渲染与点击写回
- `8827720` fix(wysiwyg)：源码取值从 DOM 序列化改为节点 `attrs.value`（保真）；GFM 表格不再误触发
- `923e206` fix(wysiwyg)：替换范围用 `node.nodeSize` 重新推导；异常返回 view

原始问题清单（P1–P8）已全部处置，见各子任务完成记录。

## 子任务清单（Subtasks）

### ✅ 1. 设置开关：HTML 源码编辑入口（S）

- 存储 key：`flymd:wysiwyg:htmlTableSrcEdit`，默认 `true`。
- `src/wysiwyg/v2/plugins/htmlTable.ts`：`WYSIWYG_HTML_TABLE_SRC_EDIT_KEY` + `isWysiwygHtmlTableSrcEditEnabled()`。
- `src/wysiwyg/v2/index.ts`：三处拦截（`enterTableSourceEdit` / `enterHtmlBlockSourceEdit` 入口、hover `onOver`、dblclick 条件）。
- `src/theme.ts`：设置面板 `#wysiwyg-html-table-src-edit-toggle`；交互时直读 localStorage，即时生效。
- `src/i18n.ts`：中/英 label + tip。

### ✅ 2. 失焦保存加脏检查（S）

- `apply()` 先比较 `ta.value.trim()` 与打开时的 `sourceHtml.trim()`：无变化直接关闭，不派发事务、不置脏标记。
- 浮层新增"应用 / 取消"按钮行，失焦语义固定为"有改动才保存"。

### ✅ 3. 文案与注释对齐实现（S）

- apply 失败文案改为"无法应用：未能定位到原始 HTML 节点，请关闭后重试"。
- `enterTableSourceEdit` 上方块注释重写为当前实现（节点 value 保真读写、复杂表格保持 HTML 原样）。

### ✅ 4. editLock 竞态消除（M）

- `editLock.ts` 新增 `acquireEditLockAsync()`：等待 `editable=false` 实际生效后才返回；同步版保留给 `withEditLock` 与既有测试。
- 三个浮层入口（HTML 源码 / LaTeX / Mermaid）改为"异步等待锁生效 → 再进入主体缓存文档位置"：`enterHtmlSourceEdit`、`enterLatexSourceEditLocked`、`enterMermaidSourceEditLocked`。
- 附加确定性兜底：`updateHtmlBlockNode` 新增 `expectedValue` 节点身份校验——缓存位置上的节点 value 与打开时不一致则按 DOM 重新定位，仍不一致则放弃，杜绝改错相邻 HTML 块。
- `_restoreEditable` 死代码已删除。

### ✅ 5. 兜底序列化路径加护栏（S）

- `sourceHtml` 来自 DOM 序列化时，hint 追加"未取到原始源码，保存将丢失表格属性"警告（采用"警告但允许"方案）。

### ✅ 6. 浮层能力增强（M）

- 保存前 `validateHtmlSource` 校验：表格模式要求含 `<table>`，通用模式要求解析出有效元素（注：text/html 解析器不产生 parsererror，只能做存在性校验）。
- 非表格 HTML 块（渲染为转义文本的 `span[data-type="html"]`）双击可进入同一浮层编辑：`enterHtmlBlockSourceEdit`，受同一设置开关控制。
- 语法高亮：决策为**不实现**——项目内无可复用的轻量 HTML 编辑器组件，为弹层引入新依赖（CodeMirror 等）代价不成比例，textarea 足够。

### ✅ 7. 预览链路消毒与 CSP 决策（M）

- 决策 A（已实施）：`shouldSanitizePreview()` 接入两条预览渲染路径（`renderPreviewLight` 与 `renderPreview`，`src/main.ts` 的 `sanitizePreviewHtml` helper，DOMPurify 按需动态加载并缓存）。默认策略不变：开发环境开、发行版关，`localStorage flymd:sanitizePreview` 可覆盖。KaTeX 占位符为普通 span，不受消毒影响；Mermaid 在消毒后渲染。
- 决策 B（独立立项）：`tauri.conf.json` CSP 影响面涉及插件宿主、更新浮层（`renderUpdateDetailsHTML` 依赖的全局回调从未定义、`extra.html` 原样注入）与 PDF iframe，必须单独灰度，不随本方案合并。

### ✅ 8. 任务列表健壮性跟进（S）

- CSS 公共化：新增 `--task-done-opacity`（`src/styles/base.css`），阅读模式（`preview.css`）与所见模式（`style.css`）的已完成项透明度共用，消除手工对齐漂移。复选框本体两模式实现机制不同（原生 input vs ::before 伪元素），无更多可安全提取的公共片段。
- 升级清单：`src/wysiwyg/v2/plugins/taskList.ts` 头部注释已标注 Milkdown 升级回归点。Milkdown/preset-gfm 升级检查清单：
  1. 核对 toDOM 输出仍为 `li[data-item-type="task"][data-checked]`（点击切换与 CSS 外观的共同依赖）。
  2. 核对 `span[data-type="html"]` 容器结构（`htmlMediaPlugin` 与 hover/dblclick 入口的 DOM 判断依据）。
  3. 核对 `html` 节点的 `attrs.value` 仍保存原始 HTML 源码（浮层保真读写的依据）。
  4. 回归：GFM 表格不出现铅笔按钮；含 rowspan/colspan 的 HTML 表格可保存；任务列表点击可切换。

## 验收标准（Acceptance）

1. ✅ `pnpm test`：763 用例全部通过（仅 `web/server` 2 个套件因子包缺 `dotenv`/`openai` 依赖失败，为既有环境问题，与本方案无关）；`pnpm build` 通过。
2. ✅ 开关：设置面板可见"HTML源码编辑"项；关闭后 hover 无铅笔按钮、双击表格/HTML 块无浮层、`__mdeditorEnterTableSourceEdit` 无效；重开即时恢复。
3. ✅ 浮层无改动失焦不产生事务与脏标记（脏检查在 `apply()` 入口）。
4. ✅ 浮层打开前异步等待锁生效；apply 时 `expectedValue` 节点身份校验兜底。
5. 人工核查项（交由日常回归）：GFM 表格不出现铅笔按钮；含 rowspan/colspan 的 HTML 表格可正常保存；非表格 HTML 块双击可编辑。

## 风险与回滚（Risks & Rollback）

- 全部为新增分支与函数级重构，无数据迁移；回滚 = revert 对应提交。
- editLock 改动影响 LaTeX/Mermaid 浮层共用路径：若回归浮层锁定行为，回滚 `editLock.ts` 与 `index.ts` 中三个入口函数即可。
- 预览消毒接线在发行版默认关闭（行为不变），如开发环境出现预览差异，用 `localStorage flymd:sanitizePreview = '0'` 临时关闭定位。

## 工时估算（Estimate）

| 子任务 | 粒度 | 状态 |
|--------|------|------|
| 1. 设置开关 | S | ✅ |
| 2. 失焦脏检查 | S | ✅ |
| 3. 文案注释 | S | ✅ |
| 4. editLock 竞态 | M | ✅ |
| 5. 兜底护栏 | S | ✅ |
| 6. 浮层增强 | M | ✅（语法高亮决策不实现） |
| 7. 消毒/CSP 决策 | M | ✅（消毒已接线，CSP 独立立项） |
| 8. 任务列表跟进 | S | ✅ |
