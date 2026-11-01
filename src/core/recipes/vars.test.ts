// 模板变量渲染与待办提取的测试

import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  extractTodos,
  formatDate,
  formatTime,
  formatDateTime,
  formatWeekday,
} from './vars'

describe('renderTemplate', () => {
  it('替换已知变量', () => {
    const r = renderTemplate('今天是 {{date}}，文件是 {{file}}', {
      date: '2026-11-01',
      file: '日记/今天.md',
    })
    expect(r.text).toBe('今天是 2026-11-01，文件是 日记/今天.md')
    expect(r.unknown).toEqual([])
  })

  it('变量名两侧允许有空白', () => {
    const r = renderTemplate('{{ date }} / {{date}}', { date: 'D' })
    expect(r.text).toBe('D / D')
  })

  it('未知变量替换为空串并被收集', () => {
    const r = renderTemplate('{{a}} {{b}} {{a}}', { a: 'A' })
    expect(r.text).toBe('A  A')
    expect(r.unknown).toEqual(['b'])
  })

  it('模板里没有占位符时原样返回', () => {
    const r = renderTemplate('纯文本', {})
    expect(r.text).toBe('纯文本')
    expect(r.unknown).toEqual([])
  })

  it('变量值为空字符串时正常替换', () => {
    const r = renderTemplate('[{{file}}]', { file: '' })
    expect(r.text).toBe('[]')
    expect(r.unknown).toEqual([])
  })
})

describe('extractTodos', () => {
  it('提取未完成待办，跳过已完成项', () => {
    const md = [
      '# 今日',
      '- [ ] 写周报',
      '- [x] 喝水',
      '* [ ] 买咖啡',
      '+ [ ] 遛狗',
      '普通段落',
      '- 不是待办',
    ].join('\n')
    expect(extractTodos(md)).toBe('写周报\n买咖啡\n遛狗')
  })

  it('没有待办时返回空串', () => {
    expect(extractTodos('普通内容')).toBe('')
    expect(extractTodos('')).toBe('')
  })
})

describe('时间格式化', () => {
  const d = new Date(2026, 10, 1, 9, 5, 7)
  it('formatDate', () => {
    expect(formatDate(d)).toBe('2026-11-01')
  })
  it('formatTime', () => {
    expect(formatTime(d)).toBe('09:05:07')
  })
  it('formatDateTime', () => {
    expect(formatDateTime(d)).toBe('2026-11-01 09:05:07')
  })
  it('formatWeekday', () => {
    expect(formatWeekday(new Date(2026, 10, 1))).toBe('星期日')
    expect(formatWeekday(new Date(2026, 10, 2))).toBe('星期一')
  })
})
