import type { Extension } from '@codemirror/state'
import { Cm6Editor, type Cm6Snapshot } from './cm6Editor'

export interface Cm6ModeHostDeps {
  container: HTMLElement
  editor: HTMLTextAreaElement
  extensions?: Extension[]
}

export class Cm6ModeHost {
  private readonly engine: Cm6Editor
  private syncing = false
  private pendingSync = false
  private destroyed = false
  private lastSnapshot: Cm6Snapshot | null = null

  private constructor(readonly root: HTMLDivElement, private readonly textarea: HTMLTextAreaElement, extensions: Extension[] = []) {
    this.engine = new Cm6Editor({
      parent: root,
      document: textarea.value,
      extensions,
      onChange: ({ text, external }) => {
        if (this.destroyed || this.syncing) return
        this.syncing = true
        try {
          if (this.textarea.value === text) return
          this.textarea.value = text
          if (!external) this.textarea.dispatchEvent(new Event('input', { bubbles: true }))
        } finally {
          this.syncing = false
        }
      },
      onSelectionChange: (anchor, head) => {
        if (this.destroyed || this.syncing) return
        this.textarea.selectionStart = anchor
        this.textarea.selectionEnd = head
      },
    })
    this.root.addEventListener('compositionend', () => {
      if (this.destroyed || !this.pendingSync) return
      this.pendingSync = false
      this.syncFromTextarea()
    })
  }

  static async create(deps: Cm6ModeHostDeps): Promise<Cm6ModeHost> {
    const root = document.createElement('div')
    root.id = 'md-cm6-root'
    root.className = 'cm6-editor-host'
    deps.container.appendChild(root)
    return new Cm6ModeHost(root, deps.editor, deps.extensions)
  }

  get isComposing(): boolean {
    return this.engine.composing
  }

  getDoc(): string {
    return this.engine.getDoc()
  }

  getScrollTop(): number {
    return this.engine.getScrollTop()
  }

  setScrollTop(top: number): void {
    this.engine.setScrollTop(top)
  }

  setSelection(anchor: number, head = anchor): void {
    this.engine.setSelection(anchor, head)
  }

  focus(): void {
    this.engine.focus()
  }

  syncFromTextarea(): void {
    if (this.destroyed || this.syncing) return
    if (this.isComposing) {
      this.pendingSync = true
      return
    }
    const text = this.textarea.value
    if (this.engine.getDoc() === text) return
    const scrollTop = this.getScrollTop()
    this.syncing = true
    try {
      this.engine.replaceDocument(text, {
        anchor: this.textarea.selectionStart,
        head: this.textarea.selectionEnd,
      })
      this.setScrollTop(scrollTop)
    } finally {
      this.syncing = false
    }
  }

  snapshot(): Cm6Snapshot {
    return this.lastSnapshot || this.engine.snapshot()
  }

  destroy(): Cm6Snapshot {
    if (this.destroyed) return this.lastSnapshot!
    this.destroyed = true
    const pendingSnapshot: Cm6Snapshot | null = this.pendingSync ? {
      text: this.textarea.value,
      anchor: this.textarea.selectionStart,
      head: this.textarea.selectionEnd,
      scrollTop: this.getScrollTop(),
    } : null
    this.pendingSync = false
    let engineSnapshot: Cm6Snapshot | null = null
    try { engineSnapshot = this.engine.destroy() } catch {}
    const snapshot = pendingSnapshot || engineSnapshot || {
      text: this.textarea.value,
      anchor: this.textarea.selectionStart,
      head: this.textarea.selectionEnd,
      scrollTop: this.getScrollTop(),
    }
    this.lastSnapshot = snapshot
    const previousSyncing = this.syncing
    this.syncing = true
    try {
      this.textarea.value = snapshot.text
      this.textarea.setSelectionRange(snapshot.anchor, snapshot.head, snapshot.anchor > snapshot.head ? 'backward' : 'forward')
      this.textarea.scrollTop = snapshot.scrollTop
    } finally {
      this.syncing = previousSyncing
      this.root.remove()
    }
    return snapshot
  }
}
