/*
 * flymd 样式校验页（dev-only）
 *
 * 目的：把「所见模式与阅读模式排版一致」这条不变量变成可执行的检查。
 *  - parity：同一份 fixture 在阅读模式（markdown-it 输出形状）与所见模式
 *    （ProseMirror 输出形状）各渲染一份，逐元素比对 getComputedStyle。
 *  - baseline：阅读模式的计算样式摘要与 baseline.json 比对，证明
 *    「阅读模式观感未被本次重构改动」——parity 不等于 preservation。
 *
 * 用法：
 *   1. pnpm dev
 *   2. 打开 http://127.0.0.1:5173/scripts/style-parity/index.html
 *   3. 页面底部输出报告；window.__parityResult 提供结构化结果
 *
 * 说明：CSS 通过 ?raw 导入并手工拼接，顺序与 src/styles/index.css 一致；
 * 这样才能在页面内改写 @media (prefers-color-scheme: dark) 以模拟暗色，
 * 并让暗色/亮色两套都能在同一浏览器里跑完矩阵。
 */

import baseCss from '/src/styles/base.css?raw'
import markdownContentCss from '/src/styles/markdown-content.css?raw'
import focusModeCss from '/src/styles/focus-mode.css?raw'
import printCss from '/src/styles/print.css?raw'
import stickyNoteCss from '/src/styles/sticky-note.css?raw'
import updateOverlayCss from '/src/styles/update-overlay.css?raw'
import findReplaceCss from '/src/styles/find-replace.css?raw'
import contextMenuCss from '/src/styles/context-menu.css?raw'
import tabbarCss from '/src/styles/tabbar.css?raw'
import calloutCopyIconCss from '/src/styles/callout-copy-icon.css?raw'
import libTreeConnectorCss from '/src/styles/lib-tree-connector.css?raw'
import codeBlockDecorationCss from '/src/styles/code-block-decoration.css?raw'
import uiEnhanceCss from '/src/styles/ui-enhance.css?raw'
import scrollbarCss from '/src/styles/scrollbar.css?raw'
import windowCss from '/src/styles/window.css?raw'
import libraryCss from '/src/styles/library.css?raw'
import notificationsCss from '/src/styles/notifications.css?raw'
import editorCss from '/src/styles/editor.css?raw'
import previewCss from '/src/styles/preview.css?raw'
import codeRenderingCss from '/src/styles/code-rendering.css?raw'
import themePanelCss from '/src/styles/theme-panel.css?raw'
import dialogCss from '/src/styles/dialog.css?raw'
import extensionsCss from '/src/styles/extensions.css?raw'
import darkModeCss from '/src/styles/dark-mode.css?raw'

// 与 src/styles/index.css 的引入顺序严格一致。
// src/styles/styleParityOrder.test.ts 会断言两者不漂移。
const CSS_SOURCES = [
  baseCss,
  markdownContentCss,
  focusModeCss,
  printCss,
  stickyNoteCss,
  updateOverlayCss,
  findReplaceCss,
  contextMenuCss,
  tabbarCss,
  calloutCopyIconCss,
  libTreeConnectorCss,
  codeBlockDecorationCss,
  uiEnhanceCss,
  scrollbarCss,
  windowCss,
  libraryCss,
  notificationsCss,
  editorCss,
  previewCss,
  codeRenderingCss,
  themePanelCss,
  dialogCss,
  extensionsCss,
  darkModeCss,
]

// 比对属性：排版 + 盒模型 + 颜色。刻意不含 width/height/top/left 等布局几何，
// 因为两模式 DOM 结构不同（li>p、表格 wrapper 等）几何必然有差。
// margin-left / margin-right 也排除：auto 外边距的解析值依赖容器宽度，
// 会让基线指纹随窗口尺寸漂移，失去回归检测意义。
const PROPS = [
  'font-size', 'font-weight', 'font-style', 'font-family', 'line-height',
  'letter-spacing', 'text-align', 'text-indent', 'text-justify', 'text-decoration-line',
  'color', 'background-color',
  'margin-top', 'margin-bottom',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width',
  'border-top-style', 'border-bottom-style', 'border-top-color', 'border-bottom-color',
  'border-radius', 'list-style-type', 'vertical-align', 'white-space',
]

