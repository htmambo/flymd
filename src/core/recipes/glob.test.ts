// glob 匹配的测试
// 语义：不含 `/` 匹配文件名（任意层级）；含 `/` 匹配库内相对路径

import { describe, it, expect } from 'vitest'
import { globToRegExp, matchGlob, matchAnyGlob } from './glob'

describe('globToRegExp', () => {
  it('把 glob 转成锚定正则', () => {
    expect(globToRegExp('*.md').test('a.md')).toBe(true)
    expect(globToRegExp('*.md').test('a.txt')).toBe(false)
  })

  it('转义正则元字符', () => {
    expect(globToRegExp('a+b.md').test('a+b.md')).toBe(true)
    expect(globToRegExp('a+b.md').test('aab.md')).toBe(false)
  })
})

describe('matchGlob', () => {
  it('不含斜杠的 glob 匹配任意层级的文件名', () => {
    expect(matchGlob('*.md', 'a.md')).toBe(true)
    expect(matchGlob('*.md', '日记/今天.md')).toBe(true)
    expect(matchGlob('*.md', '日记/今天.txt')).toBe(false)
  })

  it('** 跨目录', () => {
    expect(matchGlob('**/*.md', 'a.md')).toBe(true)
    expect(matchGlob('**/*.md', 'a/b/c.md')).toBe(true)
    expect(matchGlob('**/*.md', 'a/b/c.txt')).toBe(false)
  })

  it('含斜杠的 glob 锚定在库根相对路径上', () => {
    expect(matchGlob('AI/*.md', 'AI/日报.md')).toBe(true)
    expect(matchGlob('AI/*.md', 'AI/子/日报.md')).toBe(false)
    expect(matchGlob('AI/*.md', '其它/日报.md')).toBe(false)
  })

  it('单字符通配 ?', () => {
    expect(matchGlob('a?.md', 'ab.md')).toBe(true)
    expect(matchGlob('a?.md', 'abc.md')).toBe(false)
  })

  it('空 glob 不匹配任何东西', () => {
    expect(matchGlob('', 'a.md')).toBe(false)
  })
})

describe('matchAnyGlob', () => {
  it('空列表表示不过滤', () => {
    expect(matchAnyGlob([], 'a.md')).toBe(true)
    expect(matchAnyGlob(undefined, 'a.md')).toBe(true)
  })

  it('任一命中即算命中', () => {
    expect(matchAnyGlob(['x/*.md', 'y/*.md'], 'y/b.md')).toBe(true)
    expect(matchAnyGlob(['x/*.md', 'y/*.md'], 'z/b.md')).toBe(false)
  })
})
