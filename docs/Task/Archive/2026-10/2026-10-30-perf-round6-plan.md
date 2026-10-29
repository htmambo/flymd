# 性能优化批次 F 计划（预览渲染管线抽取 + 快照锁定：P0-7 前置）

**状态**: ✅ 已完成（完成时间: 2026-10-30）
**依据**: [PERFORMANCE_ANALYSIS_2026-10.md](../Analysis/PERFORMANCE_ANALYSIS_2026-10.md) P0-7；上轮 Deferred"renderPreview 快照测试（需先抽取渲染管线）"——本批完成该前置

## 任务目标

把 renderPreview 的**纯字符串渲染核心**抽到 `src/core/previewRenderer.ts` 并用快照测试逐字节锁定，为后续块级缓存/增量渲染建立安全网：

1. **F1**: `createPreviewMarkdownIt(deps)`——markdown-it 实例构建（原 ensureRenderer 主体逐字搬移：html/linkify/breaks 配置、mermaid/math 围栏占位、hljs 高亮回调、footnote/katex/tasklist/callout 插件、table 包装规则）。**保留历史怪癖**：tasklist 注册在 katex try 块内（katex 加载失败则 tasklist 不生效），逐字复制并注释
2. **F2**: `renderMarkdownCore(raw, md)`——protectExcelDollarRefs → normalizeCalloutMarkdown → guardStrongBoundaryForCommonMark → md.render → stripStrongBoundaryGuard，顺序与原 renderPreview 2892-2905 一致（ensureHljsCore 留在 main.ts，调用点在管线之前，纯加载器无字符串交互、重排无影响）
3. **F3**: 快照测试（markdown 字符串 → HTML 字符串，node 环境即可）：标题/列表/表格/代码围栏（测试注入 hljs 桩走转义路径）/mermaid 占位/math 占位/行内与块级公式/任务列表/callout/脚注/Excel 美元保护/strong boundary 往返/linkify/breaks/HTML 透传

**本批不做**：DOM 增强段（enhanceFootnotes/decorateCodeBlocks/a/img 遍历）抽取、块级缓存/虚拟化本体——后续批次在快照保护下进行。

## 验证

五门禁 + 新快照测试（显式 toContain 断言关键占位符 + 整体快照）。

## 验证结果（2026-10-30）

- `tsc --noEmit`：0 错误
- `vitest run`：794/794（62 文件；新增管线快照测试 15 例）
- `npm run build`：成功，闭包门禁通过（markdown-it 仍为动态加载，入口闭包 8 文件）
- `cargo check` / `cargo test`：31/31（本批无 Rust 改动，纪律性复跑）

## 实施记录

- 快照实证校准了 4 处断言（凭猜测写的全部失败）：mermaid 占位内容会被转义（`A-->B` → `A--&gt;B`）且带尾随换行；math 围栏占位的 data-math 带尾随换行；行内/块级公式输出为占位符（`md-math-inline`/`md-math-block` div），KaTeX 实际渲染在 DOM 阶段；callout 输出是 `<div class="callout">` 结构且标题含内联 SVG 图标（`not.toContain('<svg')` 断言不成立）。
- Excel 美元保护只对"行首 = 的公式行"生效（isExcelFormulaLine 判定），中文前缀行不受保护——快照实证，属既有行为非缺陷。
- 历史怪癖保留并注释：tasklist 注册在 katex try 块内，katex 加载失败则 tasklist 不注册。

## 备注

- 本轮未经过 External Review MCP 审查（当前运行时未配置该 MCP）。
- 后续批次（需先真机回归现有四批改动）：在快照保护下抽取 DOM 增强段 → 块级渲染缓存 → 可见区分块挂载。

## 风险与回滚

- 管线行为等价由"逐字搬移 + 快照锁定"保证；main.ts 侧 ensureRenderer/renderPreview 改为薄壳
- 回滚 = 还原 main.ts 两处调用点 + 删新模块（单 commit 文件集）