// 参与比对的元素（两模式都能找到同名元素）。
// pre / pre code 也在内：代码块外壳与代码正文基线属于「外观」，必须可比；
// 结构差异（双层可编辑、语言选择器）造成的差异走白名单。
const ELEMENTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'li > p',
  'a', 'strong', 'em', 'code',
  'blockquote', 'blockquote > p',
  'hr', 'img',
  'table', 'th', 'td', 'td > p',
  'pre', 'pre code',
]

// 结构差异导致的必然不同：记录原因，作为「已知差异」白名单。
// 这些项不计入 parity 失败，但会出现在报告里。
const KNOWN_DIFFS = {
  'table|border-top-width': '阅读模式表格包在 .table-wrapper 内，边框落在 wrapper 上；所见模式直接落在 table',
  'table|border-top-style': '同上',
  'table|border-top-color': '同上',
  'table|border-bottom-width': '同上',
  'table|border-bottom-style': '同上',
  'table|border-bottom-color': '同上',
  'table|border-left-width': '同上',
  'table|border-right-width': '同上',
  'table|border-radius': '同上',
  'table|margin-top': '同上',
  'table|margin-bottom': '同上',
  'table|background-color': '同上',
  'th|border-radius': '阅读模式首尾单元格圆角落在 wrapper 的圆角裁剪上；所见模式直描边',
  'td|border-radius': '同上',
  // 代码块外壳：所见模式的 pre 内含绝对定位的语言选择器，需要预留顶部条带；
  // 阅读模式没有这个控件，pre 顶部就是内容。两模式的顶部内距因此必然不同。
  'pre|padding-top': '所见模式代码块顶部要留给块内语言选择器（结构差异），阅读模式没有',
}

// white-space 是所见模式的刻意差异（pre-line 保留单换行渲染），全元素豁免。
const GLOBAL_KNOWN_PROPS = {
  'white-space': '所见模式用 pre-line 保留单换行渲染，阅读模式用 normal',
}

// 计算值等价归一：start/end 在 LTR 下与 left/right 等价，但 getComputedStyle
// 返回的是指定值，不归一会把「阅读模式 td 的 start 变成 left」误报成观感变化。
const VALUE_ALIASES = {
  start: 'left',
  end: 'right',
}

function normalizeValue(prop, value) {
  if (!value) return value
  if (VALUE_ALIASES[value]) return VALUE_ALIASES[value]
  return value
}

const THEMES = [
  '', 'md-github', 'md-notion', 'md-journal', 'md-docs',
  'md-card', 'md-typora', 'md-obsidian', 'md-bear', 'md-minimalist',
]

const IMAGE_DATA_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

// 阅读模式 fixture：严格对齐 markdown-it + 本项目插件的输出形状。
// 任务列表 → ul.task-list / li.task-list-item / input.task-list-item-checkbox
// 表格 → div.table-wrapper > table
const READING_FIXTURE = `
<h1>一级标题</h1>
<p>正文段落，包含 <strong>粗体</strong>、<em>斜体</em>、<a href="#anchor">链接</a> 与 <code>行内代码</code>。</p>
<h2>二级标题</h2>
<p>第二段。</p>
<h3>三级标题</h3>
<h4>四级标题</h4>
<h5>五级标题</h5>
<h6>六级标题</h6>
<ul>
<li>无序项一</li>
<li>无序项二</li>
</ul>
<ol>
<li>有序项一</li>
</ol>
<ul class="task-list">
<li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" checked>已完成任务</li>
<li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox">未完成任务</li>
</ul>
<blockquote>
<p>引用段落。</p>
</blockquote>
<hr>
<div class="table-wrapper">
<table>
<thead><tr><th>列 A</th><th>列 B</th></tr></thead>
<tbody><tr><td>值 A</td><td>值 B</td></tr><tr><td>值 C</td><td>值 D</td></tr></tbody>
</table>
</div>
<pre><code class="language-js hljs">const a = 1</code></pre>
<img src="${IMAGE_DATA_URI}" alt="示意图">
`

