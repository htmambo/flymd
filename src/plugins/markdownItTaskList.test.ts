import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { scanTaskList, applyMdTaskListPlugin } from './markdownItTaskList'

describe('scanTaskList', () => {
  it('returns empty for empty input', () => {
    expect(scanTaskList('')).toEqual([])
  })
  it('finds a single unchecked task', () => {
    const md = '- [ ] todo'
    expect(scanTaskList(md)).toEqual([{ line: 0, ch: 3 }])
  })
  it('finds a checked task (lowercase x)', () => {
    const md = '- [x] done'
    expect(scanTaskList(md)).toEqual([{ line: 0, ch: 3 }])
  })
  it('finds a checked task (uppercase X)', () => {
    const md = '- [X] done'
    expect(scanTaskList(md)).toEqual([{ line: 0, ch: 3 }])
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
    const md = '```\n- [ ] ignored\n```\n- [ ] real'
    expect(scanTaskList(md)).toEqual([{ line: 3, ch: 3 }])
  })
  it('handles tilde fences too', () => {
    const md = '~~~\n- [ ] ignored\n~~~\n- [ ] real'
    expect(scanTaskList(md)).toEqual([{ line: 3, ch: 3 }])
  })
  it('handles different fence chars by closing on match', () => {
    // 反引号开 + tilde 关(同 fence 字符才闭)→ 反引号开,波浪不关,继续
    // 但 tilde 那行被 fenceOpen=true 拦下,real 行又开过吗?fenceOpen 已 true 不会重开
    // 实际实现:tilde 是另一个字符,主 fence state 不动
    const md = '```\n- [ ] ignored\n~~~\n- [ ] real'
    // fence 仍开,real 被拦,期望 []
    expect(scanTaskList(md)).toEqual([])
  })
  it('returns empty for non-task lines', () => {
    const md = '# Title\nplain text\n- not a task\n- regular item'
    expect(scanTaskList(md)).toEqual([])
  })
  it('respects leading indent (no limit beyond \\s*)', () => {
    // 实现用 ^(\s*) 贪婪匹配,4 空格也算"task"(用于嵌套列表点击穿透)
    const md = '   - [ ] a\n    - [ ] b'
    expect(scanTaskList(md)).toEqual([
      { line: 0, ch: 6 },
      { line: 1, ch: 7 },
    ])
  })
  it('does not throw on weird input', () => {
    expect(scanTaskList(null as any)).toEqual([])
  })
})

describe('applyMdTaskListPlugin', () => {
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
