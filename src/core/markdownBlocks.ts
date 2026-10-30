import type MarkdownIt from 'markdown-it'
import { makePreviewHeadingId } from './previewAnchor'

interface Token {
  type: string
  tag: string
  nesting: number
  map: [number, number] | null
  content: string
  children: Token[] | null
}

type Env = Record<string, any>
import { preprocessMarkdownCore } from './previewRenderer'
import { scanTaskList } from '../plugins/markdownItTaskList'
import { stripStrongBoundaryGuard } from '../plugins/strongBoundaryCompat'

export const OVERSIZED_BLOCK_CHARS = 256 * 1024
export const OVERSIZED_BLOCK_LINES = 512

export interface MarkdownBlock {
  index: number
  key: string
  type: string
  tokens: Token[]
  startLine: number
  endLine: number
  sourceStart: number
  sourceEnd: number
  originalStart: number
  originalEnd: number
  estimatedHeight: number
  oversized: boolean
  taskStart: number
  taskCount: number
  footnoteTail: boolean
}

export interface MarkdownHeading {
  id: string
  text: string
  level: number
  blockIndex: number
  startLine: number
}

export interface MarkdownBlockModel {
  source: string
  originalSource: string
  originalLineOffset: number
  env: Env
  tokens: Token[]
  blocks: MarkdownBlock[]
  headings: MarkdownHeading[]
  lineStarts: number[]
  originalLineStarts: number[]
  taskCount: number
  requiresLegacy: boolean
}

export interface MarkdownBlockModelOptions {
  originalSource?: string
  originalLineOffset?: number
}

function buildLineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function lineStart(starts: number[], line: number, sourceLength: number): number {
  if (line < 0) return 0
  return line < starts.length ? starts[line] : sourceLength
}

function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function estimateBlockHeight(type: string, lineCount: number, oversized: boolean): number {
  if (oversized) return 320
  const lines = Math.max(1, lineCount)
  if (type === 'fence') return Math.min(480, lines * 22 + 64) + 8
  if (type === 'heading_open') return lines * 30 + 30
  if (type === 'table_open') return lines * 26 + 20
  if (type === 'bullet_list_open' || type === 'ordered_list_open') return lines * 25 + 12
  if (type === 'blockquote_open') return lines * 25 + 16
  if (type === 'html_block') return lines * 24 + 12
  return lines * 25 + 12
}

function hasUnbalancedRawHtml(tokens: Token[]): boolean {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  for (const token of tokens) {
    if (token.type !== 'html_block') continue
    const html = token.content || ''
    if ((html.includes('<!--') && !html.includes('-->')) || (html.includes('<![CDATA[') && !html.includes(']]>'))) return true
    const stack: string[] = []
    const tagRe = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)\b[^>]*>/g
    let match: RegExpExecArray | null
    while ((match = tagRe.exec(html))) {
      const closing = match[1] === '/'
      const tag = match[2].toLowerCase()
      const raw = match[0]
      if (raw.startsWith('<!') || raw.startsWith('<?') || voidTags.has(tag) || raw.endsWith('/>')) continue
      if (!closing) {
        stack.push(tag)
      } else if (stack.length && stack[stack.length - 1] === tag) {
        stack.pop()
      } else {
        return true
      }
    }
    if (stack.length) return true
  }
  return false
}

function inlineText(token: Token | undefined): string {
  if (!token) return ''
  if (token.children?.length) return token.children.map(child => child.content || '').join('').trim()
  return (token.content || '').trim()
}

