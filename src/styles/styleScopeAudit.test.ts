// 样式作用域审计测试（所见/阅读模式样式统一任务 · T5）
//
// 目的：把「排版规则只写一份、两种模式共用」从口号变成硬约束。
// 本文件锁三件事：
//   1. styles/index.css 的 @import 顺序（决定层叠胜负，改动顺序等于改行为）；
//   2. 校验页 scripts/style-parity/parity.js 的 CSS 顺序与 index.css 一致
//      （否则校验页算出来的样式不代表真实应用）；
//   3. 排版属性不允许出现在「模式专属作用域」（.preview / .ProseMirror）里，
//      必须写在共享作用域 .md-content 上（阅读与所见两模式的内容根都挂了它）。
//
// 白名单里每一条都写明原因——新增规则若落在白名单之外，测试即失败，
// 逼着改动走「共享层 + 主题层」的路，而不是再抄一份到某个模式下。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stylesDir = here
const repoRoot = resolve(stylesDir, '../..')
const indexCssPath = join(stylesDir, 'index.css')
const parityJsPath = join(repoRoot, 'scripts/style-parity/parity.js')

/** 样式文件名 → 源码 */
const styleFiles: Record<string, string> = Object.fromEntries(
  readdirSync(stylesDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [f, readFileSync(join(stylesDir, f), 'utf8')]),
)

const INDEX_CSS = readFileSync(indexCssPath, 'utf8')
const PARITY_JS = readFileSync(parityJsPath, 'utf8')

/** 取出正则的第 1 个捕获组（避免 matchAll 在 strict 下的 unknown 推断）。 */
function captureAll(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re)).map((m) => m[1])
}

// ---------------------------------------------------------------- CSS 解析

type Rule = { selector: string; body: string; media: string | null }

/** 解析 CSS 为扁平的规则列表（展开 @media / @supports 等条件块）。 */
function parseRules(css: string, media: string | null = null): Rule[] {
  const out: Rule[] = []
  let i = 0
  const n = css.length
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i)
      i = end === -1 ? n : end + 2
      continue
    }
    if (i >= n) break
    if (css[i] === '@') {
      const braceIdx = css.indexOf('{', i)
      const semiIdx = css.indexOf(';', i)
      if (semiIdx !== -1 && (braceIdx === -1 || semiIdx < braceIdx)) {
        i = semiIdx + 1
        continue
      }
      if (braceIdx === -1) break
      const prelude = css.slice(i, braceIdx).trim()
      let depth = 1
      let j = braceIdx + 1
      while (j < n && depth > 0) {
        if (css[j] === '{') depth++
        else if (css[j] === '}') depth--
        j++
      }
      const inner = css.slice(braceIdx + 1, j - 1)
      if (/^@(media|supports|layer|container|scope)\b/i.test(prelude)) {
        out.push(...parseRules(inner, media ? `${media} && ${prelude}` : prelude))
      }
      i = j
      continue
    }
    const braceIdx = css.indexOf('{', i)
    if (braceIdx === -1) break
    const selector = css.slice(i, braceIdx).trim()
    let depth = 1
    let j = braceIdx + 1
    while (j < n && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    out.push({ selector: selector.replace(/\s+/g, ' ').trim(), body: css.slice(braceIdx + 1, j - 1), media })
    i = j
  }
  return out
}

/** 取规则体里的顶层声明属性名（忽略嵌套块与注释）。 */
function declaredProps(body: string): string[] {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutBlocks = withoutComments.replace(/\{[^}]*\}/g, '')
  const props: string[] = []
  for (const decl of withoutBlocks.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    if (prop) props.push(prop)
  }
  return props
}

// ------------------------------------------------------------ 审计用常量

/** 排版属性：这些属性决定「文字长什么样 / 排成什么样」。 */
const TYPOGRAPHY_PROPS = new Set([
  'font', 'font-size', 'font-weight', 'font-style', 'font-family', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent',
  'text-justify', 'text-transform', 'text-decoration', 'text-decoration-line',
  'text-decoration-color', 'color', 'list-style', 'list-style-type', 'list-style-position',
  'vertical-align', 'white-space', 'word-break', 'overflow-wrap',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'background', 'background-color', 'background-image', 'box-shadow',
])

/** 正文元素：这些元素的排版必须来自共享层。 */
const PROSE_ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'a', 'strong', 'em',
  'blockquote', 'hr', 'img', 'table', 'th', 'td', 'code', 'pre', 'del', 'sup', 'sub',
]