// 所见模式 fixture：严格对齐 ProseMirror / Milkdown 的输出形状。
// 列表项内容恒为块级 <p>；任务项 → li[data-item-type=task][data-checked]
// 代码块 → pre.code-block-wrapper（本次不参与比对）
const WYSIWYG_FIXTURE = `
<h1>一级标题</h1>
<p>正文段落，包含 <strong>粗体</strong>、<em>斜体</em>、<a href="#anchor">链接</a> 与 <code>行内代码</code>。</p>
<h2>二级标题</h2>
<p>第二段。</p>
<h3>三级标题</h3>
<h4>四级标题</h4>
<h5>五级标题</h5>
<h6>六级标题</h6>
<ul>
<li><p>无序项一</p></li>
<li><p>无序项二</p></li>
</ul>
<ol>
<li><p>有序项一</p></li>
</ol>
<ul>
<li data-item-type="task" data-checked="true"><p>已完成任务</p></li>
<li data-item-type="task" data-checked="false"><p>未完成任务</p></li>
</ul>
<blockquote>
<p>引用段落。</p>
</blockquote>
<hr>
<table>
<thead><tr><th>列 A</th><th>列 B</th></tr></thead>
<tbody><tr><td><p>值 A</p></td><td><p>值 B</p></td></tr><tr><td><p>值 C</p></td><td><p>值 D</p></td></tr></tbody>
</table>
<pre class="code-block-wrapper" data-language="js"><div class="code-scroll-box"><div class="code-layers"><code class="hljs highlight-layer">const a = 1</code><code class="editable-layer">const a = 1</code></div></div><div class="code-lang-selector"><input class="code-lang-input" type="text" placeholder="选择语言..." value="js"><div class="code-lang-dropdown"></div></div></pre>
<img src="${IMAGE_DATA_URI}" alt="示意图">
`

function buildCss(dark) {
  const raw = CSS_SOURCES.join('\n')
  if (!dark) return raw
  // 模拟暗色：把系统暗色偏好媒体查询放开，同时由 body.dark-mode 驱动类选择器规则。
  return raw.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, '@media all')
}

function styleEl(css) {
  const el = document.createElement('style')
  el.textContent = css
  document.head.appendChild(el)
  return el
}

function makeContainer(theme, wysiwyg) {
  const container = document.createElement('div')
  container.className = 'container' + (theme ? ' ' + theme : '') + (wysiwyg ? ' wysiwyg-v2' : '')
  const panel = document.createElement('div')
  panel.className = 'panel'
  container.appendChild(panel)
  document.body.appendChild(container)
  return container
}

function fillReading(container) {
  const preview = document.createElement('div')
  preview.className = 'preview'
  const body = document.createElement('div')
  body.className = 'preview-body md-content'
  body.innerHTML = READING_FIXTURE
  preview.appendChild(body)
  container.querySelector('.panel').appendChild(preview)
}

function fillWysiwyg(container) {
  const root = document.createElement('div')
  root.id = 'md-wysiwyg-root'
  const pm = document.createElement('div')
  pm.className = 'ProseMirror md-content'
  pm.innerHTML = WYSIWYG_FIXTURE
  root.appendChild(pm)
  container.querySelector('.panel').appendChild(root)
}

function pick(root, selector) {
  const list = Array.from(root.querySelectorAll(selector))
  return list.length ? list[0] : null
}

function readStyles(root) {
  const out = {}
  for (const selector of ELEMENTS) {
    const el = pick(root, selector)
    // null = 该模式下不存在这个元素（结构性差异），不参与逐属性比对
    if (!el) { out[selector] = null; continue }
    const cs = getComputedStyle(el)
    const bag = {}
    for (const p of PROPS) bag[p] = normalizeValue(p, cs.getPropertyValue(p))
    out[selector] = bag
  }
  return out
}

function diff(reading, wysiwyg) {
  const diffs = []
  const structural = []
  for (const selector of ELEMENTS) {
    const a = reading[selector]
    const b = wysiwyg[selector]
    // 一侧不存在该元素 → 结构性差异（DOM 形状不同），不算样式漂移
    if (!a || !b) {
      if (a !== b) structural.push(selector + (a ? ' (仅阅读模式存在)' : ' (仅所见模式存在)'))
      continue
    }
    for (const p of PROPS) {
      const av = a[p] === undefined ? '' : a[p]
      const bv = b[p] === undefined ? '' : b[p]
      if (av === bv) continue
      const key = selector + '|' + p
      const known = KNOWN_DIFFS[key] !== undefined
        ? KNOWN_DIFFS[key]
        : (GLOBAL_KNOWN_PROPS[p] !== undefined ? GLOBAL_KNOWN_PROPS[p] : null)
      diffs.push({ key, reading: av, wysiwyg: bv, known: known })
    }
  }
  diffs.structural = structural
  return diffs
}

