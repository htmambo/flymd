// 所见模式 <sub>/<sup>/<abbr> HTML 内联标签渲染扩展
// 通过 milkdown $mark + $remark + remark-stringify handlers 实现
// remark 层面将配对 HTML 标签合并为自定义 MDAST 节点,mark 层面映射为 ProseMirror mark

import { $markSchema, $remark } from '@milkdown/utils'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { MarkdownNode } from '@milkdown/transformer'

// ---- 支持的标签配置 ----

const INLINE_HTML_TAGS = ['sub', 'sup', 'abbr'] as const
type InlineHtmlTag = (typeof INLINE_HTML_TAGS)[number]

const TAG_CONFIG: Record<InlineHtmlTag, { mdastType: string; attrParser: (attrs: string) => Record<string, string | undefined> }> = {
  sub: { mdastType: 'html_sub', attrParser: () => ({}) },
  sup: { mdastType: 'html_sup', attrParser: () => ({}) },
  abbr: {
    mdastType: 'html_abbr',
    attrParser: (attrs) => {
      const m = attrs.match(/title=["']([^"']*)["']/)
      return m ? { title: m[1] } : {}
    },
  },
}

// 含 phrasing 子节点的 MDAST 父节点类型
// paragraph 之外,heading / tableCell 等也可能包含内联 HTML
const PHRASING_PARENT_TYPES = new Set(['paragraph', 'heading', 'tableCell', 'delete', 'emphasis', 'strong', 'link', 'linkReference'])

// ---- Remark 插件：合并配对 HTML 标签 ----

function remarkHtmlInlineTagsPlugin() {
  return (tree: Root) => {
    visit(tree, (node: any) => {
      if (!PHRASING_PARENT_TYPES.has(node.type) || !Array.isArray(node.children)) return
      const children = node.children
      const newChildren: any[] = []
      let i = 0
      while (i < children.length) {
        const child = children[i]
        if (child.type === 'html') {
          // 匹配开标签: <sub>, <sup>, <abbr>, <abbr title="...">
          const openMatch = String(child.value).match(
            /^<(sub|sup|abbr)(\s[^>]*)?>$/
          )
          if (openMatch) {
            const tag = openMatch[1] as InlineHtmlTag
            const attrsStr = (openMatch[2] || '').trim()
            const config = TAG_CONFIG[tag]
            // 收集内容直到闭标签
            const content: any[] = []
            let j = i + 1
            let found = false
            while (j < children.length) {
              const next = children[j]
              if (next.type === 'html' && String(next.value) === `</${tag}>`) {
                found = true
                break
              }
              content.push(next)
              j++
            }
            if (found) {
              const attrs = config.attrParser(attrsStr)
              newChildren.push({
                type: config.mdastType,
                children: content,
                ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
              })
              i = j + 1
              continue
            }
          }
        }
        newChildren.push(child)
        i++
      }
      node.children = newChildren
    })
  }
}

export const remarkHtmlInlineTags = $remark(
  'remarkHtmlInlineTags',
  () => remarkHtmlInlineTagsPlugin
)

// ---- Mark 定义 ----

// <sub> 下标
export const subMark = $markSchema('html_sub', () => ({
  parseDOM: [{ tag: 'sub' }],
  // mark 的 toDOM 用 [tag, attrs] 形式(对齐内置 em/strong),内容由 view 自动放入;
  // 内容洞 0 是 node 的写法,mark 不应带洞(会让 mark 报告 contentDOM)。
  toDOM: () => ['sub', {}],
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === 'html_sub',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next((node as any).children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'html_sub',
    runner: (state, mark) => {
      state.withMark(mark, 'html_sub')
    },
  },
}))

// <sup> 上标
export const supMark = $markSchema('html_sup', () => ({
  parseDOM: [{ tag: 'sup' }],
  toDOM: () => ['sup', {}],
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === 'html_sup',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next((node as any).children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'html_sup',
    runner: (state, mark) => {
      state.withMark(mark, 'html_sup')
    },
  },
}))

// <abbr> 缩写 (带可选 title 属性)
export const abbrMark = $markSchema('html_abbr', () => ({
  attrs: {
    title: { default: '' },
  },
  parseDOM: [
    {
      tag: 'abbr',
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === 'string') return { title: '' }
        return { title: dom.getAttribute('title') || '' }
      },
    },
  ],
  toDOM: (mark) => {
    const title = mark.attrs.title
    return title ? ['abbr', { title }] : ['abbr', {}]
  },
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === 'html_abbr',
    runner: (state, node, markType) => {
      const attrs = (node as any).attributes || {}
      state.openMark(markType, { title: attrs.title || '' })
      state.next((node as any).children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'html_abbr',
    runner: (state, mark) => {
      const title = mark.attrs.title || ''
      state.withMark(mark, 'html_abbr', undefined, {
        attributes: title ? { title } : {},
      })
    },
  },
}))

// ---- remark-stringify handlers ----
// 用于将自定义 MDAST 节点序列化回 HTML 标签

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const htmlInlineTagStringifyHandlers = {
  html_sub(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlSub')
    const content = state.containerPhrasing(node, {
      before: '<sub>',
      after: '</sub>',
    })
    exit()
    return '<sub>' + content + '</sub>'
  },
  html_sup(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlSup')
    const content = state.containerPhrasing(node, {
      before: '<sup>',
      after: '</sup>',
    })
    exit()
    return '<sup>' + content + '</sup>'
  },
  html_abbr(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlAbbr')
    const rawTitle = node.attributes?.title || ''
    const openTag = rawTitle ? '<abbr title="' + escapeHtmlAttr(rawTitle) + '">' : '<abbr>'
    const content = state.containerPhrasing(node, {
      before: openTag,
      after: '</abbr>',
    })
    exit()
    return openTag + content + '</abbr>'
  },
}