const PROSE_SELECTOR_RE = new RegExp(
  // 元素名后面不能紧跟类名/伪类（如 pre.code-block-wrapper、p:hover），
  // 否则控件选择器会被误判成正文排版规则。
  `(^|[\\s>+~,(:])(?:${PROSE_ELEMENTS.join('|')})(?![\\w.:-])`,
)

/** 模式专属作用域：只对一种模式生效的类。 */
function modeSpecificScope(selector: string): 'wysiwyg' | 'reading' | null {
  const hasContent = /\.md-content(?![\w-])/.test(selector)
  if (hasContent) return null // 共享作用域，两模式都命中
  // legacy V1 覆盖层（.container.wysiwyg）是与 V2 并存的旧实现，不在本次统一范围内
  if (/\.container\.wysiwyg(?![\w-])/.test(selector)) return null
  if (/\.ProseMirror(?![\w-])/.test(selector)) return 'wysiwyg'
  if (/\.preview-body(?![\w-])/.test(selector)) return 'reading'
  if (/\.preview(?![\w-])/.test(selector)) return 'reading'
  return null
}

/**
 * 白名单：允许出现在模式专属作用域里的规则。
 * key = `${文件名} :: ${选择器}`，value = 原因。
 * 新增条目必须写清为什么它不能放进共享层。
 */
const SCOPE_WHITELIST: Record<string, string> = {
  // —— 阅读模式专属：表格外框（JS 注入的 .table-wrapper 负责横向滚动与外框，
  //    所见模式的表格由 NodeView 管理，没有这层包装）——
  'preview.css :: .preview .table-wrapper': '阅读模式表格外框（横向滚动容器），所见模式无此层',
  'preview.css :: .preview .table-wrapper > table': '同上',
  'preview.css :: .preview .table-wrapper > table tr:first-child th:first-child': '外框圆角裁剪，落在首尾单元格',
  'preview.css :: .preview .table-wrapper > table tr:first-child th:last-child': '同上',
  'preview.css :: .preview .table-wrapper > table tr:last-child td:first-child': '同上',
  'preview.css :: .preview .table-wrapper > table tr:last-child td:last-child': '同上',

  // —— 阅读模式专属：任务列表（markdown-it 注入 input 复选框，所见模式用伪元素）——
  'preview.css :: .preview-body ul.task-list, .preview-body ol.task-list': '任务列表缩进（所见模式为伪元素勾选框）',
  'preview.css :: .preview-body li.task-list-item': '同上',
  'preview.css :: .preview-body input.task-list-item-checkbox': '同上',
  'preview.css :: .preview-body li.task-list-item:has(input.task-list-item-checkbox:checked)': '同上',

  // —— 阅读模式专属：代码块内部（行号列等装饰，所示模式没有这层）——
  'code-block-decoration.css :: .container:not(.wysiwyg) .preview pre *': '阅读模式代码块内层去除分隔线（行号列等）',

  // —— 所见模式专属：代码块外壳与双层可编辑结构 ——
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper': '代码块外壳的位置与语言选择器占位（结构差异）',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper *, .container.wysiwyg-v2 .ProseMirror pre code, .container.wysiwyg-v2 .ProseMirror pre .code-layers, .container.wysiwyg-v2 .ProseMirror pre .highlight-layer, .container.wysiwyg-v2 .ProseMirror pre .editable-layer': '块内层级去除边框与阴影（含共享的 pre code）',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper code, .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .highlight-layer, .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .editable-layer': '块内 code / 两层保持透明底',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper code': '块内 code 复位行内代码的框',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .code-layers': '双层对齐容器',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .highlight-layer': '高亮层只读显示',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .editable-layer': '编辑层透明（靠光标定位）',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper .code-scroll-box': '限高滚动容器',
  'code-rendering.css :: .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper.code-expanded .code-scroll-box': '展开态取消限高',
  'code-rendering.css :: body.dark-mode .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper code': '暗色下块内 code 保持透明底',
  'code-rendering.css :: body:not(.light-mode) .container.wysiwyg-v2 .ProseMirror pre.code-block-wrapper code': '同上（系统暗色）',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror pre': '所见模式代码块外壳（滚动容器不挂在 pre 上）',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror pre code': '块内 code 复位行内代码的框',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror table': '所见模式表格外框（无 .table-wrapper 包装层）',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror li > p, .container.wysiwyg-v2 .ProseMirror td > p, .container.wysiwyg-v2 .ProseMirror th > p': 'ProseMirror 块级化产生的段落外边距归零（只对所见模式）',

  // —— 所见模式专属：交互与编辑行为（光标、选区、节点视图）——
  'editor.css :: .container.wysiwyg-v2 .ProseMirror': '所见模式编辑容器（盒模型与编辑行为）',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror img, .container.wysiwyg-v2 .ProseMirror video': '所见模式媒体尺寸约束',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror:focus': '编辑区聚焦轮廓',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror p, .container.wysiwyg-v2 .ProseMirror li': '所见模式用 pre-line 保留单换行渲染',
  'editor.css :: .container.wysiwyg-v2 .ProseMirror blockquote p': '同上',

  // —— 所见模式专属：主题的表格外框（所见模式没有 .table-wrapper，外框直接落在 table 上）——
  'theme-panel.css :: .container.md-notion.wysiwyg-v2 .ProseMirror table': '所见模式表格外框',
  'theme-panel.css :: .container.md-card.wysiwyg-v2 .ProseMirror table': '同上',
  'theme-panel.css :: body:not(.light-mode) .container.wysiwyg-v2 .ProseMirror table': '同上（暗色）',

  // —— 打印/导出链路：复用 .preview 作用域（导出克隆体也带 md-content）——
  'print.css :: .preview pre': '打印专用：代码块去背景去边框',
  'print.css :: .preview a[href]:after': '打印专用：链接后附 URL',
}

