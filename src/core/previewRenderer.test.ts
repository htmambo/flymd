// 预览渲染管线快照测试（perf 批次 F / P0-7 前置）
//
// 目的：把 markdown 字符串 → HTML 字符串的纯字符串管线（createPreviewMarkdownIt +
// renderMarkdownCore）输出逐字节锁定，为后续块级缓存/增量渲染提供 FR-2 类安全网。
// 覆盖关键占位符显式断言 + 整体快照。
//
// hljs 依赖注入为桩（getHljsCore → null）：代码块走转义路径，输出不随 highlight.js
// 版本漂移；hljs 高亮路径本身由上游库保证。markdown-it 升级时快照需显式重建
// （vitest -u），属预期的"刻意重锁"。

import { describe, it, expect } from 'vitest'
import { createPreviewMarkdownIt, renderMarkdownCore } from './previewRenderer'

const deps = {
  getHljsCore: () => null,
  normalizeHljsLang: (lang: string) => lang.trim().toLowerCase(),
  ensureHljsCore: async () => null,
  debugRender: false,
}

// 覆盖各类语法的样例文档
const FIXTURE = `# 一级标题

普通段落，**加粗**、*斜体*、\`行内代码\`，链接 <https://example.com>
以及自动链接 https://example.com

## 二级标题

- 无序列表项 A
- 无序列表项 B

1. 有序列表项一
2. 有序列表项二

| 列一 | 列二 |
| --- | --- |
| a1 | b1 |

\`\`\`ts
const x: number = 1
\`\`\`

\`\`\`mermaid
flowchart TD
A-->B
\`\`\`

\`\`\`math
E = mc^2
\`\`\`

行内公式 $E = mc^2$ 与块级公式：

$$
\\int_0^1 x \\, dx
$$

- [ ] 未完成任务
- [x] 已完成任务

> [!note] 提示标题
> 提示内容

脚注引用[^1]。

[^1]: 脚注内容

Excel 公式行（行首 = 才受保护）：
=SUM($A$1:$B$2)

<div class="raw-html">透传</div>

软换行
下一行
`

let md: Awaited<ReturnType<typeof createPreviewMarkdownIt>>
let fixtureHtml: string

describe('预览渲染管线（字符串 → HTML）', () => {
  it('构建实例并渲染样例文档', async () => {
    md = await createPreviewMarkdownIt(deps)
    fixtureHtml = await renderMarkdownCore(FIXTURE, md)
    expect(typeof fixtureHtml).toBe('string')
    expect(fixtureHtml.length).toBeGreaterThan(200)
  })

  it('mermaid 围栏输出占位容器（内容转义）', async () => {
    expect(fixtureHtml).toContain('<pre class="mermaid">flowchart TD\nA--&gt;B\n</pre>')
  })

  it('math/katex/latex 围栏输出 md-math-block 占位（内容带尾随换行）', async () => {
    expect(fixtureHtml).toContain('<pre class="md-math-block" data-math="E = mc^2\n">')
  })

  it('行内/块级公式经 markdownItKatex 输出占位（KaTeX 实际渲染在 DOM 阶段）', async () => {
    expect(fixtureHtml).toContain('<span class="md-math-inline" data-math="E = mc^2"></span>')
    expect(fixtureHtml).toContain('<div class="md-math-block" data-math="\\int_0^1 x \\, dx">')
  })

  it('任务列表渲染为复选框（含 checked）', async () => {
    expect(fixtureHtml).toContain('task-list-item-checkbox')
    expect(fixtureHtml).toContain('checked')
  })

  it('callout 渲染为 callout 结构', async () => {
    expect(fixtureHtml).toContain('callout')
    expect(fixtureHtml).toContain('提示标题')
  })

  it('脚注渲染为脚注结构', async () => {
    expect(fixtureHtml).toContain('footnote')
  })

  it('表格包装 table-wrapper', async () => {
    expect(fixtureHtml).toContain('<div class="table-wrapper">')
  })

  it('breaks=true：单个换行渲染为 <br>', async () => {
    expect(fixtureHtml).toContain('软换行<br>')
  })

  it('html=true：原生 HTML 透传', async () => {
    expect(fixtureHtml).toContain('<div class="raw-html">透传</div>')
  })

  it('Excel 公式行的美元被保护（不产生行内公式占位）', async () => {
    expect(fixtureHtml).toContain('=SUM($A$1:$B$2)')
    expect(fixtureHtml).not.toContain('md-math-inline" data-math="1:')
  })

  it('hljs 桩路径：未知语言代码块走转义输出', async () => {
    expect(fixtureHtml).toContain('<pre><code class="hljs">const x: number = 1')
  })

  it('整体输出快照（markdown-it/插件升级时需显式 vitest -u 重锁）', async () => {
    expect(fixtureHtml).toMatchSnapshot()
  })

  it('strong boundary 零宽守卫字符在输出中被剥离', async () => {
    // guardStrongBoundaryForCommonMark 注入 \u200B、strip 负责剥除——往返后不残留
    const html = await renderMarkdownCore('a **b** c\u200B', md!)
    expect(html).not.toContain('\u200B')
  })

  it('normalizeCalloutMarkdown：callout 内空行补 > 前缀，保持单个 callout', async () => {
    // 场景（函数注释语义）：callout 内的空行后随 > 行 → 空行补 > 前缀，
    // 避免 CommonMark 把两段 > 分断为两个 blockquote
    const html = await renderMarkdownCore('> [!note] 标题\n> 第一行\n\n> 第二行\n', md!)
    expect((html.match(/data-callout="note"/g) || []).length).toBe(1)
    const atFirst = html.indexOf('第一行')
    const atSecond = html.indexOf('第二行')
    expect(atFirst).toBeGreaterThan(-1)
    expect(atSecond).toBeGreaterThan(atFirst)
    // 两行之间没有 callout 收尾（未分断）
    expect(html.slice(atFirst, atSecond)).not.toContain('</div></div>')
  })
})
