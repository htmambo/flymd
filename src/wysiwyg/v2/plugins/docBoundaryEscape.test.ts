// @vitest-environment jsdom
// docBoundaryEscape.test.ts
// 验证所见模式"文档边界逃逸"插件的纯逻辑：
// 1. 首块为 code_block/math_block 时判定为"无文本入口"块
// 2. 光标被困在首个无入口块内（TextSelection 块首 / NodeSelection 选中）时触发逃逸
// 3. 逃逸 = 文档最前插入空段落并把光标放入其中
// 4. 非被困光标（块中/非首块/普通段落文档）、修饰键按下、点击块本身等不触发
// ≥ 10 用例

import { describe, it, expect, vi } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState, TextSelection, NodeSelection, Plugin } from '@milkdown/prose/state'
import {
  firstBlockIsEntryless,
  selectionTrappedInFirstBlock,
  insertParagraphAbove,
  handleArrowUpEscape,
  handleMousedownEscape,
  appendTrailingTransaction,
} from './docBoundaryEscape'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    code_block: { group: 'block', content: 'text*', code: true, defining: true },
  },
})

function codeBlockFirstDoc() {
  return schema.node('doc', null, [
    schema.node('code_block', { language: 'js' }, schema.text('const a = 1')),
  ])
}

function paraFirstDoc() {
  return schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('hello')),
    schema.node('code_block', { language: 'js' }, schema.text('const a = 1')),
  ])
}

function fakeView(initialState: EditorState, endOfTextblock?: (dir: string) => boolean) {
  const view: any = {
    state: initialState,
    focus: () => { view.focusCalls = (view.focusCalls || 0) + 1 },
    dispatch: (tr: any) => { view.state = view.state.apply(tr) },
  }
  if (endOfTextblock) view.endOfTextblock = endOfTextblock
  return view
}

function stateWith(doc: any, pos: number) {
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
}