// -------------------------------------------------------------- 测试用例

describe('样式分层与作用域审计', () => {
  it('index.css 的 @import 顺序被钉死（层叠胜负由顺序决定）', () => {
    const imports = captureAll(INDEX_CSS, /@import\s+["']([^"']+)["']/g)
    expect(imports.length).toBeGreaterThan(0)

    // 共享排版层必须排在模式层与主题层之前：主题层要能覆盖共享层，
    // 模式层要能覆盖主题层里的同等特异性规则。
    const idx = (name: string) => imports.findIndex((p) => p.includes(name))
    expect(idx('markdown-content.css')).toBeGreaterThan(-1)
    expect(idx('markdown-content.css')).toBeLessThan(idx('editor.css'))
    expect(idx('markdown-content.css')).toBeLessThan(idx('preview.css'))
    expect(idx('markdown-content.css')).toBeLessThan(idx('code-rendering.css'))
    expect(idx('markdown-content.css')).toBeLessThan(idx('theme-panel.css'))
    // 主题层要排在暗色层之前：主题的暗色覆盖依赖同一层内的先后
    expect(idx('theme-panel.css')).toBeLessThan(idx('dark-mode.css'))
  })

  it('校验页的 CSS 拼接顺序与 index.css 一致', () => {
    const fromIndex = captureAll(INDEX_CSS, /@import\s+["']([^"']+)["']/g).map((p) => p.replace(/^\.\//, ''))
    const fromHarness = captureAll(PARITY_JS, /from\s+'\/src\/styles\/([^'?]+)\?raw'/g)
    expect(fromHarness.length).toBeGreaterThan(0)
    expect(fromHarness).toEqual(fromIndex)
  })

  it('排版属性不落在模式专属作用域（.preview / .ProseMirror）里', () => {
    const violations: string[] = []
    for (const [file, source] of Object.entries(styleFiles)) {
      const rules = parseRules(source)
      for (const rule of rules) {
        const scope = modeSpecificScope(rule.selector)
        if (!scope) continue
        if (!PROSE_SELECTOR_RE.test(rule.selector)) continue
        const props = declaredProps(rule.body).filter((p) => TYPOGRAPHY_PROPS.has(p))
        if (props.length === 0) continue
        const key = `${file} :: ${rule.selector}`
        if (SCOPE_WHITELIST[key]) continue
        violations.push(
          `${key}  →  ${[...new Set(props)].join(', ')}` +
          (rule.media ? `  [@media ${rule.media}]` : ''),
        )
      }
    }
    expect(
      violations,
      '发现落在模式专属作用域的排版规则，请改到 .md-content 共享作用域（或在 SCOPE_WHITELIST 里写明理由）：\n' +
      violations.join('\n'),
    ).toEqual([])
  })

  it('白名单条目都真实存在（避免白名单腐化）', () => {
    const present = new Set<string>()
    for (const [file, source] of Object.entries(styleFiles)) {
      for (const rule of parseRules(source)) {
        present.add(`${file} :: ${rule.selector}`)
      }
    }
    const stale = Object.keys(SCOPE_WHITELIST).filter((key) => !present.has(key))
    expect(stale, `白名单里的规则已不存在，请清理：\n${stale.join('\n')}`).toEqual([])
  })
})
