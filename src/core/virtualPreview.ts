import type MarkdownIt from 'markdown-it'
import type { MarkdownBlock, MarkdownBlockModel } from './markdownBlocks'
import { renderMarkdownBlock } from './markdownBlocks'

const MIN_OVERSCAN_PX = 1200
const MAX_MOUNTED_BLOCKS = 400
const OVERSIZED_CHUNK_CHARS = 64 * 1024

export interface VirtualPreviewDeps {
  md: MarkdownIt
  sanitize: (html: string) => string | Promise<string>
  enhance?: (root: HTMLElement, model: MarkdownBlockModel, generation: number) => void | Promise<void>
}

export interface VirtualFindResult {
  found: boolean
  total: number
  index: number
}

function closestBlockElement(node: Node | null, root: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-block-key]') ?? null
}

export class VirtualPreview {
  private model: MarkdownBlockModel | null = null
  private root: HTMLElement | null = null
  private metaHost: HTMLElement | null = null
  private topSpacer: HTMLElement | null = null
  private content: HTMLElement | null = null
  private bottomSpacer: HTMLElement | null = null
  private footnoteRoot: HTMLElement | null = null
  private heights: number[] = []
  private prefix: number[] = [0]
  private generation = 0
  private renderSeq = 0
  private raf = 0
  private measureRaf = 0
  private resizeObserver: ResizeObserver | null = null
  private findTerm = ''
  private findIndex = -1
  private findOffsets: number[] = []
  private lastScrollAt = 0
  private readonly onScroll = () => {
    this.lastScrollAt = performance.now()
    this.scheduleRender()
  }
  private readonly onCopy = (event: ClipboardEvent) => { this.copySelection(event) }

