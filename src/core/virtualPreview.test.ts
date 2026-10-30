// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type MarkdownIt from 'markdown-it'
import { createPreviewMarkdownIt } from './previewRenderer'
import { createMarkdownBlockModel } from './markdownBlocks'
import { VirtualPreview } from './virtualPreview'

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

let scroller: HTMLDivElement
let host: HTMLDivElement
let renderer: VirtualPreview

beforeEach(() => {
  document.body.innerHTML = ''
  scroller = document.createElement('div')
  host = document.createElement('div')
  scroller.appendChild(host)
  document.body.appendChild(scroller)
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 })
  renderer = new VirtualPreview(scroller, host, { md, sanitize: html => html })
})

describe('VirtualPreview', () => {
  it('只挂载视口附近块，重复同文渲染不重建内容', async () => {
    const source = Array.from({ length: 100 }, (_, i) => `段落 ${i}`).join('\n\n')
    const model = await createMarkdownBlockModel(source, md)
    await renderer.setDocument(model)
    const content = host.querySelector('.virtual-preview-content')
    expect(renderer.stats.blocks).toBe(100)
    expect(renderer.stats.mounted).toBeLessThan(100)
    expect(host.querySelectorAll('.virtual-preview-spacer')).toHaveLength(2)

    const firstContent = host.querySelector('.virtual-preview-content')
    await renderer.setDocument(model)
    expect(host.querySelector('.virtual-preview-content')).toBe(firstContent)
    expect(content).toBe(firstContent)
  })

  it('快速跳转和源码查找会挂载目标块', async () => {
    const source = Array.from({ length: 100 }, (_, i) => `段落 ${i}`).join('\n\n')
    await renderer.setDocument(await createMarkdownBlockModel(source, md))
    const target = await renderer.scrollToBlock(80)
    expect(target?.textContent).toContain('段落 80')

    const result = await renderer.find('段落 81', false, true)
    expect(result.found).toBe(true)
    expect(result.total).toBe(1)
    expect(host.querySelector('.virtual-preview-content')?.textContent).toContain('段落 81')
  })

  it('跨块复制使用原始 Markdown，全选复制保持全文', async () => {
    const source = '第一块\n\n第二块\n\n第三块'
    await renderer.setDocument(await createMarkdownBlockModel(source, md))
    const blocks = Array.from(host.querySelectorAll<HTMLElement>('[data-block-key]'))
    expect(blocks.length).toBeGreaterThan(1)
    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(blocks[0], 0)
    range.setEnd(blocks[1], blocks[1].childNodes.length)
    selection.removeAllRanges()
    selection.addRange(range)
    const copied: string[] = []
    const event = {
      clipboardData: { setData: (_type: string, text: string) => copied.push(text) },
      preventDefault: () => {},
    } as any
    expect(renderer.copySelection(event)).toBe(true)
    expect(copied[0]).toContain('第一块')
    expect(copied[0]).toContain('第二块')

    range.selectNodeContents(host.querySelector('.virtual-preview-body')!)
    selection.removeAllRanges()
    selection.addRange(range)
    copied.length = 0
    expect(renderer.copySelection(event)).toBe(true)
    expect(copied[0]).toBe(source)
  })

  it('超大块使用只读分段源码查看器', async () => {
    const source = 'x'.repeat(257 * 1024)
    await renderer.setDocument(await createMarkdownBlockModel(source, md))
    const viewer = host.querySelector('.virtual-block-oversized')
    expect(viewer).not.toBeNull()
    expect(viewer?.querySelector('pre')?.textContent?.length).toBe(64 * 1024)
    expect(viewer?.querySelectorAll('button')).toHaveLength(2)
  })

  it('部分跨块选区只复制精确渲染文本', async () => {
    await renderer.setDocument(await createMarkdownBlockModel('第一块\n\n第二块\n\n第三块', md))
    const blocks = Array.from(host.querySelectorAll<HTMLElement>('[data-block-key]'))
    const startNode = blocks[0].querySelector('p')!.firstChild!
    const endNode = blocks[1].querySelector('p')!.firstChild!
    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(startNode, 1)
    range.setEnd(endNode, 2)
    selection.removeAllRanges()
    selection.addRange(range)
    const copied: string[] = []
    const event = { clipboardData: { setData: (_type: string, text: string) => copied.push(text) }, preventDefault: () => {} } as any
    expect(renderer.copySelection(event)).toBe(true)
    expect(copied[0]).toBe(selection.toString())
    expect(copied[0]).not.toBe('第一块\n\n第二块')
  })

  it('超大块查找会切换到命中所在 chunk', async () => {
    const source = `${'x'.repeat(257 * 1024)}needle`
    await renderer.setDocument(await createMarkdownBlockModel(source, md))
    const result = await renderer.find('needle', false, true)
    expect(result.found).toBe(true)
    expect(host.querySelector('.virtual-block-oversized')).not.toBeNull()
    expect(host.textContent).toContain('5/5')
  })

  it('滚动定位计入 meta 高度', async () => {
    const source = Array.from({ length: 80 }, (_, i) => `段落 ${i}`).join('\n\n')
    await renderer.setDocument(await createMarkdownBlockModel(source, md))
    Object.defineProperty(renderer.currentMetaHost!, 'offsetHeight', { configurable: true, value: 100 })
    await renderer.scrollToBlock(50)
    const prefix = (renderer as any).prefix
    expect(scroller.scrollTop).toBe(100 + prefix[50])
  })

  it('脚注尾块提供独立映射根，不要求它位于视口内', async () => {
    await renderer.setDocument(await createMarkdownBlockModel('脚注[^a]\n\n[^a]: 内容', md))
    expect(renderer.currentFootnoteRoot?.querySelector('.footnotes')).not.toBeNull()
  })

  it('销毁后使异步代次失效并移除 DOM', async () => {
    await renderer.setDocument(await createMarkdownBlockModel('内容', md))
    renderer.destroy()
    expect(renderer.isActive).toBe(false)
    expect(host.childElementCount).toBe(0)
  })
})
