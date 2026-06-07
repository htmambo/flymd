# PDF 导出功能完整性修复计划

**状态**: ✅ 已完成 (完成时间: 2026-06-07)
**执行方式**: /fullauto（零交互自动执行）
**关联**: `PDF_EXPORT_VALIDATION_REPORT.md`、`PDF_BLANK_FIX_TEST_GUIDE.md`

---

## 一、背景

PDF 导出"右键菜单"路径（库树文件 / 标签）经分析与 Codex 交叉验证，存在多处内容缺口；用户另追加两项问题。本计划一次性修复。

## 二、问题清单与根因

### 根因总览
主路径 `exportCurrentDocToPdf`（main.ts:5392）先执行 `renderPreview({forPrint:true})`，对预览 DOM 做了完整后处理（Mermaid→SVG、KaTeX 占位符填充）后才导出；而右键路径 `pdfContextExport.exportFileToPdf` 仅调用 `flymdRenderMarkdown`（纯 `md.render()`），**跳过全部 DOM 后处理**，导致公式/图表丢失。

| # | 严重度 | 问题 | 根因 |
|---|---|---|---|
| 1 | 🔴 | 右键导出 KaTeX 公式丢失（空白） | `markdownItKatex` 只产空占位 `.md-math-*`，填充靠 `renderKatexPlaceholders`（DOM 后处理），右键路径未调用 |
| 2 | 🔴 | 右键导出 Mermaid 图表不渲染（显示源码） | Mermaid→SVG 是 `renderPreview` 内联 DOM 后处理（main.ts:4088-4153），右键路径未调用 |
| 3 | 🟡 | 部分图片未渲染进 PDF（用户反馈①） | `inlineImagesForPdf` 在 **detached** clone 上替换 `src`（pdf.ts:828），脱离文档的 `<img>` 不触发加载；真正加载要等挂载（909）后，而挂载后等待仅 2500ms，慢图/大图被 html2canvas 截到未加载态 |
| 4 | 🟡 | 失败时弹两次 alert | `pdfContextExport` catch 内 `alert`+`throw`，调用方（TabBar/libraryContextMenu）再 `alert` |
| 5 | 🟢 | 成功也弹 alert | `flymdShowToast` 从未定义，成功提示走 `alert`；且 overlay 已显示"导出完成"，提示重复 |
| 6 | 🟡 | 进度遮罩暗色主题下太亮（用户反馈②） | `progressOverlay` 遮罩固定 `rgba(255,255,255,.86)` 白色，暗色主题刺眼；对话框无暗色适配 |

## 三、修复方案

### 修复 1+2（KaTeX/Mermaid）— `src/main.ts` + `src/exporters/pdfContextExport.ts`
- main.ts：将 `renderPreview` 内联的 Mermaid 渲染逻辑抽成可复用函数 `renderMermaidIn(root: HTMLElement)`，`renderPreview` 改为调用它（行为不变）。
- main.ts：新增全局 `flymdRenderMarkdownToContainer(container, markdown)`：复用 `flymdRenderMarkdown` 得到 HTML → 注入 container → `ensurePreviewHeadingIds` → `await renderMermaidIn` → `await renderKatexPlaceholders(container, true)`。
- pdfContextExport：先把容器挂到 body，再调用 `flymdRenderMarkdownToContainer(previewBody, markdown)`，使公式/图表与主路径一致。

### 修复 3（图片）— `src/exporters/pdf.ts`
- 将 `inlineImagesForPdf` 与图片等待从挂载前（detached，828-845）移到挂载到 `document.body` 之后（909 后），在已连接文档的 `exportRoot` 上内联，使 `<img>` 立即发起加载、等待有效。
- 提高挂载后图片等待上限（给慢图余量），删除挂载前无效的内联+等待。

### 修复 4+5（错误/成功提示去重）— `src/exporters/pdfContextExport.ts`
- 外层 catch：取消→静默返回；有进度遮罩→`overlay.fail` 展示并 `return`（不再 alert/throw）；无遮罩（对话框前的早期错误）→ throw 交调用方统一 alert。移除 catch 内的 `alert`。
- 成功路径：仅靠 overlay 显示"导出完成"（与主路径一致），移除额外 `alert`/`flymdShowToast` 分支。