function stableStringify(value) {
  return JSON.stringify(value, function (_k, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce(function (acc, k) {
        acc[k] = v[k]
        return acc
      }, {})
    }
    return v
  })
}

// 简单 FNV-1a 32bit，用于主题×暗色矩阵的快速比对指纹
function fnv1a(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
}

/* ========== 规则溯源（?debug=<选择器>） ==========
   列出命中该元素的全部 CSS 规则（按文档顺序），标注特异性、媒体条件与声明，
   用来回答「这条属性到底被哪条规则赢走了」。 */

// 近似特异性计算：a=id, b=类/属性/伪类, c=元素/伪元素；:not() 按参数展开。
function specificity(sel) {
  let a = 0, b = 0, c = 0
  const notArgs = []
  const s = sel.replace(/:not\(([^()]*)\)/g, function (_, inner) { notArgs.push(inner); return ' ' })
  a += (s.match(/#[A-Za-z0-9_-]+/g) || []).length
  b += (s.match(/\.[A-Za-z0-9_-]+/g) || []).length
  b += (s.match(/\[[^\]]*\]/g) || []).length
  b += (s.match(/:(?!:)[A-Za-z-]+/g) || []).length
  c += (s.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length
  c += (s.match(/::[A-Za-z-]+/g) || []).length
  for (const arg of notArgs) {
    const sp = specificity(arg)
    a += sp[0]; b += sp[1]; c += sp[2]
  }
  return a + ',' + b + ',' + c
}

function collectRules(el, props) {
  const out = []
  let order = 0
  function walk(rules, media) {
    for (const rule of rules) {
      order++
      if (rule.type === 1) {
        const sel = rule.selectorText || ''
        let matched = false
        for (const part of sel.split(',')) {
          const t = part.trim()
          if (!t) continue
          try { if (el.matches(t)) { matched = true; break } } catch (e) { /* 非法选择器跳过 */ }
        }
        if (!matched) continue
        const decls = []
        if (!props || !props.length) {
          // 全量模式：列出规则的全部声明
          for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i]
            decls.push(p + ': ' + rule.style.getPropertyValue(p) + (rule.style.getPropertyPriority(p) === 'important' ? ' !important' : ''))
          }
        } else {
          for (const p of props) {
            const v = rule.style.getPropertyValue(p)
            if (!v) continue
            const imp = rule.style.getPropertyPriority(p) === 'important' ? ' !important' : ''
            decls.push(p + ': ' + v + imp)
          }
        }
        if (!decls.length) continue
        out.push({ order: order, sel: sel, spec: specificity(sel), media: media, decls: decls })
      } else if (rule.type === 4) {
        // MEDIA_RULE
        let ok = false
        try { ok = window.matchMedia(rule.conditionText).matches } catch (e) { ok = false }
        if (ok) walk(rule.cssRules, media ? media + ' && ' + rule.conditionText : rule.conditionText)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch (e) { continue }
    walk(rules, null)
  }
  return out
}

function dumpRules(el, props, label) {
  const lines = []
  const cs = getComputedStyle(el)
  lines.push('  [' + label + '] computed: ' + props.map(function (p) {
    return p + '=' + cs.getPropertyValue(p)
  }).join(' | '))
  const rules = collectRules(el, props)
  lines.push('  [' + label + '] 命中规则 ' + rules.length + ' 条（文档顺序，越靠后优先级越高）：')
  for (const r of rules) {
    lines.push('    #' + r.order + ' (' + r.spec + ') ' + r.sel + (r.media ? '   @media ' + r.media : '') + '  →  ' + r.decls.join('; '))
  }
  return lines
}

async function loadBaseline() {
  try {
    const res = await fetch('./baseline.json', { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

async function main() {
  const stage = document.getElementById('stage')
  const report = document.getElementById('report')
  const params = new URLSearchParams(location.search)
  const detailTheme = params.get('theme') || ''
  const detailDark = params.get('dark') === '1'
  const debugEl = params.get('debug') || ''

  const baselineOut = document.getElementById('baseline')

  // ?visual=1：把两种模式的渲染结果铺出来，供截图核对观感
  if (params.get('visual') === '1') {
    document.body.classList.add('visual')
    if (params.get('only') === 'table') document.body.classList.add('only-table')
  }

  const lightSheet = styleEl(buildCss(false))
  const darkSheet = styleEl(buildCss(true))

  const readingContainer = makeContainer('', false)
  const wysiwygContainer = makeContainer('', true)
  fillReading(readingContainer)
  fillWysiwyg(wysiwygContainer)

  if (detailTheme) {
    // 单主题明细模式：用于定位某个主题下的具体差异
    const theme = detailTheme === '(default)' ? '' : detailTheme
    readingContainer.className = 'container' + (theme ? ' ' + theme : '')
    wysiwygContainer.className = 'container' + (theme ? ' ' + theme : '') + ' wysiwyg-v2'
    document.body.classList.toggle('dark-mode', detailDark)
    document.body.classList.toggle('light-mode', !detailDark)
    lightSheet.disabled = detailDark
    darkSheet.disabled = !detailDark
    void readingContainer.offsetHeight
    void wysiwygContainer.offsetHeight
    const only = params.get('el')
    const readAll = readStyles(readingContainer.querySelector('.preview-body'))
    const writeAll = readStyles(wysiwygContainer.querySelector('.ProseMirror'))
    const pick = function (bag) {
      if (!only) return bag
      const out = {}
      out[only] = bag[only]
      return out
    }
    baselineOut.textContent = JSON.stringify({
      theme: detailTheme,
      dark: detailDark,
      reading: pick(readAll),
      wysiwyg: pick(writeAll),
    }, null, 2)
    const head = '单主题明细模式：' + detailTheme + (detailDark ? ' [dark]' : ' [light]') + (only ? ' el=' + only : '')
    if (debugEl) {
      // 规则溯源：把「这条属性被谁赢走了」摊开
      const lines = [head, '']
      const rEl = readingContainer.querySelector('.preview-body').querySelector(debugEl)
      const wEl = wysiwygContainer.querySelector('.ProseMirror').querySelector(debugEl)
      const rBag = readAll[debugEl] || {}
      const wBag = writeAll[debugEl] || {}
      const differ = PROPS.filter(function (p) {
        return (rBag[p] || '') !== (wBag[p] || '')
      })
      lines.push('差异属性（' + differ.length + '）：' + (differ.join(', ') || '无'))
      lines.push('')
      if (rEl) lines.push.apply(lines, dumpRules(rEl, [], 'reading'))
      else lines.push('  [reading] 元素不存在')
      lines.push('')
      if (wEl) lines.push.apply(lines, dumpRules(wEl, [], 'wysiwyg'))
      else lines.push('  [wysiwyg] 元素不存在')
      report.textContent = lines.join('\n')
    } else {
      report.textContent = head
    }
    stage.setAttribute('data-done', '1')
    return
  }

  const parity = []
  const readingDigest = {}
  const readingDetail = {}
  let unknownDiffs = 0
  let knownDiffs = 0
  const structuralSet = {}

  for (const theme of THEMES) {
    const key = theme || '(default)'
    readingDigest[key] = { light: '', dark: '' }
    for (const dark of [false, true]) {
      readingContainer.className = 'container' + (theme ? ' ' + theme : '')
      wysiwygContainer.className = 'container' + (theme ? ' ' + theme : '') + ' wysiwyg-v2'
      document.body.classList.toggle('dark-mode', dark)
      document.body.classList.toggle('light-mode', !dark)
      // 暗色版把 prefers-color-scheme 媒体查询放开成 @media all，
      // 因此浅色表必须整表停用，否则两套规则叠加。
      lightSheet.disabled = dark
      darkSheet.disabled = !dark

      // 强制重排
      void readingContainer.offsetHeight
      void wysiwygContainer.offsetHeight

      const readingStyles = readStyles(readingContainer.querySelector('.preview-body'))
      const wysiwygStyles = readStyles(wysiwygContainer.querySelector('.ProseMirror'))
      const diffs = diff(readingStyles, wysiwygStyles)
      const unknown = diffs.filter(function (d) { return !d.known })
      const known = diffs.filter(function (d) { return !!d.known })
      unknownDiffs += unknown.length
      knownDiffs += known.length
      for (const s of diffs.structural) structuralSet[s] = true

      parity.push({
        theme: key,
        dark: dark,
        unknownCount: unknown.length,
        knownCount: known.length,
        structural: diffs.structural,
        unknown: unknown.map(function (d) { return { key: d.key, reading: d.reading, wysiwyg: d.wysiwyg } }),
      })

      const dump = stableStringify(readingStyles)
      void dump
      // 基线粒度＝「元素」：整页哈希只能告诉��主题变了，逐元素哈希能告诉「哪个元素变了」，
      // 再用 ?theme=X&el=Y 钻取到具体属性。
      const elementDigest = {}
      for (const el of Object.keys(readingStyles)) {
        const bag = readingStyles[el]
        elementDigest[el] = bag === null ? 'null' : fnv1a(stableStringify(bag))
      }
      readingDigest[key][dark ? 'dark' : 'light'] = elementDigest
      if (!theme) {
        if (!readingDetail[key]) readingDetail[key] = {}
        readingDetail[key][dark ? 'dark' : 'light'] = readingStyles
      }
    }
  }

  const baseline = await loadBaseline()
  let baselineStatus = 'no-baseline'
  const baselineDiffs = []
  if (baseline && baseline.themes) {
    for (const key of Object.keys(readingDigest)) {
      const base = baseline.themes[key]
      if (!base) { baselineDiffs.push({ theme: key, mode: '-', element: '(主题缺失)' }); continue }
      for (const mode of ['light', 'dark']) {
        const b = base[mode]
        const cur = readingDigest[key][mode]
        if (typeof b === 'string') {
          // 旧版基线：整页哈希
          if (b !== fnv1a(stableStringify(cur))) baselineDiffs.push({ theme: key, mode: mode, element: '(整页)' })
          continue
        }
        for (const el of Object.keys(cur)) {
          if (!b || b[el] !== cur[el]) baselineDiffs.push({ theme: key, mode: mode, element: el })
        }
      }
    }
    baselineStatus = baselineDiffs.length === 0 ? 'unchanged' : 'CHANGED'
  }

  const result = {
    parityOk: unknownDiffs === 0,
    unknownDiffs: unknownDiffs,
    knownDiffs: knownDiffs,
    structural: Object.keys(structuralSet),
    baselineStatus: baselineStatus,
    baselineDiffs: baselineDiffs,
    parity: parity,
    readingDigest: readingDigest,
  }
  window.__parityResult = result

  const lines = []
  lines.push('parity: ' + (result.parityOk ? 'PASS' : 'FAIL') + '  未知差异=' + unknownDiffs + '  已知差异=' + knownDiffs)
  lines.push('reading baseline: ' + baselineStatus)
  for (const d of baselineDiffs) lines.push('  baseline diff: ' + d.theme + ' [' + d.mode + '] ' + d.element)
  if (result.structural.length) {
    lines.push('')
    lines.push('结构性差异（DOM 形状不同，不计入 parity）：')
    for (const s of result.structural) lines.push('  - ' + s)
  }
  lines.push('')
  for (const r of parity) {
    lines.push('[' + r.theme + '][' + (r.dark ? 'dark' : 'light') + '] unknown=' + r.unknownCount + ' known=' + r.knownCount)
    for (const u of r.unknown) lines.push('   X ' + u.key + ': reading=' + u.reading + ' | wysiwyg=' + u.wysiwyg)
  }
  report.textContent = lines.join('\n')

  // 基线文件只存指纹（体积小、可机器比对）；具体明细用 ?theme= 参数按需取。
  // version 2：粒度细化到「元素」，变更时能直接指出是哪个元素变了。
  const digestPayload = { version: 2, themes: readingDigest }
  baselineOut.textContent = JSON.stringify(digestPayload, null, 2)

  if (params.get('capture') === '1') {
    // 把基线 POST 给本地捕获服务落盘（避免人工转录大段 JSON）
    const file = params.get('file') || 'baseline.json'
    try {
      const res = await fetch('http://127.0.0.1:5180/baseline?file=' + encodeURIComponent(file), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(digestPayload),
      })
      const text = await res.text()
      report.textContent = 'capture: ' + (res.ok ? 'OK' : 'FAIL') + ' — ' + text + '\n' + report.textContent
    } catch (err) {
      report.textContent = 'capture: ERROR — ' + String(err) + '\n' + report.textContent
    }
  }
  stage.setAttribute('data-done', '1')
}

main().catch(function (err) {
  const report = document.getElementById('report')
  report.textContent = 'ERROR: ' + (err && err.stack ? err.stack : String(err))
  window.__parityResult = { error: String(err) }
  document.getElementById('stage').setAttribute('data-done', '1')
})