describe('wysiwyg/v2/plugins/docBoundaryEscape', () => {
  it('首块为 code_block 时判定为无文本入口块，段落则否', () => {
    expect(firstBlockIsEntryless(stateWith(codeBlockFirstDoc(), 1))).toBe(true)
    expect(firstBlockIsEntryless(stateWith(paraFirstDoc(), 1))).toBe(false)
  })

  it('光标位于首块 code_block 块首时判定为被困', () => {
    expect(selectionTrappedInFirstBlock(stateWith(codeBlockFirstDoc(), 1))).toBe(true)
  })

  it('光标位于首块 code_block 中间时不算被困', () => {
    expect(selectionTrappedInFirstBlock(stateWith(codeBlockFirstDoc(), 5))).toBe(false)
  })

  it('code_block 不是文档首块时（光标在其块首）不算被困', () => {
    // paragraph("hello") 占 pos 0..7，code_block 内容从 pos 8 起
    expect(selectionTrappedInFirstBlock(stateWith(paraFirstDoc(), 8))).toBe(false)
  })

  it('NodeSelection 选中首个 code_block 时判定为被困', () => {
    const doc = codeBlockFirstDoc()
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) })
    expect(selectionTrappedInFirstBlock(state)).toBe(true)
  })

  it('逃逸：在文档最前插入空段落并把光标放入其中', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1))
    expect(insertParagraphAbove(view)).toBe(true)
    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.firstChild.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild.textContent).toBe('')
    expect(view.state.doc.lastChild.type.name).toBe('code_block')
    expect(view.state.selection.from).toBe(1)
    expect(view.focusCalls).toBeGreaterThan(0)
  })

  it('↑键在被困时触发逃逸', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1), () => true)
    const ev = { key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as KeyboardEvent
    expect(handleArrowUpEscape(view, ev)).toBe(true)
    expect(view.state.doc.firstChild.type.name).toBe('paragraph')
  })

  it('光标在首块首行非零列（视觉首行）时 ↑ 也触发逃逸', () => {
    // 点击定位常落在首行第 2 字符（offset 1），只要视觉上位于首行就应逃逸
    const view = fakeView(stateWith(codeBlockFirstDoc(), 2), () => true)
    const ev = { key: 'ArrowUp' } as KeyboardEvent
    expect(handleArrowUpEscape(view, ev)).toBe(true)
    expect(view.state.doc.firstChild.type.name).toBe('paragraph')
  })

  it('视觉上不在首行（endOfTextblock=false）时 ↑ 不触发', () => {
    // 多行代码块的第 2 行（offset 5），上方仍有行可去
    const view = fakeView(stateWith(codeBlockFirstDoc(), 5), () => false)
    expect(handleArrowUpEscape(view, { key: 'ArrowUp' } as KeyboardEvent)).toBe(false)
    expect(view.state.doc.childCount).toBe(1)
  })

  it('↑键带修饰键时不触发', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1))
    const ev = { key: 'ArrowUp', shiftKey: false, altKey: false, ctrlKey: true, metaKey: false } as KeyboardEvent
    expect(handleArrowUpEscape(view, ev)).toBe(false)
    expect(view.state.doc.childCount).toBe(1)
  })

  it('非↑键或未被陷光标不触发', () => {
    const viewDown = fakeView(stateWith(codeBlockFirstDoc(), 1))
    expect(handleArrowUpEscape(viewDown, { key: 'ArrowDown' } as KeyboardEvent)).toBe(false)
    const viewMid = fakeView(stateWith(codeBlockFirstDoc(), 5))
    expect(handleArrowUpEscape(viewMid, { key: 'ArrowUp' } as KeyboardEvent)).toBe(false)
    expect(viewDown.state.doc.childCount).toBe(1)
    expect(viewMid.state.doc.childCount).toBe(1)
  })

  it('点击首块上方空白触发逃逸并阻止默认行为', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1))
    const el = document.createElement('pre')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 200, left: 0, right: 800, width: 800, height: 100,
      x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    ;(view as any).nodeDOM = () => el
    const ev = new MouseEvent('mousedown', { button: 0, clientY: 50, bubbles: true, cancelable: true })
    expect(handleMousedownEscape(view, ev)).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    expect(view.state.doc.firstChild.type.name).toBe('paragraph')
  })

  it('点击首块本身（clientY 在矩形内）不触发', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1))
    const el = document.createElement('pre')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 200, left: 0, right: 800, width: 800, height: 100,
      x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    ;(view as any).nodeDOM = () => el
    const ev = new MouseEvent('mousedown', { button: 0, clientY: 150, bubbles: true })
    expect(handleMousedownEscape(view, ev)).toBe(false)
    expect(ev.defaultPrevented).toBe(false)
    expect(view.state.doc.childCount).toBe(1)
  })

  it('首块顶部已滚出视口（rect.top<=0）时点击不触发；普通段落文档点击不触发', () => {
    const view = fakeView(stateWith(codeBlockFirstDoc(), 1))
    const el = document.createElement('pre')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 100, left: 0, right: 800, width: 800, height: 100,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    ;(view as any).nodeDOM = () => el
    expect(handleMousedownEscape(view, new MouseEvent('mousedown', { button: 0, clientY: -10 }))).toBe(false)
    expect(view.state.doc.childCount).toBe(1)

    const viewPara = fakeView(stateWith(paraFirstDoc(), 1))
    const el2 = document.createElement('p')
    vi.spyOn(el2, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 130, left: 0, right: 800, width: 800, height: 30,
      x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    ;(viewPara as any).nodeDOM = () => el2
    expect(handleMousedownEscape(viewPara, new MouseEvent('mousedown', { button: 0, clientY: 50 }))).toBe(false)
    expect(viewPara.state.doc.childCount).toBe(2)
  })

  it('末尾无入口块时追加空段落事务，且带 addToHistory:false（listener 跳过的前提）', () => {
    const tr = appendTrailingTransaction(stateWith(codeBlockFirstDoc(), 1))
    expect(tr).not.toBeNull()
    expect(tr!.getMeta('addToHistory')).toBe(false)
    const next = tr!.doc
    expect(next.lastChild?.type.name).toBe('paragraph')
    expect(next.lastChild?.textContent).toBe('')
  })

  it('末尾是段落/标题时无需追加', () => {
    const paraEnd = schema.node('doc', null, [schema.node('paragraph', null, schema.text('hi'))])
    expect(appendTrailingTransaction(stateWith(paraEnd, 1))).toBeNull()
    const headingEnd = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('hi')),
      schema.node('paragraph', null, schema.text('h')),
    ])
    expect(appendTrailingTransaction(stateWith(headingEnd, 1))).toBeNull()
  })

  it('appendTransaction 集成：空事务后文档末尾自动获得空段落，且该变化不再追加（收敛）', () => {
    const plugin = new Plugin({
      appendTransaction: (_trs, _old, state) => appendTrailingTransaction(state),
    })
    const state = EditorState.create({ doc: codeBlockFirstDoc(), plugins: [plugin] })
    // 模拟初始化规范化：派发一次空事务触发 appendTransaction
    let tr = state.tr
    let nextState = state.apply(tr)
    expect(nextState.doc.lastChild?.type.name).toBe('paragraph')
    // 再次空事务：末尾已是段落，不再追加（防循环）
    const again = appendTrailingTransaction(nextState)
    expect(again).toBeNull()
  })
})
