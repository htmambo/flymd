import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { scanTaskList, hasTaskListCandidate, applyMdTaskListPlugin } from './markdownItTaskList'

describe('hasTaskListCandidate（renderPreview 条件化预检）', () => {
  it('命中 `- [ ]` 形式', () => {
    expect(hasTaskListCandidate('- [ ] todo')).toBe(true)
    expect(hasTaskListCandidate('# t\n- [ ] todo\n')).toBe(true)
  })
  it('命中 `1) [x]` 形式（有序列表右括号）', () => {
    expect(hasTaskListCandidate('1) [x] done')).toBe(true)
    expect(hasTaskListCandidate('12) [ ] todo')).toBe(true)
  })
  it('命中 `1. [ ]` 形式（有序列表点号）', () => {
    expect(hasTaskListCandidate('1. [ ] todo')).toBe(true)
  })
  it('命中 `+ [ ]` / `* [X]` 形式', () => {
    expect(hasTaskListCandidate('+ [ ] a')).toBe(true)
    expect(hasTaskListCandidate('* [X] b')).toBe(true)
  })
  it('命中 blockquote 内的任务行（`>` 前缀，可多级嵌套）', () => {
    expect(hasTaskListCandidate('> - [ ] quoted')).toBe(true)
    expect(hasTaskListCandidate('> > 1. [x] nested quote')).toBe(true)
    expect(hasTaskListCandidate('text\n> * [ ] mixed\n')).toBe(true)
  })
  it('命中嵌套缩进任务（空格与 Tab）', () => {
    expect(hasTaskListCandidate('  - [ ] nested')).toBe(true)
    expect(hasTaskListCandidate('    - [x] deep')).toBe(true)
    expect(hasTaskListCandidate('\t- [ ] tab indent')).toBe(true)
    expect(hasTaskListCandidate('- a\n  - [ ] nested')).toBe(true)
  })
  it('不命中普通文本与标题', () => {
    expect(hasTaskListCandidate('# Hello\nworld\n')).toBe(false)
    expect(hasTaskListCandidate('- plain item\n* another\n1. ordered\n')).toBe(false)
    expect(hasTaskListCandidate('')).toBe(false)
  })
  it('代码块内伪任务行：预检偏宽命中（无害），scanTaskList 的 fence 语义保持不变', () => {
    const fenced = '```md\n- [ ] pseudo task in fence\n```\n'
    expect(hasTaskListCandidate(fenced)).toBe(true)
    expect(scanTaskList(fenced)).toEqual([])
  })
  it('围栏外的真实任务仍被 scanTaskList 找到', () => {
    const md = '```\n- [ ] pseudo\n```\n\n- [ ] real\n'
    expect(hasTaskListCandidate(md)).toBe(true)
    expect(scanTaskList(md)).toEqual([{ line: 4, ch: 3 }])
  })
})

describe('预检 × 扫描对齐（FR-2：偏窄漏扫会破坏输出等价性）', () => {
  // 关键不变式:scanTaskList 非空 ⇒ 预检必命中。
  // 反过来(预检命中但 scan 为空)是偏宽方向,无害,不做断言。
  const fixturesWithTasks = [
    '- [ ] a',
    '- [x] a',
    '- [X] a',
    '1. [ ] a',
    '1) [x] a',
    '99. [X] a',
    '  - [ ] nested',
    '\t- [ ] tab',
    '# h\n\n- [ ] after heading\n',
    'para\n\n- [ ] after para\n\n```\n- [ ] pseudo in fence\n```\n',
    '- [ ] first\n- [x] second\n  - [ ] nested\n',
  ]
  it.each(fixturesWithTasks)('scanTaskList 非空 ⇒ 预检命中: %j', (md) => {
    expect(scanTaskList(md).length).toBeGreaterThan(0)
    expect(hasTaskListCandidate(md)).toBe(true)
  })

  const fixturesWithoutTasks = [
    '# Hello\nworld\n',
    '- plain\n- items\n',
    '1. ordered\n2) ordered\n',
    'text with [ ] bracket but no list marker\n',
    '',
  ]
  it.each(fixturesWithoutTasks)('预检不命中 ⇒ scanTaskList 为空: %j', (md) => {
    expect(hasTaskListCandidate(md)).toBe(false)
    expect(scanTaskList(md)).toEqual([])
  })
})

// —— 以下为 HEAD 既有用例（Phase 4 代码质量复审发现重写时误删，原样恢复）——

describe('scanTaskList（基础语义）', () => {
  it('returns empty for empty input', () => {
    expect(scanTaskList('')).toEqual([])
  })
  it('finds a single unchecked task', () => {
    expect(scanTaskList('- [ ] todo')).toEqual([{ line: 0, ch: 3 }])
  })
  it('finds checked tasks (x / X)', () => {
    expect(scanTaskList('- [x] done')).toEqual([{ line: 0, ch: 3 }])
    expect(scanTaskList('- [X] done')).toEqual([{ line: 0, ch: 3 }])
  })
  it('handles multiple list markers (-, +, *, 1.)', () => {
    expect(scanTaskList('- [ ] a\n+ [ ] b\n* [ ] c\n1. [ ] d')).toEqual([
      { line: 0, ch: 3 },
      { line: 1, ch: 3 },
      { line: 2, ch: 3 },
      { line: 3, ch: 4 },
    ])
  })
  it('skips fenced code blocks', () => {
    expect(scanTaskList('```\n- [ ] ignored\n```\n- [ ] real')).toEqual([{ line: 3, ch: 3 }])
  })
  it('handles tilde fences too', () => {
    expect(scanTaskList('~~~\n- [ ] ignored\n~~~\n- [ ] real')).toEqual([{ line: 3, ch: 3 }])
  })
  it('different fence chars do not close each other', () => {
    expect(scanTaskList('```\n- [ ] ignored\n~~~\n- [ ] real')).toEqual([])
  })
  it('returns empty for non-task lines', () => {
    expect(scanTaskList('# Title\nplain text\n- not a task\n- regular item')).toEqual([])
  })
  it('respects leading indent (no limit beyond \\s*)', () => {
    expect(scanTaskList('   - [ ] a\n    - [ ] b')).toEqual([
      { line: 0, ch: 6 },
      { line: 1, ch: 7 },
    ])
  })
  it('does not throw on weird input', () => {
    expect(scanTaskList(null as any)).toEqual([])
  })
})

describe('applyMdTaskListPlugin（markdown-it 渲染）', () => {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  applyMdTaskListPlugin(md)

  it('renders unchecked task with checkbox input', () => {
    const html = md.render('- [ ] todo')
    expect(html).toContain('task-list-item')
    expect(html).toContain('task-list')
    expect(html).toContain('<input class="task-list-item-checkbox" type="checkbox">')
  })
  it('renders checked task with checked attribute', () => {
    const html = md.render('- [x] done')
    expect(html).toContain('type="checkbox" checked')
  })
  it('preserves text after checkbox', () => {
    const html = md.render('- [ ] hello world')
    expect(html).toContain('hello world')
  })
  it('does not affect regular list items', () => {
    const html = md.render('- normal item')
    expect(html).not.toContain('task-list-item-checkbox')
  })
  it('handles nested task lists', () => {
    const html = md.render('- [ ] outer\n  - [ ] inner')
    expect(html.match(/task-list-item/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
