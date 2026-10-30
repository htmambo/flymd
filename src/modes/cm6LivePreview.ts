import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

export type Cm6WidgetKind = 'math' | 'mermaid'

export interface Cm6Block {
  from: number
  to: number
  kind: Cm6WidgetKind
  source: string
}

interface ViewInfo {
  ranges: readonly { from: number; to: number }[]
  composing: boolean
}

export interface Cm6LivePreviewDeps {
  render: (element: HTMLElement, kind: Cm6WidgetKind, source: string) => void | Promise<void>
}

export function parseCm6Blocks(document: string): Cm6Block[] {
  const lines = document.split('\n')
  const blocks: Cm6Block[] = []
  let offset = 0
  let open: { from: number; marker: string; kind: Cm6WidgetKind; lines: string[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const structural = line.replace(/^[\s>]+/, '').trim()
    if (open) {
      const isFenceClose = /^(`{3,}|~{3,})$/.test(structural) && structural[0] === open.marker[0] && structural.length >= open.marker.length
      const isMathClose = open.kind === 'math' && open.marker === '$$' && structural === '$$'
      if (isFenceClose || isMathClose) {
        blocks.push({
          from: open.from,
          to: offset + line.length,
          kind: open.kind,
          source: open.lines.join('\n'),
        })
        open = null
      } else {
        open.lines.push(line)
      }
    } else {
      const fence = line.match(/^[\s>]*(`{3,}|~{3,})(mermaid|math|katex|latex)(?:\s+.*)?$/i)
      if (fence) {
        open = { from: offset, marker: fence[1], kind: fence[2].toLowerCase() === 'mermaid' ? 'mermaid' : 'math', lines: [] }
      } else if (structural === '$$') {
        open = { from: offset, marker: '$$', kind: 'math', lines: [] }
      }
    }
    offset += line.length + 1
  }
  return blocks
}

const setViewInfo = StateEffect.define<ViewInfo>()

const viewInfoField = StateField.define<ViewInfo>({
  create: () => ({ ranges: [], composing: false }),
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setViewInfo)) return effect.value
    }
    return value
  },
})

const blocksField = StateField.define<Cm6Block[]>({
  create: state => parseCm6Blocks(state.doc.toString()),
  update: (blocks, transaction) => transaction.docChanged ? parseCm6Blocks(transaction.state.doc.toString()) : blocks,
})

class Cm6BlockWidget extends WidgetType {
  constructor(
    private readonly kind: Cm6WidgetKind,
    private readonly source: string,
    private readonly deps: Cm6LivePreviewDeps,
    private readonly reveal: () => void,
  ) {
    super()
  }

  override eq(other: Cm6BlockWidget): boolean {
    return this.kind === other.kind && this.source === other.source
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('div')
    element.className = `cm6-rendered-block cm6-rendered-${this.kind}`
    element.setAttribute('role', 'button')
    element.setAttribute('aria-label', `${this.kind === 'mermaid' ? '图表' : '公式'}渲染块，点击编辑源码`)
    element.tabIndex = 0
    const reveal = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      this.reveal()
    }
    element.addEventListener('mousedown', reveal)
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') reveal(event)
    })
    element.textContent = '正在渲染…'
    queueMicrotask(() => {
      if (!element.isConnected) return
      try {
        void Promise.resolve(this.deps.render(element, this.kind, this.source)).catch(() => {
          if (element.isConnected) element.textContent = this.source
        })
      } catch {
        element.textContent = this.source
      }
    })
    return element
  }

  override ignoreEvent(): boolean {
    return false
  }
}

function buildDecorations(state: EditorState, deps: Cm6LivePreviewDeps, reveal: (from: number) => void): DecorationSet {
  const info = state.field(viewInfoField)
  if (info.composing) return Decoration.none
  const selection = state.selection.main
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of state.field(blocksField)) {
    const fullyVisible = info.ranges.some(range => range.from <= block.from && range.to >= block.to)
    if (!fullyVisible) continue
    const active = selection.from <= block.to && selection.to >= block.from
    if (active) continue
    builder.add(block.from, block.to, Decoration.replace({ widget: new Cm6BlockWidget(block.kind, block.source, deps, () => reveal(block.from)) }))
  }
  return builder.finish()
}

export function createCm6LivePreview(deps: Cm6LivePreviewDeps): Extension[] {
  let editorView: EditorView | null = null
  const reveal = (from: number) => {
    if (!editorView) return
    editorView.dispatch({ selection: { anchor: from } })
    editorView.focus()
  }
  const widgetsField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (_decorations, transaction) => buildDecorations(transaction.state, deps, reveal),
  })
  const viewportPlugin = ViewPlugin.fromClass(class {
    private pending = false
    private destroyed = false

    constructor(private readonly view: EditorView) {
      editorView = view
      this.schedule()
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.schedule()
    }

    private schedule(): void {
      if (this.pending || this.destroyed) return
      this.pending = true
      queueMicrotask(() => {
        this.pending = false
        if (this.destroyed) return
        this.view.dispatch({ effects: setViewInfo.of({ ranges: this.view.visibleRanges, composing: this.view.composing }) })
      })
    }

    destroy(): void {
      this.destroyed = true
      editorView = null
    }
  })
  return [viewInfoField, blocksField, widgetsField, EditorView.decorations.from(widgetsField), viewportPlugin]
}
