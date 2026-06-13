import { describe, it, expect, beforeAll } from 'vitest'
import MarkdownIt from 'markdown-it'
import katexPlugin from './plugins/markdownItKatex'

// 模拟 src/main.ts ensureRenderer 中的 highlight() 函数
function makeHighlight() {
  const escMap: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch: string) => escMap[ch] || ch)
  return (code: string, lang: string): string => {
    const lower = (lang || '').toLowerCase()
    if (lower === 'mermaid' || lower === 'flow' || lower === 'seq') {
      return `<pre class="mermaid">${esc(code)}</pre>`
    }
    if (lower === 'math' || lower === 'katex' || lower === 'latex') {
      return `<pre class="md-math-block" data-math="${esc(code)}"></pre>`
    }
    return `<pre><code class="hljs">${esc(code)}</code></pre>`
  }
}

describe('math / katex / latex code block rendering (highlight hook)', () => {
  let md: MarkdownIt
  beforeAll(() => {
    md = new MarkdownIt({
      html: true,
      linkify: true,
      breaks: true,
      highlight: makeHighlight()
    })
    md.use(katexPlugin as any)
  })

  it('```math block → md-math-block placeholder', () => {
    const html = md.render('```math\nE = mc^2\n```')
    expect(html).toContain('md-math-block')
    expect(html).toContain('data-math=')
  })

  it('```katex block → md-math-block placeholder', () => {
    const html = md.render('```katex\n\\sum_{k=1}^{n} a_k\n```')
    expect(html).toContain('md-math-block')
    expect(html).toContain('data-math=')
  })

  it('```latex block → md-math-block placeholder', () => {
    const html = md.render('```latex\nf(x) = \\int_{-\\infty}^{\\infty} \\hat f(\\xi) e^{2\\pi i \\xi x} d\\xi\n```')
    expect(html).toContain('md-math-block')
    expect(html).toContain('data-math=')
  })

  it('```mermaid block → <pre class="mermaid"> (unchanged)', () => {
    const html = md.render('```mermaid\ngraph TD; A-->B\n```')
    expect(html).toContain('class="mermaid"')
  })

  it('```flow block → <pre class="mermaid"> (alias, source preserved)', () => {
    const html = md.render('```flow\nst=>start: 用户登陆\nop=>operation: 登陆操作\n```')
    expect(html).toContain('class="mermaid"')
    // 不自动补头：mermaid 11 已不支持老式 st=>start 语法，让 mermaid 自己的错误兜底显示
    expect(html).toContain('st=&gt;start')
  })

  it('```seq block → <pre class="mermaid"> (alias, source preserved)', () => {
    const html = md.render('```seq\nAndrew->China: Hello\n```')
    expect(html).toContain('class="mermaid"')
    expect(html).toContain('Andrew-&gt;China')
  })

  it('inline $...$ still works', () => {
    const html = md.render('inline $a^2+b^2=c^2$ here')
    expect(html).toContain('md-math-inline')
  })

  it('$$...$$ block still works', () => {
    const html = md.render('$$\nE=mc^2\n$$')
    expect(html).toContain('md-math-block')
  })

  it('LaTeX special chars in math block are escaped (no XSS)', () => {
    const html = md.render('```math\n<script>alert(1)</script>\n```')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('inline $$...$$ in middle of paragraph is recognized as inline-display (regression: user case)', () => {
    const html = md.render('行内的公式$$E=mc^2$$行内的公式')
    expect(html).toContain('md-math-inline-display')
    expect(html).toContain('E=mc^2')
    // 段中：必须仍是行内元素（<span>），不能被 div 强制断行
    expect(html).toContain('<span class="md-math-inline md-math-inline-display"')
    expect(html).not.toContain('<div class="md-math-block"')
  })

  it('inline $$...$$ multiple occurrences in one paragraph', () => {
    const html = md.render('行内的$$E=mc^2$$公式，行内的$$a^2+b^2=c^2$$公式。')
    expect(html).toContain('md-math-inline-display')
    expect(html).toContain('E=mc^2')
    expect(html).toContain('a^2+b^2=c^2')
  })

  it('$$...$$ on its own line still produces math block (regression: existing behavior)', () => {
    const html = md.render('$$E=mc^2$$')
    expect(html).toContain('md-math-block')
    expect(html).toContain('E=mc^2')
  })

  it('escaped \\$ is not treated as math start', () => {
    const html = md.render('价格 \\$5.00 不是公式')
    expect(html).not.toContain('md-math-inline')
    expect(html).not.toContain('md-math-block')
    expect(html).toContain('$5.00')
  })

  it('mixed $...$ and $$...$$ in one paragraph: $ → inline, $$ → inline-display', () => {
    const html = md.render('内联 $a^2$ 中间 $$E=mc^2$$ 结尾 $b^2$')
    // 单 $ → 普通 inline
    expect(html).toContain('<span class="md-math-inline"')
    // 双 $ → inline-display
    expect(html).toContain('<span class="md-math-inline md-math-inline-display"')
  })
})
