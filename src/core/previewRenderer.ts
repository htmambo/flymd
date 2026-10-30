// 预览渲染管线（perf 批次 F / P0-7 前置）
//
// 抽离自 main.ts 的 ensureRenderer（markdown-it 实例构建）与 renderPreview 的纯字符串
// 段（protectExcel → normalizeCallout → guardStrong → render → strip）。只做
// markdown 字符串 → HTML 字符串，不碰 DOM；DOM 增强（enhanceFootnotes/decorateCodeBlocks
// /a[href]/img[src] 遍历）仍在 main.ts，后续批次在快照保护下再抽。
//
// 行为等价红线（FR-2 类）：本模块所有逻辑与原实现逐字对应，输出由
// previewRenderer.test.ts 快照逐字节锁定。

import { protectExcelDollarRefs } from '../utils/excelFormula'
import { guardStrongBoundaryForCommonMark, stripStrongBoundaryGuard } from '../plugins/strongBoundaryCompat'
import { applyMdTaskListPlugin } from '../plugins/markdownItTaskList'
import type MarkdownIt from 'markdown-it'

export interface PreviewRendererDeps {
  /** 返回已加载的 hljs 核心（可能为 null：未加载或测试桩；null 时代码块走转义路径） */
  getHljsCore: () => any
  /** hljs 语言名归一化（main.ts normalizeHljsLang，别名表查表） */
  normalizeHljsLang: (lang: string) => string
  /** 确保 hljs 核心已加载（main.ts ensureHljsCore） */
  ensureHljsCore: () => Promise<any>
  /** 渲染诊断日志开关（main.ts DEBUG_RENDER） */
  debugRender?: boolean
}

/**
 * 构建 markdown-it 实例。逻辑逐字抽自 main.ts ensureRenderer：
 * - html/linkify/breaks 配置（breaks=true 与所见模式"回车即提行"一致）
 * - mermaid/flow/seq 围栏 → mermaid 占位；math/katex/latex 围栏 → md-math-block 占位
 * - hljs 高亮（核心未就绪或语言未知 → 转义路径）
 * - footnote / katex / tasklist / callout 插件；table 包装规则
 * 历史怪癖（原样保留）：tasklist 注册位于 katex 的 try 块内——katex 动态 import
 * 失败时 tasklist 同样不会注册。
 */
export async function createPreviewMarkdownIt(deps: PreviewRendererDeps): Promise<MarkdownIt> {
  await deps.ensureHljsCore()
  const { default: MarkdownItCtor } = await import('markdown-it')
  const md = new MarkdownItCtor({
    html: true,
    linkify: true,
    breaks: true, // 单个换行渲染为 <br>，与所见模式的"回车即提行"保持一致
    highlight(code: string, lang: string): string {
      // Mermaid 代码块保留为占位容器，稍后由 mermaid 渲染
      // math / katex / latex 三个围栏代码块统一识别为数学公式，输出与 $$...$$ 相同的占位元素
      // 由 renderKatexPlaceholders 二次渲染（与自定义 markdownItKatex 插件行为一致）
      // flow / seq 别名：兼容老式 ```flow / ```seq 围栏，一并走 mermaid 渲染管线。
      // 注意：mermaid 11 已不再支持 `st=>start:` / `Andrew->China:` 这类老式语法，
      // 用户需改用 `flowchart TD` + `A-->B` / `sequenceDiagram` + `A->>B` 新式语法。
      const escMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
      const esc = (s: string) => s.replace(/[&<>"']/g, (ch: string) => escMap[ch] || ch)
      const lower = (lang || '').toLowerCase()
      if (lower === 'mermaid' || lower === 'flow' || lower === 'seq') {
        try { if (deps.debugRender) console.log('[预处理] mermaid 代码块（lang=' + lower + '）') } catch {}
        return `<pre class="mermaid">${esc(code)}</pre>`
      }
      if (lower === 'math' || lower === 'katex' || lower === 'latex') {
        try { if (deps.debugRender) console.log('[预处理] math 代码块（lang=' + lower + '）: 走 KaTeX 占位') } catch {}
        return `<pre class="md-math-block" data-math="${esc(code)}"></pre>`
      }
      try {
        const hljs = deps.getHljsCore()
        const normalizedLang = lang ? deps.normalizeHljsLang(lang) : ''
        if (normalizedLang && hljs && hljs.getLanguage(normalizedLang)) {
          const r = hljs.highlight(code, { language: normalizedLang, ignoreIllegals: true })
          return `<pre><code class="hljs language-${lang}">${r.value}</code></pre>`
        }
      } catch {}
      return `<pre><code class="hljs">${esc(code)}</code></pre>`
    },
  })
    // 启用脚注支持（[^1] / [^name] 语法）
    try {
      const footnoteMod = await import('../plugins/markdownItFootnote')
      const applyFootnote = (footnoteMod as any).default as ((m: any) => void) | undefined
      if (typeof applyFootnote === 'function') applyFootnote(md)
    } catch (e) {
      console.warn('markdown-it-footnote 加载失败：', e)
    }
    // 启用 KaTeX 支持（$...$ / $$...$$）
    try {
      const katexPlugin = (await import('../plugins/markdownItKatex')).default as any
      if (typeof katexPlugin === 'function') md.use(katexPlugin)
      try { applyMdTaskListPlugin(md) } catch {}
    } catch (e) {
      console.warn('markdown-it-katex 加载失败：', e)
    }

    // 表格横向滚动支持：为所有表格添加包装器
    md.renderer.rules.table_open = () => '<div class="table-wrapper">\n<table>\n'
    md.renderer.rules.table_close = () => '</table>\n</div>\n'

    // 启用 Obsidian Callout 支持（>[!type] 语法）
    try {
      const calloutMod = await import('../plugins/markdownItCallout')
      const applyCallout = (calloutMod as any).default as ((m: any) => void) | undefined
      if (typeof applyCallout === 'function') applyCallout(md)
    } catch (e) {
      console.warn('markdown-it-callout 加载失败：', e)
    }
  return md
}

export async function preprocessMarkdownCore(raw: string): Promise<string> {
  raw = protectExcelDollarRefs(raw)
  try {
    const { normalizeCalloutMarkdown } = await import('../plugins/markdownItCallout')
    if (typeof normalizeCalloutMarkdown === 'function') {
      raw = normalizeCalloutMarkdown(raw)
    }
  } catch {}
  return guardStrongBoundaryForCommonMark(raw)
}

/**
 * 纯字符串渲染管线。顺序与原 renderPreview 2892-2905 完全一致：
 * protectExcelDollarRefs → normalizeCalloutMarkdown → guardStrongBoundaryForCommonMark
 * → md.render → stripStrongBoundaryGuard。ensureHljsCore 留在调用方（main.ts 在本函数
 * 之前 await，纯加载器无字符串交互，次序无行为影响）。
 */
export async function renderMarkdownCore(raw: string, md: MarkdownIt): Promise<string> {
  raw = await preprocessMarkdownCore(raw)
  return stripStrongBoundaryGuard(md.render(raw))
}
