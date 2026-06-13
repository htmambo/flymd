import { describe, it, expect } from 'vitest'
import { normalizeKatexLatexForInline } from './utils/katexNormalize'

describe('normalizeKatexLatexForInline', () => {
  it('strips outer \\(...\\) delimiter (Word/HTML copy-paste case)', () => {
    const input = String.raw`\(\sqrt{3x-1}+(1+x)^2\)`
    expect(normalizeKatexLatexForInline(input)).toBe(String.raw`\sqrt{3x-1}+(1+x)^2`)
  })

  it('strips outer \\[...\\] delimiter', () => {
    const input = String.raw`\[\int_0^1 x^2 dx\]`
    expect(normalizeKatexLatexForInline(input)).toBe(String.raw`\int_0^1 x^2 dx`)
  })

  it('does not strip inner \\(...\\) inside text (only outermost pair)', () => {
    const input = String.raw`a + \sqrt{3x-1}`  // 不以 \( 开头，不动
    expect(normalizeKatexLatexForInline(input)).toBe(String.raw`a + \sqrt{3x-1}`)
  })

  it('preserves non-delimiter content (no outer \(...\) wrap)', () => {
    const input = String.raw`\sqrt{3x-1}+(1+x)^2`
    expect(normalizeKatexLatexForInline(input)).toBe(input)
  })

  it('handles legacy \\<-macro fix without disturbing delimiter stripping', () => {
    // 外层 \(...\) 剥除 + 双反斜杠 \\ce → \ce
    const input = String.raw`\(\\ce{H2O}\)`
    expect(normalizeKatexLatexForInline(input)).toBe(String.raw`\ce{H2O}`)
  })

  it('does not strip when only one side has the delimiter (asymmetric)', () => {
    const input = String.raw`\sqrt{3x-1}+(1+x)^2\)`  // 只有右半
    expect(normalizeKatexLatexForInline(input)).toBe(input)
  })

  it('preserves empty input', () => {
    expect(normalizeKatexLatexForInline('')).toBe('')
  })

  it('trims surrounding whitespace on bare formula', () => {
    expect(normalizeKatexLatexForInline('  \\sqrt{3x-1}  ')).toBe('\\sqrt{3x-1}')
    expect(normalizeKatexLatexForInline('\n  E=mc^2  \n')).toBe('E=mc^2')
  })

  it('does not trim whitespace inside formula (only edges)', () => {
    // 中间空格属于 LaTeX 源码的一部分，KaTeX 会按规则处理，不能 trim
    const input = 'a  +  b'
    expect(normalizeKatexLatexForInline(input)).toBe('a  +  b')
  })

  it('combines trim + outer delimiter strip (typical $$ space-wrapped case)', () => {
    // 用户真实场景：$$ \(\sqrt{3x-1}...\) $$
    const input = '  \\(\\sqrt{3x-1}+(1+x)^2\\)  '
    expect(normalizeKatexLatexForInline(input)).toBe('\\sqrt{3x-1}+(1+x)^2')
  })
})
