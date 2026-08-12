import { describe, it, expect } from 'vitest'
import { splitYamlFrontMatter, parseFrontMatterMeta } from './frontMatter'

const BOM = '﻿'

describe('splitYamlFrontMatter', () => {
  it('returns null front matter for empty input', () => {
    expect(splitYamlFrontMatter('')).toEqual({ frontMatter: null, body: '' })
  })
  it('returns null front matter for non-front-matter content', () => {
    const md = '# Hello\nworld\n'
    expect(splitYamlFrontMatter(md)).toEqual({ frontMatter: null, body: md })
  })
  it('returns null front matter when only opening fence present', () => {
    const md = '---\ntitle: hi\n'
    expect(splitYamlFrontMatter(md)).toEqual({ frontMatter: null, body: md })
  })
  it('returns null front matter when content between fences is not key:value', () => {
    const md = '---\njust a paragraph, not yaml\n---\nbody\n'
    expect(splitYamlFrontMatter(md)).toEqual({ frontMatter: null, body: md })
  })
  it('extracts front matter with key:value block', () => {
    const md = '---\ntitle: Hello\n---\nbody\n'
    const r = splitYamlFrontMatter(md)
    expect(r.frontMatter).toBe('---\ntitle: Hello\n---\n')
    expect(r.body).toBe('body\n')
  })
  it('handles 3+ line minimum', () => {
    // 只有 2 行,lines.length < 3 → null
    const md = '---\nx'
    expect(splitYamlFrontMatter(md).frontMatter).toBeNull()
  })
  it('preserves BOM in body, not in front matter', () => {
    const md = BOM + '---\ntitle: hi\n---\nbody\n'
    const r = splitYamlFrontMatter(md)
    expect(r.frontMatter).toBe('---\ntitle: hi\n---\n')
    expect(r.body).toBe(BOM + 'body\n')
  })
  it('strips single empty line after closing fence', () => {
    const md = '---\ntitle: hi\n---\n\nbody\n'
    const r = splitYamlFrontMatter(md)
    expect(r.body).toBe('body\n')
  })
  it('ensures front matter ends with newline', () => {
    const md = '---\ntitle: hi\n---\nbody'
    const r = splitYamlFrontMatter(md)
    expect(r.frontMatter?.endsWith('\n')).toBe(true)
  })
  it('tolerates comments inside front matter', () => {
    const md = '---\n# this is a comment\ntitle: hi\n---\nbody'
    const r = splitYamlFrontMatter(md)
    expect(r.frontMatter).toBe('---\n# this is a comment\ntitle: hi\n---\n')
  })
  it('skips empty lines when validating key:value', () => {
    const md = '---\n\ntitle: hi\n---\nbody'
    const r = splitYamlFrontMatter(md)
    expect(r.frontMatter).toBe('---\n\ntitle: hi\n---\n')
  })
})

describe('parseFrontMatterMeta', () => {
  it('returns null for null input', () => {
    expect(parseFrontMatterMeta(null)).toBeNull()
  })
  it('parses simple key:value', () => {
    expect(parseFrontMatterMeta('---\ntitle: Hello\n---\n')).toEqual({ title: 'Hello' })
  })
  it('returns null on invalid yaml', () => {
    expect(parseFrontMatterMeta('---\na: [1,\n---\n')).toBeNull()
  })
  it('returns null for non-object yaml (e.g. plain string)', () => {
    expect(parseFrontMatterMeta('---\njust a string\n---\n')).toBeNull()
  })
  it('parses nested structure', () => {
    const meta = parseFrontMatterMeta('---\ntags:\n  - a\n  - b\nauthor: x\n---\n')
    expect(meta).toEqual({ tags: ['a', 'b'], author: 'x' })
  })
  it('tolerates BOM before opening fence', () => {
    expect(parseFrontMatterMeta(BOM + '---\ntitle: hi\n---\n')).toEqual({ title: 'hi' })
  })
})
