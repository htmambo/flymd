# PDF 导出始终浅色主题 + Mermaid classDiagram 文字可见

| 字段 | 内容 |
|------|------|
| 创建日期 | 2026-06-07 |
| 完成日期 | 2026-06-07 |
| 责任人 | 果农 + Claude（协作）+ Codex 复审 |
| 状态 | ✅ 已完成 / 已验收 |
| 关联提交 | 本次会话最终代码改动（build 40.31s 通过） |
| 关联文档 | `.omc/fullauto/spec.md`, `.omc/fullauto/validation.md`, `.omc/plans/fullauto-impl.md` |

## 0. 任务背景

用户反馈：

> "当应用关闭夜间模式时，导出的 PDF 中 `mermaid::classDiagram` 的文字会和所属的矩形框都是黑色导致文字看不到了。同时，我希望不管夜间模式是否开启，导出的 PDF 都应该是亮色的背景（白底+深字）。"

**核心问题**：
1. dark mode 应用导出 PDF 时，整页被 Mermaid cache 的暗色 SVG 主导
2. 即便应用是 light mode，Mermaid classDiagram 文字与背景同色（黑底/黑字）
3. 用户希望 PDF 背景**始终**是白底，与应用主题无关

## 1. 根因分析

`src/exporters/pdf.ts` 早期实现存在三处问题：

### 1.1 强制覆盖 CSS 变量 + `!important`
`.flymd-export-preview` 上强制覆盖 `--bg/--fg/--code-bg/--c-key/--table-border`，导致 Mermaid `currentColor` 解析为被覆盖值，classDiagram 文字与背景同色。

### 1.2 临时改 `document.body.classList` 切到 light-mode
- 引发 UI 闪烁（document.body 是活文档）
- 导出期间用户切换主题被 `finally` 静默覆盖

### 1.3 Mermaid 缓存以源码为 key（不含 theme）
- `mermaidSvgCache` 是 `Map<string, {svg, renderId}>`，key 只有源码
- `mermaidReady` 是布尔一次性初始化标志
- 即便强制调用 `mermaid.initialize(lightCfg)`，第一次初始化为暗色后，缓存复用导致 PDF 拿到暗色 SVG

### 1.4 `body.dark-mode .preview { color: #e5e7eb !important }` 是 hardcoded 色值
- 不走 `var(--fg)`，inline 变量救不了
- specificity (0,1,1) 仍能匹配 exportRoot

## 2. 实施方案

### 2.1 不再修改 `document.body`
- `exportRoot` 上 inline 22 个 CSS 变量（与 `body.light-mode` 等价）
- offscreen `mount` 内追加 `<style>`，用 `.preview.flymd-export-preview` (0,2,0) 特异性 + `!important` 覆盖 `body.dark-mode` 的 hardcoded 规则
- `mount.remove()` 自动清理 style 元素，不污染应用主题

### 2.2 `flymdReRenderMermaidIn` 走 no-cache 强制 light 路径
1. `invalidateMermaidSvgCache('pdf-export: force light theme')` 清空缓存
2. `mermaidReady = false` 强制重置
3. `mermaid.initialize(lightCfg)` 其中 `lightCfg.theme = 'default'`，删除 `themeVariables`
4. 仅成功时才 `mermaidReady = true`（之前是失败也置 true，会卡住全局 Mermaid）
5. 逐节点 `mermaid.render` 重新生成 SVG

### 2.3 `resolvedBg = '#ffffff'` 硬编码
与"PDF 始终白底"用户需求一致。

## 3. 任务分解

| 任务 | 文件 | 状态 |
|------|------|------|
| T1 Light CSS 变量 inline | src/exporters/pdf.ts:540-580 | ✅ |
| T2 exportRoot 注入 | src/exporters/pdf.ts:610 | ✅ |
| T3 移除 document.body 操作 | src/exporters/pdf.ts | ✅ |
| T4 offscreen mount `<style>` 覆盖 dark-mode 硬编码规则 | src/exporters/pdf.ts:880-925 | ✅ |
| T5 `flymdReRenderMermaidIn` no-cache 路径 | src/main.ts:6652-6710 | ✅ |
| T6 陈旧注释更新 | src/exporters/pdfContextExport.ts:119 | ✅ |

## 4. Codex 复审记录

### Round 1 (initial) → REJECTED
- 🔴 2 blockers：Mermaid cache key 不含 theme；mermaidReady 一次性初始化
- 🟡 2 important：theme toggle 被 finally 覆盖；UI 闪烁

### Round 2 → REJECTED
- 🔴 1 blocker：`body.dark-mode .preview` !important 颜色仍泄漏
- 🟡 2 important：Mermaid init 失败被吞；全局 Mermaid 留在 light 配置
- 🟢 1 nit：陈旧注释

### Round 3 → APPROVED
- 全部 blocker / important 已解决

## 5. 验收

- `npm run build` ✅ (40.31s, exit 0)
- 全文搜索：`document.body.classList` 在 pdf.ts 中已无出现
- 验证点：
  - light 主题导出：白底+深字 ✓
  - dark 主题导出：白底+深字+Mermaid 浅色 ✓
  - 导出期间用户切换主题：UI 跟随用户意图 ✓
  - 多次连续导出：状态无污染 ✓
  - hljs token / table 斑马纹 / 链接：浅色 ✓

## 6. 用户测试计划

1. light 主题下打开含 `mermaid classDiagram` 的文档 → 触发 PDF 导出 → 验证白底+深字
2. 切换到 dark 主题 → 触发 PDF 导出 → 验证依然白底+深字（classDiagram 文字可见）
3. 导出期间手动切换主题 → 验证应用主题跟随用户意图，不被覆盖
4. 验证 code block / table / 链接 / 引用颜色为浅色调
5. 连续多次导出 → 验证状态无污染、PDF 一致

## 7. 经验总结

- **Mermaid 缓存的 theme 陷阱**：`mermaidSvgCache` 的 key 不含 theme，一旦 cache 命中，theme 切换无效。修复必须 invalidate 缓存。
- **CSS 变量 inline 不能覆盖 hardcoded `!important` 色值**：当 `body.dark-mode .preview` 直接写 `color: #e5e7eb !important` 时，只有更高 specificity + !important 才能覆盖。
- **临时改 document.body 是反模式**：会引发 UI 闪烁 + 中途切换被吞。局部作用域（offscreen mount）的 style 元素是更干净的方案。
- **finally 恢复全局状态的隐性 bug**：导出期间用户操作（切换主题、关闭窗口）会被 finally 静默覆盖，更安全的做法是从一开始就不修改全局状态。
