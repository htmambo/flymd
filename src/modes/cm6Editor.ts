import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Annotation, Transaction } from '@codemirror/state'
import { getSourceLineNumbersEnabled } from '../core/sourceLineNumbersPref'
import './cm6Editor.css'

const externalTransaction = Annotation.define<boolean>()

/** 空扩展集：用于关闭 CM6 行号栏（Compartment 重配置的目标） */
const NO_EXTENSIONS: Extension = []
/** 行号扩展缓存：复用同一实例，避免每次切换都重建扩展并触发全量 facet 重算 */
const LINE_NUMBERS_EXTENSION: Extension = lineNumbers()

export interface Cm6Change {
  text: string
  external: boolean
}

export interface Cm6Snapshot {
  text: string
  anchor: number
  head: number
  scrollTop: number
}

export interface Cm6EditorDeps {
  parent: HTMLElement
  document: string
  onChange: (change: Cm6Change) => void
  onSelectionChange?: (anchor: number, head: number) => void
  extensions?: Extension[]
  /** 行号栏开关；缺省按「源码行号」偏好 */
  lineNumbers?: boolean
}

export function isCm6TextCompatible(text: string): boolean {
  const hasCrlf = /\r\n/.test(text)
  const hasBareCr = /\r(?!\n)/.test(text)
  const hasBareLf = /(^|[^\r])\n/.test(text)
  return [hasCrlf, hasBareCr, hasBareLf].filter(Boolean).length <= 1
}

function lineSeparatorFor(text: string): string {
  if (text.includes('\r\n')) return '\r\n'
  if (text.includes('\r')) return '\r'
  return '\n'
}

function clampOffset(offset: number, length: number): number {
  if (Number.isNaN(offset) || offset === Number.NEGATIVE_INFINITY) return 0
  if (offset === Number.POSITIVE_INFINITY) return length
  return Math.max(0, Math.min(length, Math.trunc(offset)))
}

function cmOffsetFor(text: string, offset: number): number {
  const safe = clampOffset(offset, text.length)
  if (!text.includes('\r\n')) return safe
  return text.slice(0, safe).replace(/\r\n|\r/g, '\n').length
}

function rawOffsetFor(text: string, separator: string): number {
  return separator === '\r\n' ? text.replace(/\n/g, separator).length : text.length
}

export class Cm6Editor {
  private readonly view: EditorView
  private lineSeparator: string
  private destroyed = false
  /** 行号栏扩展单独占一个 compartment：偏好变更时可随时增删，不动文档与选择区 */
  private readonly lineNumbersCompartment = new Compartment()
  private lineNumbersEnabled = false

  constructor(deps: Cm6EditorDeps) {
    if (!isCm6TextCompatible(deps.document)) throw new Error('CM6 不支持混合行尾，请使用源码模式')
    this.lineSeparator = lineSeparatorFor(deps.document)
    const lineNumbersEnabled = deps.lineNumbers ?? getSourceLineNumbersEnabled()
    this.lineNumbersEnabled = lineNumbersEnabled
    const state = EditorState.create({
      doc: deps.document,
      extensions: [
        EditorState.lineSeparator.of(this.lineSeparator),
        this.lineNumbersCompartment.of(lineNumbersEnabled ? LINE_NUMBERS_EXTENSION : NO_EXTENSIONS),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.updateListener.of(update => {
          if (this.destroyed) return
          if (update.docChanged) {
            const external = update.transactions.some(transaction => transaction.annotation(externalTransaction) === true)
            deps.onChange({ text: this.getDoc(), external })
          }
          if (update.selectionSet) {
            const selection = this.getSelection()
            deps.onSelectionChange?.(selection.anchor, selection.head)
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflowAnchor: 'none' },
          '.cm-content': { padding: '14px 0 40vh' },
          '.cm-line': { padding: '0 12px' },
          '.cm-gutters': { border: 'none' },
        }),
        ...(deps.extensions || []),
      ],
    })
    this.view = new EditorView({ state, parent: deps.parent })
  }

  get dom(): HTMLElement {
    return this.view.dom
  }

  get composing(): boolean {
    return this.view.composing
  }

  getDoc(): string {
    return this.view.state.doc.sliceString(0, this.view.state.doc.length, this.lineSeparator)
  }

  getSelection(): { anchor: number; head: number } {
    const selection = this.view.state.selection.main
    return {
      anchor: rawOffsetFor(this.view.state.doc.sliceString(0, selection.anchor, '\n'), this.lineSeparator),
      head: rawOffsetFor(this.view.state.doc.sliceString(0, selection.head, '\n'), this.lineSeparator),
    }
  }

  setSelection(anchor: number, head = anchor): void {
    const source = this.getDoc()
    const safeAnchor = Math.max(0, Math.min(source.length, anchor))
    const safeHead = Math.max(0, Math.min(source.length, head))
    this.view.dispatch({
      selection: EditorSelection.single(cmOffsetFor(source, safeAnchor), cmOffsetFor(source, safeHead)),
    })
  }

  /** 显隐 CM6 行号栏：重配置行号扩展本身，而不是用 CSS 藏掉（藏掉会留下 gutter 占位空白） */
  setLineNumbersEnabled(enabled: boolean): void {
    if (this.destroyed || enabled === this.lineNumbersEnabled) return
    this.lineNumbersEnabled = enabled
    this.view.dispatch({
      effects: this.lineNumbersCompartment.reconfigure(enabled ? LINE_NUMBERS_EXTENSION : NO_EXTENSIONS),
    })
  }

  replaceDocument(text: string, selection?: { anchor: number; head: number }): void {
    if (!isCm6TextCompatible(text)) throw new Error('CM6 不支持混合行尾，请使用源码模式')
    this.lineSeparator = lineSeparatorFor(text)
    const current = this.getSelection()
    const rawAnchor = Math.max(0, Math.min(text.length, selection?.anchor ?? current.anchor))
    const rawHead = Math.max(0, Math.min(text.length, selection?.head ?? current.head))
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.single(cmOffsetFor(text, rawAnchor), cmOffsetFor(text, rawHead)),
      annotations: [externalTransaction.of(true), Transaction.addToHistory.of(false)],
    })
  }

  getScrollTop(): number {
    return this.view.scrollDOM.scrollTop
  }

  setScrollTop(top: number): void {
    this.view.scrollDOM.scrollTop = Math.max(0, top)
  }

  focus(): void {
    this.view.focus()
  }

  undo(): boolean {
    return undo(this.view)
  }

  redo(): boolean {
    return redo(this.view)
  }

  snapshot(): Cm6Snapshot {
    const selection = this.getSelection()
    return {
      text: this.getDoc(),
      anchor: selection.anchor,
      head: selection.head,
      scrollTop: this.getScrollTop(),
    }
  }

  destroy(): Cm6Snapshot {
    const snapshot = this.snapshot()
    this.destroyed = true
    this.view.destroy()
    return snapshot
  }
}
