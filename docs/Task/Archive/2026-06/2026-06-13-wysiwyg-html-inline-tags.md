# 任务:所见模式 sub/sup/abbr HTML 内联标签渲染

**状态**: ✅ 已完成 (完成时间: 2026-06-14)
**创建日期**: 2026-06-13
**责任人**: Claude
**范围**: `src/wysiwyg/v2/` 内所见模式扩展,支持 `<sub>` `<sup>` `<abbr>` 三个内联 HTML 标签正确渲染

---

## 1. 目标

1. 所见模式下 `H<sub>2</sub>O` / `x<sup>2</sup>` / `<abbr title="...">X</abbr>` 正确显示
2. 源 markdown **保持原样**,切换模式仍显示 `<sub>` 等标签
3. 不引入新依赖
4. 留下可扩展接口

## 2. 根因分析

- remark-parse 把 `<sub>2</sub>` 拆为 3 个 AST 节点: `html("<sub>")` + `text("2")` + `html("</sub>")`
- milkdown commonmark 的 `html` 节点 schema 将每个 `html` AST 节点映射为 `atom: true` 的 ProseMirror 节点,`toDOM` 只是 `span.textContent = rawHtml`
- 结果: 所见模式显示字面 `<sub>2</sub>` 而非渲染后的下标

## 3. 方案: Mark 扩展

使用 `$markSchema` 而非 `$node`,因为 sub/sup/abbr 本质是文本格式化标记,与 bold/em 语义一致。

### 技术实现

1. **Remark 插件** (`remarkHtmlInlineTags`): 合并配对 HTML 标签为自定义 MDAST 节点 (`html_sub`/`html_sup`/`html_abbr`),覆盖所有 phrasing parent 类型
2. **$markSchema 定义**: 3 个 mark (sub/sup/abbr),abbr 带 `title` 属性
3. **parseMarkdown**: `openMark` → `next(children)` → `closeMark`
4. **toMarkdown**: `withMark` 输出自定义 MDAST 节点
5. **remark-stringify handlers**: 自定义序列化器将自定义 MDAST 节点还原为 HTML 标签,含 HTML 属性转义
6. **parseDOM/toDOM**: 映射为浏览器原生 `<sub>`/`<sup>`/`<abbr>` 标签

### 与上次 $node 方案的区别 (上次失败原因)

- 上次用 `$node` 定义 inline node,parseMarkdown.match 的 type 路由无法生效
- 本次用 `$markSchema`,与 milkdown 内置的 emphasis/strong/strikethrough mark 机制完全一致
- 不需要 NodeView,ProseMirror 自动处理光标/选择/嵌套

## 4. 文件变更

- 新增: `src/wysiwyg/v2/plugins/htmlInlineTags.ts` — 插件核心代码
- 新增: `src/wysiwyg/v2/plugins/htmlInlineTags.test.ts` — 8 个单元测试
- 修改: `src/wysiwyg/v2/index.ts` — 导入并注册插件 + remark-stringify handlers
- 修改: `src/styles/preview.css` — 所见模式 sub/sup/abbr CSS 样式

## 5. 验收结果

- [x] 所见模式 `H<sub>2</sub>O` 显示为下标
- [x] 所见模式 `x<sup>2</sup>` 显示为上标
- [x] 所见模式 `<abbr title="...">X</abbr>` 显示带 dotted 下划线
- [x] 切换模式,源 markdown 保持 `<sub>` 等字面标签
- [x] heading/tableCell 等非 paragraph 上下文也支持
- [x] 未闭合标签不会破坏解析
- [x] abbr title 属性中的特殊字符正确转义
- [x] tsc --noEmit 0 新增错误
- [x] 610/610 全套测试通过 (原 602 + 新增 8)
