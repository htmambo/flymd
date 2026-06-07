// markdown-it Callout 插件：支持 Obsidian 风格的 Callout 语法
// 语法：> [!type]+- 标题
// 类型支持 Obsidian 所有内置类型及别名

import type MarkdownIt from 'markdown-it'

// Obsidian Callout 类型映射（主类型 -> 图标）
const CALLOUT_ICONS: Record<string, string> = {
  note: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  abstract: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  todo: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  tip: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  success: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  question: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  warning: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  failure: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  danger: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  bug: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="14" x="8" y="6" rx="4"/><path d="m12 20 1.5 3"/><path d="m12 20-1.5 3"/><path d="m15 13 3.5 2.5"/><path d="m9 13-3.5 2.5"/><path d="m15 9 3.5-2.5"/><path d="m9 9-3.5-2.5"/></svg>',
  example: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  quote: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>',
}

const TYPE_ALIASES: Record<string, string> = {
  summary: 'abstract', tldr: 'abstract',
  hint: 'tip', important: 'tip',
  check: 'success', done: 'success',
  help: 'question', faq: 'question',
  caution: 'warning', attention: 'warning',
  fail: 'failure', missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

function normalizeType(type: string): string {
  return TYPE_ALIASES[type.toLowerCase().trim()] || type.toLowerCase().trim()
}

function getIcon(type: string): string {
  return CALLOUT_ICONS[normalizeType(type)] || CALLOUT_ICONS.note
}

const CALLOUT_REGEX = /^\[!(.+?)\]([+-]?)\s*([^\n]*)/

function getFoldIcon(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}

// 预处理 Markdown：把 callout 内部被完全空行分断的 blockquote 重新连起来
// Obsidian 允许 callout 内出现无 > 前缀的空行，但标准 CommonMark 会因此分断 blockquote。
export function normalizeCalloutMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let inCallout = false
  let calloutIndent = ''
  let inFence = false
  let fenceChar = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 跟踪 fenced code block（全局）：匹配 ``` 或 ~~~，可选前面带 >
    const fenceMatch = line.match(/^(\s*)(?:>\s*)?(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceChar = fenceMatch[2][0]
      } else if (fenceMatch[2][0] === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      out.push(line)
      continue
    }

    if (inFence) {
      out.push(line)
      continue
    }

    // 检测 callout 开始行：> [!type]...
    const calloutMatch = line.match(/^(\s*)>(\s*)\[!(.+?)\]([+-]?)\s*(.*)/)
    if (calloutMatch) {
      inCallout = true
      calloutIndent = calloutMatch[1]
      out.push(line)
      continue
    }

    if (inCallout) {
      // 空行或纯空白行
      if (/^\s*$/.test(line)) {
        // 向前看：如果后续非空行仍以 > 开头，说明空行仍在 callout 内
        // 但如果下一行是另一个 callout 的开始（>[!...]），则当前 callout 结束
        let j = i + 1
        let stillInCallout = false
        while (j < lines.length) {
          if (/^\s*$/.test(lines[j])) {
            j++
            continue
          }
          if (/^\s*>\s*\[!(.+?)\]/.test(lines[j])) {
            stillInCallout = false
          } else if (/^\s*>/.test(lines[j])) {
            stillInCallout = true
          }
          break
        }
        if (stillInCallout) {
          out.push(calloutIndent + '>')
          continue
        } else {
          inCallout = false
          out.push(line)
          continue
        }
      }

      // 以 > 开头的行，继续 callout
      if (/^\s*>/.test(line)) {
        out.push(line)
        continue
      }

      // 其他行结束 callout
      inCallout = false
      out.push(line)
      continue
    }

    out.push(line)
  }

  return out.join('\n')
}

// 工具：在 token 数组中查找与指定 open 匹配的 close 索引
function findMatchingClose(tokens: any[], openIdx: number): number {
  let depth = 1
  for (let j = openIdx + 1; j < tokens.length; j++) {
    if (tokens[j].type === 'blockquote_open') depth++
    else if (tokens[j].type === 'blockquote_close') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

// 工具：在 open/close 之间查找第一个 inline token
function findFirstInline(tokens: any[], openIdx: number, closeIdx: number): number {
  for (let j = openIdx + 1; j < closeIdx; j++) {
    if (tokens[j].type === 'inline') return j
  }
  return -1
}

// 工具：隐藏从 paragraph_open 开始到 paragraph_close 结束的所有 token
function hideEmptyParagraph(tokens: any[], startIdx: number, limitIdx: number): void {
  for (let j = startIdx; j < limitIdx; j++) {
    if (tokens[j].type === 'paragraph_open') {
      tokens[j].hidden = true
      for (let k = j + 1; k < limitIdx; k++) {
        if (tokens[k].type === 'paragraph_close') {
          tokens[k].hidden = true
          return
        }
        tokens[k].hidden = true
      }
      return
    }
  }
}

export default function applyMarkdownItCallout(md: MarkdownIt): void {
  const originalBlockquoteOpen = md.renderer.rules.blockquote_open || function (tokens: any, idx: any, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options)
  }
  const originalBlockquoteClose = md.renderer.rules.blockquote_close || function (tokens: any, idx: any, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.blockquote_open = function (tokens: any, idx: any, options: any, env: any, self: any) {
    const token = tokens[idx]
    // 如果已经处理过（比如内层嵌套被提前处理），直接渲染
    if (token._calloutHandled) {
      return renderCalloutOpen(token, md)
    }

    const closeIdx = findMatchingClose(tokens, idx)
    if (closeIdx < 0) return originalBlockquoteOpen(tokens, idx, options, env, self)

    const firstInlineIdx = findFirstInline(tokens, idx, closeIdx)
    if (firstInlineIdx < 0) return originalBlockquoteOpen(tokens, idx, options, env, self)

    const inlineToken = tokens[firstInlineIdx]
    const content = inlineToken.content
    const match = content.match(CALLOUT_REGEX)
    if (!match) return originalBlockquoteOpen(tokens, idx, options, env, self)

    // ---- 识别为 callout，开始处理 ----
    const rawType = match[1]
    const foldMarker = match[2]
    const title = match[3] || ''
    const normalizedType = normalizeType(rawType)
    const foldable = !!foldMarker
    const folded = foldMarker === '-'

    // 在 open token 上记录 callout 信息，供 close 使用
    token._calloutHandled = true
    token._calloutType = normalizedType
    token._calloutTitle = title
    token._calloutFoldable = foldable
    token._calloutFolded = folded

    // 同时给 close token 打标记
    tokens[closeIdx]._calloutHandled = true

    // 从首 inline token 中移除 callout 标记
    const newContent = content.replace(CALLOUT_REGEX, '').trim()
    inlineToken.content = newContent
    if (inlineToken.children && inlineToken.children.length > 0) {
      const firstChild = inlineToken.children[0]
      if (firstChild && firstChild.type === 'text') {
        const remaining = firstChild.content.replace(CALLOUT_REGEX, '').trim()
        if (remaining) {
          firstChild.content = remaining
        } else {
          // 第一个 text node 被清空，移除它
          inlineToken.children.shift()
          // 如果下一个 child 是 softbreak，也移除
          // （callout 标记行与内容行之间的换行不需要保留在内容区）
          if (inlineToken.children.length > 0 && inlineToken.children[0].type === 'softbreak') {
            inlineToken.children.shift()
          }
        }
      }
    }

    // 如果首段落在移除 callout 标记后变为空，隐藏该段落
    if (!newContent) {
      hideEmptyParagraph(tokens, idx + 1, closeIdx)
    }

    return renderCalloutOpen(token, md)
  }

  md.renderer.rules.blockquote_close = function (tokens: any, idx: any, options: any, env: any, self: any) {
    if (tokens[idx]._calloutHandled) {
      return '</div></div>'
    }
    return originalBlockquoteClose(tokens, idx, options, env, self)
  }
}

function renderCalloutOpen(token: any, md: MarkdownIt): string {
  const type = token._calloutType || 'note'
  const title = token._calloutTitle || ''
  const foldable = !!token._calloutFoldable
  const folded = !!token._calloutFolded
  const iconSvg = getIcon(type)
  const titleHtml = title ? md.renderInline(title) : type.charAt(0).toUpperCase() + type.slice(1)
  const foldAttr = foldable ? ` data-foldable="true" data-folded="${folded}"` : ''
  const foldedClass = folded ? ' folded' : ''

  return `<div class="callout${foldedClass}" data-callout="${escapeHtml(type)}"${foldAttr}>` +
    `<div class="callout-title">` +
    `<div class="callout-icon">${iconSvg}</div>` +
    `<div class="callout-title-inner">${titleHtml}</div>` +
    (foldable ? `<div class="callout-fold-icon" data-callout-fold>${getFoldIcon()}</div>` : '') +
    `<div class="callout-copy-icon" data-callout-copy title="复制内容">复制</div>` +
    `</div>` +
    `<div class="callout-content"${folded ? ' style="display:none"' : ''}>`
}
