// Milkdown Callout 插件：支持 Obsidian 风格的 Callout 语法
// 在 WYSIWYG 模式下将 >[!type] 语法的 blockquote 渲染为 Callout 卡片

import { $node, $remark, $view } from '@milkdown/utils'
import type { Ctx } from '@milkdown/ctx'
import type { Node } from '@milkdown/prose/model'
import type { EditorView, NodeView } from '@milkdown/prose/view'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

// ---- 常量与工具 ----

const CALLOUT_REGEX = /^\[!(.+?)\]([+-]?)\s*(.*)$/

const TYPE_ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

function normalizeType(type: string): string {
  const t = type.toLowerCase().trim()
  return TYPE_ALIASES[t] || t
}

// 名称保留(用于 diff 收敛):实际上返回的是文字 label 而非 SVG。
// 沿用 .code-copy 的"复制"按钮文案 + 1.2s 还原反馈(对齐 codeCopyEvents)。
function getCopyIconSvg(): string {
  return '复制'
}

function getFoldIconSvg(folded: boolean): string {
  // chevron-down / chevron-right
  if (folded) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
}

function getIconSvg(type: string): string {
  const t = normalizeType(type)
  const icons: Record<string, string> = {
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
  return icons[t] || icons.note
}

// ---- remark 插件：在 MDAST 层面识别 callout ----

function remarkCalloutPlugin() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: any, index: number | undefined, parent: any) => {
      if (index == null || !parent) return
      if (!node.children || node.children.length === 0) return

      const firstChild = node.children[0]
      if (firstChild.type !== 'paragraph' || !firstChild.children || firstChild.children.length === 0) return

      const textNode = firstChild.children[0]
      if (textNode.type !== 'text') return

      const match = String(textNode.value || '').match(CALLOUT_REGEX)
      if (!match) return

      const rawType = match[1]
      const foldMarker = match[2]
      const title = match[3] || ''
      const normalizedType = normalizeType(rawType)
      const foldable = !!foldMarker
      const folded = foldMarker === '-'

      // 从首段移除 callout 标记
      const remaining = String(textNode.value).replace(CALLOUT_REGEX, '')
      textNode.value = remaining

      // 如果首段变为空且只有这一个子节点，移除首段
      if (!remaining && firstChild.children.length === 1) {
        node.children.shift()
      } else if (!remaining && firstChild.children.length > 1) {
        firstChild.children.shift()
      }

      // 替换为 callout 节点
      const calloutNode = {
        type: 'callout',
        data: {
          calloutType: normalizedType,
          title,
          foldable,
          folded,
        },
        children: node.children,
      }
      parent.children[index] = calloutNode as any
    })
  }
}

export const calloutRemark = $remark('calloutRemark', () => remarkCalloutPlugin)

// ---- Callout 节点定义 ----

export const calloutNode = $node('callout', () => ({
  group: 'block',
  content: 'block+',
  attrs: {
    type: { default: 'note' },
    title: { default: '' },
    foldable: { default: false },
    folded: { default: false },
  },
  parseDOM: [
    {
      tag: 'div[data-callout]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          type: el.getAttribute('data-callout') || 'note',
          title: el.getAttribute('data-callout-title') || '',
          foldable: el.hasAttribute('data-foldable'),
          folded: el.getAttribute('data-folded') === 'true',
        }
      },
    },
  ],
  toDOM: (node) => {
    const { type, title, foldable, folded } = node.attrs
    const attrs: Record<string, string> = {
      'data-callout': String(type),
      class: 'callout' + (folded ? ' folded' : ''),
    }
    if (title) attrs['data-callout-title'] = String(title)
    if (foldable) {
      attrs['data-foldable'] = 'true'
      attrs['data-folded'] = String(folded)
    }
    return ['div', attrs, 0]
  },
  parseMarkdown: {
    match: (node) => node.type === 'callout',
    runner: (state, node, type) => {
      const data = (node as any).data || {}
      state.openNode(type, {
        type: data.calloutType || 'note',
        title: data.title || '',
        foldable: !!data.foldable,
        folded: !!data.folded,
      })
      state.next(node.children as any)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'callout',
    runner: (state, node) => {
      const { type, title, foldable, folded } = node.attrs
      const marker = `[!${type}]${foldable ? (folded ? '-' : '+') : ''}`
      const fullTitle = title ? `${marker} ${title}` : marker

      // 构建 blockquote MDAST
      state.openNode('blockquote')
      state.addNode('paragraph', [{ type: 'text', value: fullTitle }])
      node.forEach((child) => {
        state.next(child)
      })
      state.closeNode()
    },
  },
}))

// ---- NodeView：带折叠交互的渲染 ----

class CalloutNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private node: Node
  private view: EditorView
  private getPos: () => number | undefined

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    const { type, title, foldable, folded } = node.attrs
    const typeStr = String(type || 'note')
    const titleStr = String(title || '')
    const isFoldable = !!foldable
    const isFolded = !!folded

    // 外层容器
    const container = document.createElement('div')
    container.className = 'callout' + (isFolded ? ' folded' : '')
    container.dataset.callout = typeStr
    if (titleStr) container.dataset.calloutTitle = titleStr
    if (isFoldable) {
      container.dataset.foldable = 'true'
      container.dataset.folded = String(isFolded)
    }

    // 标题栏
    const titleBar = document.createElement('div')
    titleBar.className = 'callout-title'
    titleBar.contentEditable = 'false'

    const iconWrap = document.createElement('div')
    iconWrap.className = 'callout-icon'
    iconWrap.innerHTML = getIconSvg(typeStr)
    titleBar.appendChild(iconWrap)

    const titleInner = document.createElement('div')
    titleInner.className = 'callout-title-inner'
    titleInner.textContent = titleStr || (typeStr.charAt(0).toUpperCase() + typeStr.slice(1))
    titleBar.appendChild(titleInner)

    if (isFoldable) {
      const foldBtn = document.createElement('div')
      foldBtn.className = 'callout-fold-icon'
      foldBtn.innerHTML = getFoldIconSvg(isFolded)
      foldBtn.contentEditable = 'false'
      foldBtn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.toggleFold()
      })
      titleBar.appendChild(foldBtn)
    }

    const copyBtn = document.createElement('div')
    copyBtn.className = 'callout-copy-icon'
    copyBtn.title = '复制内容'
    copyBtn.textContent = getCopyIconSvg()
    copyBtn.contentEditable = 'false'
    copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.copyContent()
    })
    titleBar.appendChild(copyBtn)

    container.appendChild(titleBar)

    // 内容区（ProseMirror 子节点挂载到这里）
    const content = document.createElement('div')
    content.className = 'callout-content'
    if (isFolded) content.style.display = 'none'
    container.appendChild(content)

    this.dom = container
    this.contentDOM = content
  }

  private toggleFold() {
    const pos = this.getPos()
    if (pos == null) return

    const tr = this.view.state.tr.setNodeAttribute(pos, 'folded', !this.node.attrs.folded)
    this.view.dispatch(tr)
  }

  private copyContent() {
    try {
      const texts: string[] = []
      this.contentDOM.querySelectorAll(':scope > *').forEach((el) => {
        const text = (el as HTMLElement).innerText || ''
        const trimmed = text.trim()
        if (trimmed) texts.push(trimmed)
      })
      const result = texts.join('\n\n')
      if (!result) return
      void (async () => {
        let ok = false
        try { await navigator.clipboard.writeText(result); ok = true } catch {}
        if (!ok) return
        const btn = this.dom.querySelector('.callout-copy-icon') as HTMLElement | null
        if (!btn) return
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1200)
      })()
    } catch {}
  }

  update(node: Node): boolean {
    if (node.type.name !== 'callout') return false
    // 如果折叠状态或类型变化，更新 DOM
    const oldFolded = !!this.node.attrs.folded
    const newFolded = !!node.attrs.folded
    const oldType = String(this.node.attrs.type)
    const newType = String(node.attrs.type)
    const oldTitle = String(this.node.attrs.title)
    const newTitle = String(node.attrs.title)

    if (oldFolded !== newFolded) {
      if (newFolded) {
        this.dom.classList.add('folded')
        this.dom.dataset.folded = 'true'
        this.contentDOM.style.display = 'none'
      } else {
        this.dom.classList.remove('folded')
        this.dom.dataset.folded = 'false'
        this.contentDOM.style.display = ''
      }
      const foldBtn = this.dom.querySelector('.callout-fold-icon')
      if (foldBtn) foldBtn.innerHTML = getFoldIconSvg(newFolded)
    }

    if (oldType !== newType) {
      this.dom.dataset.callout = newType
      const iconWrap = this.dom.querySelector('.callout-icon')
      if (iconWrap) iconWrap.innerHTML = getIconSvg(newType)
    }

    if (oldTitle !== newTitle) {
      const titleInner = this.dom.querySelector('.callout-title-inner')
      if (titleInner) {
        titleInner.textContent = newTitle || (newType.charAt(0).toUpperCase() + newType.slice(1))
      }
      if (newTitle) this.dom.dataset.calloutTitle = newTitle
      else delete this.dom.dataset.calloutTitle
    }

    this.node = node
    return true
  }

  ignoreMutation(record: any): boolean {
    // 标题栏上的点击/修改不应触发 ProseMirror 重渲染
    const target = record.target as HTMLElement | null
    if (!target) return false
    if (target === this.dom.querySelector('.callout-title')) return true
    if (target.closest?.('.callout-title')) return true
    return false
  }

  stopEvent(event: Event): boolean {
    // 拦截折叠按钮的点击事件，避免 ProseMirror 处理
    const target = event.target as HTMLElement
    if (target?.closest?.('.callout-fold-icon')) return true
    if (target?.closest?.('.callout-title') && event.type === 'mousedown') {
      // 允许标题栏上的 selection 行为，但阻止其作为编辑目标
      return false
    }
    return false
  }
}

export const calloutViewPlugin = $view(calloutNode, (_ctx: Ctx) => {
  return (node: Node, view: EditorView, getPos: () => number | undefined) => {
    return new CalloutNodeView(node, view, getPos) as NodeView
  }
})
