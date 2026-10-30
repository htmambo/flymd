import { beforeAll, describe, expect, it } from 'vitest'
import type MarkdownIt from 'markdown-it'
import {
  MarkdownBlockModelCache,
  OVERSIZED_BLOCK_LINES,
  createMarkdownBlockModel,
  renderAllMarkdownBlocks,
} from './markdownBlocks'
import { createPreviewMarkdownIt, renderMarkdownCore } from './previewRenderer'

const deps = {
  getHljsCore: () => null,
  normalizeHljsLang: (lang: string) => lang.trim().toLowerCase(),
  ensureHljsCore: async () => null,
  debugRender: false,
}

let md: MarkdownIt
beforeAll(async () => {
  md = await createPreviewMarkdownIt(deps)
})

async function expectEquivalent(source: string) {
  const model = await createMarkdownBlockModel(source, md)
  expect(model.requiresLegacy).toBe(false)
  expect(renderAllMarkdownBlocks(model, md)).toBe(await renderMarkdownCore(source, md))
  return model
}

describe('markdownBlocks — 实际插件输出等价', () => {
  it('顶层块拼接与整篇渲染逐字节一致', async () => {
    const model = await expectEquivalent(`# 标题\n\n- [ ] 任务\n- [x] 完成\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n\n> [!note] 提示\n> 内容`)
    expect(model.blocks.length).toBeGreaterThan(3)
    expect(model.taskCount).toBe(2)
  })

  it('重复渲染同一块与整体拼接保持幂等', async () => {
    const source = '**加粗** 与 [链接][ref] 和脚注[^n]\n\n[^n]: 脚注\n\n[ref]: https://example.com'
    const model = await createMarkdownBlockModel(source, md)
    const first = renderAllMarkdownBlocks(model, md)
    const second = renderAllMarkdownBlocks(model, md)
    expect(second).toBe(first)
    expect(first).toBe(await renderMarkdownCore(source, md))
  })

  it('引用定义、脚注及其尾块保持共享 env 语义', async () => {
    const model = await expectEquivalent(`[链接][ref] 与脚注[^n]。\n\n[^n]: 脚注内容\n\n[ref]: https://example.com`)
    expect(renderAllMarkdownBlocks(model, md)).toContain('https://example.com')
    expect(model.blocks.some(block => block.footnoteTail)).toBe(true)
  })

  it('嵌套列表、setext、数学与 mermaid 保持原子块', async () => {
    const model = await expectEquivalent(`标题\n===\n\n1. 一级\n   - 二级\n   - 二级二\n2. 一级二\n\n$$\nx^2\n$$\n\n\`\`\`mermaid\nflowchart TD\nA-->B\n\`\`\``)
    expect(model.blocks.some(block => block.type === 'ordered_list_open')).toBe(true)
    expect(model.blocks.some(block => block.type === 'fence')).toBe(true)
  })

  it('自包含原始 HTML 可虚拟化，跨块未闭合 HTML 回退 legacy', async () => {
    await expectEquivalent('<div class="raw">内容</div>')
    const model = await createMarkdownBlockModel('<div>\n\nMarkdown 内容', md)
    expect(model.requiresLegacy).toBe(true)
  })

  it('BOM、CRLF、Unicode 与无尾换行保持输出', async () => {
    await expectEquivalent('\ufeff# 标题\r\n\r\n中文 😀 **加粗**')
  })
})

describe('markdownBlocks — 索引与边界', () => {
  it('生成稳定且唯一的块键和全局标题 ID', async () => {
    const model = await createMarkdownBlockModel('# 同名\n\n# 同名\n\n# 同名', md)
    expect(new Set(model.blocks.map(block => block.key)).size).toBe(model.blocks.length)
    expect(model.headings.map(heading => heading.id)).toEqual(['同名', '同名-1', '同名-2'])
    expect(model.headings.map(heading => heading.blockIndex)).toEqual([0, 1, 2])
  })

  it('超过行数或字符阈值的单块进入只读降级标记', async () => {
    const byLines = await createMarkdownBlockModel(`\`\`\`text\n${'x\n'.repeat(OVERSIZED_BLOCK_LINES + 1)}\`\`\``, md)
    expect(byLines.blocks[0].oversized).toBe(true)
    const byChars = await createMarkdownBlockModel('x'.repeat(257 * 1024), md)
    expect(byChars.blocks[0].oversized).toBe(true)
  })

  it('保留原始源码行偏移，供复制和任务回写', async () => {
    const original = '---\ntitle: test\n---\n- [ ] 任务'
    const preview = '- [ ] 任务'
    const model = await createMarkdownBlockModel(preview, md, {
      originalSource: original,
      originalLineOffset: 3,
    })
    expect(model.originalSource.slice(model.blocks[0].originalStart, model.blocks[0].originalEnd)).toBe(preview)
    expect(model.blocks[0].taskCount).toBe(1)
  })

  it('模型缓存按 LRU 限制为三个文档', async () => {
    const cache = new MarkdownBlockModelCache()
    for (const text of ['a', 'b', 'c']) cache.set(text, await createMarkdownBlockModel(text, md))
    expect(cache.get('a')?.source).toBe('a')
    cache.set('d', await createMarkdownBlockModel('d', md))
    expect(cache.size).toBe(3)
    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')?.source).toBe('a')
  })
})