export async function createMarkdownBlockModel(
  input: string,
  md: MarkdownIt,
  options: MarkdownBlockModelOptions = {},
): Promise<MarkdownBlockModel> {
  const source = await preprocessMarkdownCore(input)
  const originalSource = options.originalSource ?? input
  const originalLineOffset = Math.max(0, options.originalLineOffset ?? 0)
  const env: Env = {}
  const tokens = md.parse(source, env) as Token[]
  const lineStarts = buildLineStarts(source)
  const originalLineStarts = buildLineStarts(originalSource)
  const blocks: MarkdownBlock[] = []
  const headings: MarkdownHeading[] = []
  const usedHeadingIds = new Set<string>()
  const keyOrdinals = new Map<string, number>()
  let requiresLegacy = false
  let taskCount = 0

  for (let i = 0; i < tokens.length;) {
    const tokenStart = i
    const first = tokens[i]
    if (first.nesting === 1) {
      let depth = 0
      do {
        depth += tokens[i].nesting
        i++
      } while (i < tokens.length && depth > 0)
    } else {
      i++
    }
    const group = tokens.slice(tokenStart, i)
    if (hasUnbalancedRawHtml(group)) requiresLegacy = true

    const startLine = first.map?.[0] ?? group.find(token => token.map)?.map?.[0] ?? 0
    const mappedEnd = first.map?.[1] ?? [...group].reverse().find(token => token.map)?.map?.[1]
    const endLine = Math.max(startLine + 1, mappedEnd ?? (tokens[i]?.map?.[0] ?? startLine + 1))
    const sourceStart = lineStart(lineStarts, startLine, source.length)
    const sourceEnd = lineStart(lineStarts, endLine, source.length)
    const originalStart = lineStart(originalLineStarts, startLine + originalLineOffset, originalSource.length)
    const originalEnd = lineStart(originalLineStarts, endLine + originalLineOffset, originalSource.length)
    const sourceSlice = source.slice(sourceStart, sourceEnd)
    const baseKey = `${startLine}:${first.type}:${hashText(sourceSlice)}`
    const ordinal = keyOrdinals.get(baseKey) ?? 0
    keyOrdinals.set(baseKey, ordinal + 1)
    const key = ordinal ? `${baseKey}:${ordinal}` : baseKey
    const blockTasks = scanTaskList(sourceSlice).length
    const lineCount = Math.max(1, endLine - startLine)
    const oversized = sourceSlice.length > OVERSIZED_BLOCK_CHARS || lineCount > OVERSIZED_BLOCK_LINES
    const index = blocks.length
    blocks.push({
      index,
      key,
      type: first.type,
      tokens: group,
      startLine,
      endLine,
      sourceStart,
      sourceEnd,
      originalStart,
      originalEnd,
      estimatedHeight: estimateBlockHeight(first.type, lineCount, oversized),
      oversized,
      taskStart: taskCount,
      taskCount: blockTasks,
      footnoteTail: first.type === 'footnote_block_open',
    })
    taskCount += blockTasks

    const headingTokenIndex = group.findIndex(token => token.type === 'heading_open')
    if (headingTokenIndex >= 0) {
      const headingToken = group[headingTokenIndex]
      const text = inlineText(group[headingTokenIndex + 1])
      const level = Math.max(1, Math.min(6, Number(headingToken.tag.slice(1)) || 1))
      const baseId = makePreviewHeadingId(text, startLine)
      let id = baseId
      let suffix = 1
      while (usedHeadingIds.has(id)) id = `${baseId}-${suffix++}`
      usedHeadingIds.add(id)
      headings.push({ id, text, level, blockIndex: index, startLine })
    }
  }

  return {
    source,
    originalSource,
    originalLineOffset,
    env,
    tokens,
    blocks,
    headings,
    lineStarts,
    originalLineStarts,
    taskCount,
    requiresLegacy,
  }
}

export function renderMarkdownBlock(model: MarkdownBlockModel, block: MarkdownBlock, md: MarkdownIt): string {
  const html = (md.renderer as any).render(block.tokens, md.options, model.env) as string
  return stripStrongBoundaryGuard(html)
}

export function renderAllMarkdownBlocks(model: MarkdownBlockModel, md: MarkdownIt): string {
  return model.blocks.map(block => renderMarkdownBlock(model, block, md)).join('')
}

export class MarkdownBlockModelCache {
  private readonly models = new Map<string, MarkdownBlockModel>()

  constructor(private readonly maxEntries = 3) {}

  get(source: string): MarkdownBlockModel | null {
    const model = this.models.get(source)
    if (!model) return null
    this.models.delete(source)
    this.models.set(source, model)
    return model
  }

  set(source: string, model: MarkdownBlockModel): MarkdownBlockModel {
    this.models.delete(source)
    this.models.set(source, model)
    while (this.models.size > this.maxEntries) {
      const oldest = this.models.keys().next().value
      if (oldest === undefined) break
      this.models.delete(oldest)
    }
    return model
  }

  clear(): void {
    this.models.clear()
  }

  get size(): number {
    return this.models.size
  }
}
