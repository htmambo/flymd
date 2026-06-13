// @vitest-environment node
// htmlInlineTags.test.ts — remark 插件合并配对 HTML 标签 + 序列化 handlers

import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { toMarkdown } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

// 直接导入插件逻辑（不走 milkdown 注册）
function remarkHtmlInlineTagsPlugin() {
  const PHRASING_PARENT_TYPES = new Set(['paragraph', 'heading', 'tableCell', 'delete', 'emphasis', 'strong', 'link', 'linkReference'])
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (!PHRASING_PARENT_TYPES.has(node.type) || !Array.isArray(node.children)) return
      const children = node.children
      const newChildren: any[] = []
      const TAG_CONFIG: Record<string, { mdastType: string; attrParser: (attrs: string) => Record<string, string | undefined> }> = {
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
      let i = 0
      while (i < children.length) {
        const child = children[i]
        if (child.type === 'html') {
          const openMatch = String(child.value).match(/^<(sub|sup|abbr)(\s[^>]*)?>$/)
          if (openMatch) {
            const tag = openMatch[1]
            const attrsStr = (openMatch[2] || '').trim()
            const config = TAG_CONFIG[tag]
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

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const handlers = {
  html_sub(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlSub')
    const content = state.containerPhrasing(node, { before: '<sub>', after: '</sub>' })
    exit()
    return '<sub>' + content + '</sub>'
  },
  html_sup(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlSup')
    const content = state.containerPhrasing(node, { before: '<sup>', after: '</sup>' })
    exit()
    return '<sup>' + content + '</sup>'
  },
  html_abbr(node: any, _parent: any, state: any) {
    const exit = state.enter('htmlAbbr')
    const rawTitle = node.attributes?.title || ''
    const openTag = rawTitle ? '<abbr title="' + escapeHtmlAttr(rawTitle) + '">' : '<abbr>'
    const content = state.containerPhrasing(node, { before: openTag, after: '</abbr>' })
    exit()
    return openTag + content + '</abbr>'
  },
}

describe('remarkHtmlInlineTags', () => {
  async function transform(md: string) {
    const tree = unified().use(remarkParse).parse(md)
    const plugin = remarkHtmlInlineTagsPlugin()
    plugin(tree)
    return toMarkdown(tree as any, { handlers: handlers as any })
  }

  it('合并 <sub> 配对标签', async () => {
    const result = await transform('H<sub>2</sub>O')
    expect(result).toContain('<sub>2</sub>')
    expect(result).toContain('H')
    expect(result).toContain('O')
  })

  it('合并 <sup> 配对标签', async () => {
    const result = await transform('x<sup>2</sup>')
    expect(result).toContain('<sup>2</sup>')
    expect(result).toContain('x')
  })

  it('合并 <abbr> 配对标签 (带 title)', async () => {
    const result = await transform('<abbr title="World Wide Web">WWW</abbr>')
    expect(result).toContain('<abbr title="World Wide Web">WWW</abbr>')
  })

  it('合并 <abbr> 配对标签 (无 title)', async () => {
    const result = await transform('<abbr>HTML</abbr>')
    expect(result).toContain('<abbr>HTML</abbr>')
    expect(result).not.toContain('title=')
  })

  it('不匹配未闭合标签 (保留原始 html 节点)', async () => {
    const result = await transform('H<sub>2')
    // remarkStringify 会直接输出 html 节点的 value
    expect(result).toContain('<sub>')
  })

  it('heading 中的 <sub> 标签也被合并', async () => {
    const result = await transform('# Title <sub>note</sub>')
    expect(result).toContain('<sub>note</sub>')
  })

  it('title 属性中的特殊字符被转义', async () => {
    const result = await transform('<abbr title="A &amp; B">AB</abbr>')
    // remark-parse 会解码 &amp; → &，然后我们的 handler 需要再转义回 &amp;
    // 所以最终输出应包含 &amp;
    expect(result).toContain('&amp;')
  })

  it('多个标签在同一段落中', async () => {
    const result = await transform('H<sub>2</sub>O and x<sup>2</sup>')
    expect(result).toContain('<sub>2</sub>')
    expect(result).toContain('<sup>2</sup>')
  })
})