### 修复 6（暗色遮罩）— `src/core/progressOverlay.ts`
- 遮罩背景由白色改为中性淡色 `rgba(15,23,42,.28)`（深浅主题皆协调、不刺眼，保留聚焦/拦截误点）。
- 新增 `body.dark-mode` 下对话框、标题、副标题、日志、按钮、图标的暗色适配。

## 四、决策记录（Decisions）

1. **不采用完整多代理编排**：本任务是已深度分析的内聚缺陷集，由主代理（Opus）亲自实施 + Codex 审核，规避 model-routing 风险、保证改动一致性。
2. **遮罩弱化而非完全移除**：用户建议"可不要遮罩"，但保留极淡中性遮罩以维持聚焦与误点拦截；完全透明会使对话框浮空、与背景混淆。
3. **Mermaid 逻辑抽取复用**而非在导出路径重写，避免两份逻辑漂移。

## 五、假设（Assumptions）

1. 未保存且**从无 filePath** 的新文档，其本地相对图片无解析基准 → 属固有限制；有 filePath（含 dirty）即可正常解析，现有代码已满足。
2. 暗色主题标志为 `body.dark-mode`（与 pdf.ts、main.ts 既有用法一致）。

## 六、子任务清单

- [x] T1 main.ts：抽取 `renderMermaidIn` + 新增 `flymdRenderMarkdownToContainer`
- [x] T2 pdfContextExport.ts：改用新渲染函数（挂载后渲染）+ 透传 filePath
- [x] T3 pdfContextExport.ts：错误/成功提示去重（移除双重 overlay.fail，区分"未提供"与"显式为空" content）
- [x] T4 pdf.ts：图片内联移至挂载后 + 等待增强
- [x] T5 progressOverlay.ts：遮罩弱化 + 暗色适配
- [x] T6 `npm run build` 通过
- [x] T7 Codex 审核（追加 3 项修复：data-abs-path 安全、移除多余 remap、Tauri 兜底 URL 泄漏）
- [x] T8 归档

## 七、验收标准

- 构建无 TS 错误。
- 右键导出含 `$...$`/`$$...$$` 的文档：PDF 正确显示公式。
- 右键导出含 ```mermaid``` 的文档：PDF 显示图表（非源码）。
- 含本地/远程图片文档：图片完整出现在 PDF。
- 导出失败仅一次提示；成功无 alert（仅 overlay）。
- 暗色主题下进度弹窗不刺眼，对话框协调。

## 八、风险

- pdf.ts 图片内联顺序调整可能影响分页渲染：构建后需保留原 SVG 尺寸冻结逻辑（读原节点尺寸，不受影响）。
- main.ts 抽取函数须保证 `renderPreview` 行为完全不变（回归风险）。

## 九、追加修复（T7 衍生）

Codex 审核命中 3 项：

1. **data-abs-path 安全（🔴）** — `injectImageAbsPaths` 改为"始终基于当前 src 重写 data-abs-path/data-raw-src"，不预信任原始 HTML 中的同名属性，杜绝 Markdown 原始 HTML 注入触发任意本地图片读取。
2. **去掉多余 remap（🟢）** — WebDAV 同步 remap 失败兜底已由 `inlineImagesForPdf` 处理（pdf.ts:222），无需在 `injectImageAbsPaths` 阶段覆盖；保留 `data-abs-path` 为本次解析的纯本地绝对路径。
3. **Tauri 兜底 URL 泄漏（🟡）** — `fetchRemoteAsObjectUrl` 的 catch 内 `fetchUrlAsObjectUrl` 返回值同样受 `timedOut` 守卫，超时后到达的兜底 URL 立即 revoke。
4. **清理死代码** — 移除 `overlayFinalized` 标志（内层 fail 已删除，标志永不触发）。

最终构建通过（44.17s，exit 0）。