  constructor(
    private readonly scroller: HTMLElement,
    private readonly host: HTMLElement,
    private readonly deps: VirtualPreviewDeps,
  ) {
    this.scroller.style.overflowAnchor = 'none'
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
    this.scroller.addEventListener('copy', this.onCopy)
    try {
      this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure())
    } catch {}
  }

  get isActive(): boolean {
    return !!(this.root?.isConnected && this.model)
  }

  get currentModel(): MarkdownBlockModel | null {
    return this.model
  }

  get currentRoot(): HTMLElement | null {
    return this.root
  }

  get currentMetaHost(): HTMLElement | null {
    return this.metaHost
  }

  get currentFootnoteRoot(): HTMLElement | null {
    return this.footnoteRoot
  }

  get stats(): { blocks: number; mounted: number; domElements: number; generation: number } {
    return {
      blocks: this.model?.blocks.length ?? 0,
      mounted: this.content?.querySelectorAll('[data-block-key]').length ?? 0,
      domElements: this.root?.querySelectorAll('*').length ?? 0,
      generation: this.generation,
    }
  }

  async setDocument(model: MarkdownBlockModel): Promise<boolean> {
    if (this.model?.source === model.source && this.root?.isConnected) {
      await this.render()
      return true
    }
    const generation = ++this.generation
    this.model = model
    this.heights = model.blocks.map(block => block.estimatedHeight)
    this.rebuildPrefix()
    this.findTerm = ''
    this.findIndex = -1
    this.findOffsets = []
    this.mountShell()
    await this.render()
    return generation === this.generation
  }

  private mountShell(): void {
    this.resizeObserver?.disconnect()
    const root = document.createElement('div')
    root.className = 'preview-body virtual-preview-body'
    const meta = document.createElement('div')
    meta.className = 'virtual-preview-meta'
    const top = document.createElement('div')
    top.className = 'virtual-preview-spacer virtual-preview-spacer-top'
    top.setAttribute('aria-hidden', 'true')
    const content = document.createElement('div')
    content.className = 'virtual-preview-content'
    const bottom = document.createElement('div')
    bottom.className = 'virtual-preview-spacer virtual-preview-spacer-bottom'
    bottom.setAttribute('aria-hidden', 'true')
    root.append(meta, top, content, bottom)
    this.host.replaceChildren(root)
    this.root = root
    this.metaHost = meta
    this.topSpacer = top
    this.content = content
    this.bottomSpacer = bottom
    this.footnoteRoot = null
    try { this.resizeObserver?.observe(content) } catch {}
    try { this.resizeObserver?.observe(meta) } catch {}
  }

  private rebuildPrefix(): void {
    const next = new Array<number>(this.heights.length + 1)
    next[0] = 0
    for (let i = 0; i < this.heights.length; i++) next[i + 1] = next[i] + Math.max(1, this.heights[i] || 1)
    this.prefix = next
  }

  private blockAt(offset: number): number {
    const last = this.prefix.length - 1
    if (last <= 0) return 0
    const target = Math.max(0, Math.min(offset, Math.max(0, this.prefix[last] - 1)))
    let low = 0
    let high = last - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (this.prefix[mid] <= target) low = mid + 1
      else high = mid - 1
    }
    return Math.max(0, Math.min(last - 1, high))
  }

  private visibleRange(): { start: number; end: number } {
    const count = this.model?.blocks.length ?? 0
    if (!count) return { start: 0, end: 0 }
    const viewport = Math.max(200, this.scroller.clientHeight || 600)
    const overscan = Math.max(MIN_OVERSCAN_PX, viewport * 2)
    const leading = this.metaHost?.offsetHeight || 0
    const top = Math.max(0, this.scroller.scrollTop - leading)
    let start = this.blockAt(top - overscan)
    let end = Math.min(count, this.blockAt(top + viewport + overscan) + 1)
    if (end - start > MAX_MOUNTED_BLOCKS) {
      const center = this.blockAt(top + viewport / 2)
      start = Math.max(0, Math.min(center - MAX_MOUNTED_BLOCKS / 2, count - MAX_MOUNTED_BLOCKS))
      end = Math.min(count, start + MAX_MOUNTED_BLOCKS)
    }
    return { start, end }
  }

  private scheduleRender(): void {
    if (this.raf || !this.model) return
    const generation = this.generation
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (generation === this.generation) void this.render()
    })
  }

  private scheduleMeasure(): void {
    if (this.measureRaf || !this.model) return
    const generation = this.generation
    this.measureRaf = requestAnimationFrame(() => {
      this.measureRaf = 0
      if (generation === this.generation) this.measureMounted()
    })
  }

  private async render(): Promise<void> {
    const model = this.model
    const content = this.content
    if (!model || !content) return
    const generation = this.generation
    const seq = ++this.renderSeq
    const range = this.visibleRange()
    const anchorIndex = Math.max(0, Math.min(model.blocks.length - 1, range.start))
    const anchorKey = model.blocks[anchorIndex]?.key
    const leading = this.metaHost?.offsetHeight || 0
    const anchorOffset = this.scroller.scrollTop - leading - (this.prefix[anchorIndex] ?? 0)
    const headingByBlock = new Map(model.headings.map(heading => [heading.blockIndex, heading]))
    const wrappers: HTMLElement[] = []

    for (let i = range.start; i < range.end; i++) {
      const block = model.blocks[i]
      const wrapper = document.createElement('div')
      wrapper.className = 'virtual-block'
      wrapper.dataset.blockKey = block.key
      wrapper.dataset.blockIndex = String(block.index)
      wrapper.dataset.originalStart = String(block.originalStart)
      wrapper.dataset.originalEnd = String(block.originalEnd)
      if (block.oversized) {
        this.mountOversizedBlock(wrapper, block, model)
      } else {
        const html = await this.deps.sanitize(renderMarkdownBlock(model, block, this.deps.md))
        if (generation !== this.generation || seq !== this.renderSeq) return
        wrapper.innerHTML = html
        const heading = headingByBlock.get(block.index)
        if (heading) wrapper.querySelector('h1,h2,h3,h4,h5,h6')?.setAttribute('id', heading.id)
        const boxes = Array.from(wrapper.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox'))
        boxes.forEach((box, index) => {
          box.type = 'checkbox'
          box.dataset.taskId = String(block.taskStart + index)
        })
      }
      wrappers.push(wrapper)
    }

    if (generation !== this.generation || seq !== this.renderSeq) return
    content.replaceChildren(...wrappers)
    this.topSpacer!.style.height = `${this.prefix[range.start] || 0}px`
    this.bottomSpacer!.style.height = `${Math.max(0, this.prefix[model.blocks.length] - this.prefix[range.end])}px`
    for (const wrapper of wrappers) {
      try { this.resizeObserver?.observe(wrapper) } catch {}
    }
    await this.prepareFootnoteRoot(model, generation)
    this.measureMounted(anchorKey, anchorOffset)

    if (this.deps.enhance) await this.deps.enhance(content, model, generation)
    if (generation !== this.generation || seq !== this.renderSeq) return
    this.measureMounted(anchorKey, anchorOffset)
  }

  private async prepareFootnoteRoot(model: MarkdownBlockModel, generation: number): Promise<void> {
    if (this.footnoteRoot) return
    const tail = model.blocks.find(block => block.footnoteTail)
    if (!tail) {
      this.footnoteRoot = null
      return
    }
    const html = await this.deps.sanitize(renderMarkdownBlock(model, tail, this.deps.md))
    if (generation !== this.generation) return
    const root = document.createElement('div')
    root.innerHTML = html
    this.footnoteRoot = root
  }

  private measureMounted(anchorKey?: string, anchorOffset = 0): void {
    if (!this.content || !this.model) return
    let changed = false
    const wrappers = Array.from(this.content.querySelectorAll<HTMLElement>('[data-block-index]'))
    for (const wrapper of wrappers) {
      const index = Number(wrapper.dataset.blockIndex)
      const measured = wrapper.offsetHeight || 0
      if (measured > 0 && Math.abs((this.heights[index] || 0) - measured) > 1) {
        this.heights[index] = measured
        changed = true
      }
    }
    if (!changed) return
    this.rebuildPrefix()
    const range = this.visibleRange()
    if (this.topSpacer) this.topSpacer.style.height = `${this.prefix[range.start] || 0}px`
    if (this.bottomSpacer) this.bottomSpacer.style.height = `${Math.max(0, this.prefix[this.model.blocks.length] - this.prefix[range.end])}px`
    if (anchorKey && performance.now() - this.lastScrollAt >= 100) {
      const nextIndex = this.model.blocks.findIndex(block => block.key === anchorKey)
      if (nextIndex >= 0) {
        const nextTop = Math.max(0, (this.metaHost?.offsetHeight || 0) + (this.prefix[nextIndex] || 0) + anchorOffset)
        if (Math.abs(this.scroller.scrollTop - nextTop) > 1) this.scroller.scrollTop = nextTop
      }
    }
  }

  private mountOversizedBlock(wrapper: HTMLElement, block: MarkdownBlock, model: MarkdownBlockModel): void {
    const source = model.originalSource.slice(block.originalStart, block.originalEnd)
    const chunkCount = Math.max(1, Math.ceil(source.length / OVERSIZED_CHUNK_CHARS))
    let chunkIndex = 0
    wrapper.classList.add('virtual-block-oversized')
    const label = document.createElement('div')
    label.className = 'virtual-block-oversized-label'
    const pre = document.createElement('pre')
    pre.className = 'virtual-block-oversized-source'
    pre.setAttribute('aria-label', '超大块只读源码')
    const controls = document.createElement('div')
    controls.className = 'virtual-block-oversized-controls'
    const prev = document.createElement('button')
    prev.type = 'button'
    prev.textContent = '上一段'
    const next = document.createElement('button')
    next.type = 'button'
    next.textContent = '下一段'
    controls.append(prev, next)
    const update = () => {
      const start = chunkIndex * OVERSIZED_CHUNK_CHARS
      pre.textContent = source.slice(start, start + OVERSIZED_CHUNK_CHARS)
      label.textContent = `超大块只读查看 · ${chunkIndex + 1}/${chunkCount} · 编辑请使用源码或流畅编辑模式`
      prev.disabled = chunkIndex <= 0
      next.disabled = chunkIndex >= chunkCount - 1
    }
    prev.addEventListener('click', () => { if (chunkIndex > 0) { chunkIndex--; update() } })
    next.addEventListener('click', () => { if (chunkIndex < chunkCount - 1) { chunkIndex++; update() } })
    ;(wrapper as any).showChunk = (index: number) => {
      chunkIndex = Math.max(0, Math.min(chunkCount - 1, Math.trunc(index) || 0))
      update()
    }
    wrapper.append(label, controls, pre)
    update()
  }

  async scrollToBlock(index: number, withinBlock = 0): Promise<HTMLElement | null> {
    const model = this.model
    if (!model || !model.blocks.length) return null
    const safe = Math.max(0, Math.min(model.blocks.length - 1, index))
    const leading = this.metaHost?.offsetHeight || 0
    this.scroller.scrollTop = Math.max(0, leading + (this.prefix[safe] || 0) + withinBlock)
    await this.render()
    const key = model.blocks[safe].key
    const element = this.content?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`) ?? null
    if (element) {
      const block = model.blocks[safe]
      if (block.oversized) {
        const sourceLength = Math.max(1, block.originalEnd - block.originalStart)
        const ratio = Math.max(0, Math.min(1, withinBlock / Math.max(1, block.estimatedHeight)))
        ;(element as any).showChunk?.(Math.floor(sourceLength * ratio / OVERSIZED_CHUNK_CHARS))
      }
      const top = Math.max(0, leading + (this.prefix[safe] || 0) + withinBlock)
      if (Math.abs(this.scroller.scrollTop - top) > 1) this.scroller.scrollTop = top
    }
    return element
  }

  async scrollToHeading(id: string): Promise<HTMLElement | null> {
    const heading = this.model?.headings.find(item => item.id === id)
    return heading ? this.scrollToBlock(heading.blockIndex) : null
  }

  async scrollToAnchor(id: string): Promise<HTMLElement | null> {
    const heading = await this.scrollToHeading(id)
    if (heading) return heading
    const tail = this.model?.blocks.find(block => block.footnoteTail)
    if (!tail) return null
    const root = await this.scrollToBlock(tail.index)
    return root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? null
  }

  async scrollToSourceLine(line: number): Promise<HTMLElement | null> {
    const blocks = this.model?.blocks || []
    const block = blocks.find(item => line >= item.startLine && line < item.endLine)
      || blocks.find(item => item.startLine >= line)
      || blocks[blocks.length - 1]
    return block ? this.scrollToBlock(block.index) : null
  }

  private collectFindOffsets(term: string, caseSensitive: boolean): number[] {
    const source = this.model?.source || ''
    const haystack = caseSensitive ? source : source.toLowerCase()
    const needle = caseSensitive ? term : term.toLowerCase()
    const offsets: number[] = []
    let index = 0
    while (needle && (index = haystack.indexOf(needle, index)) >= 0) {
      offsets.push(index)
      index += needle.length
    }
    return offsets
  }

  async find(term: string, caseSensitive: boolean, forward: boolean): Promise<VirtualFindResult> {
    const model = this.model
    if (!model || !term) return { found: false, total: 0, index: -1 }
    if (this.findTerm !== term) {
      this.findTerm = term
      this.findOffsets = this.collectFindOffsets(term, caseSensitive)
      this.findIndex = forward ? -1 : this.findOffsets.length
    }
    const total = this.findOffsets.length
    if (!total) return { found: false, total: 0, index: -1 }
    let next = this.findIndex + (forward ? 1 : -1)
    if (next < 0) next = total - 1
    if (next >= total) next = 0

    for (let attempts = 0; attempts < total; attempts++) {
      this.findIndex = next
      const offset = this.findOffsets[next]
      const blockIndex = model.blocks.findIndex(block => offset >= block.sourceStart && offset < block.sourceEnd)
      if (blockIndex >= 0) {
        const block = model.blocks[blockIndex]
        const ratio = Math.max(0, Math.min(1, (offset - block.sourceStart) / Math.max(1, block.sourceEnd - block.sourceStart)))
        const element = await this.scrollToBlock(blockIndex, ratio * block.estimatedHeight)
        const range = element ? this.rangeForTerm(element, term, caseSensitive) : null
        if (range) {
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          return { found: true, total, index: next }
        }
      }
      next += forward ? 1 : -1
      if (next < 0) next = total - 1
      if (next >= total) next = 0
    }
    return { found: false, total: 0, index: -1 }
  }

  private rangeForTerm(root: HTMLElement, term: string, caseSensitive: boolean): Range | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const needle = caseSensitive ? term : term.toLowerCase()
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node.textContent || ''
      const haystack = caseSensitive ? text : text.toLowerCase()
      const index = haystack.indexOf(needle)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + term.length)
      return range
    }
    return null
  }

  copySelection(event: ClipboardEvent): boolean {
    const model = this.model
    const root = this.root
    const selection = window.getSelection()
    if (!model || !root || !selection || selection.rangeCount === 0 || selection.isCollapsed || !event.clipboardData) return false
    const range = selection.getRangeAt(0)
    const startElement = closestBlockElement(range.startContainer, root)
    const endElement = closestBlockElement(range.endContainer, root)
    if (!startElement && !endElement && range.commonAncestorContainer === root) {
      event.clipboardData.setData('text/plain', model.originalSource)
      event.preventDefault()
      return true
    }
    if (!startElement || !endElement || startElement === endElement) return false
    event.clipboardData.setData('text/plain', selection.toString())
    event.preventDefault()
    return true
  }

  destroy(): void {
    this.generation++
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.measureRaf) cancelAnimationFrame(this.measureRaf)
    this.raf = 0
    this.measureRaf = 0
    this.resizeObserver?.disconnect()
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.scroller.removeEventListener('copy', this.onCopy)
    this.root?.remove()
    this.root = null
    this.model = null
    this.content = null
    this.metaHost = null
    this.topSpacer = null
    this.bottomSpacer = null
    this.footnoteRoot = null
  }
}
