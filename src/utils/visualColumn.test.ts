import { describe, it, expect } from 'vitest'
import { advanceVisualColumn, calcVisualColumn, offsetForVisualColumn } from './visualColumn'

describe('advanceVisualColumn', () => {
  it('treats CR as no-op', () => {
    expect(advanceVisualColumn(5, 13)).toBe(5)
  })
  it('treats tab as 4-step aligned jump from current column', () => {
    expect(advanceVisualColumn(0, 9)).toBe(4)
    expect(advanceVisualColumn(1, 9)).toBe(4)
    expect(advanceVisualColumn(3, 9)).toBe(4)
    expect(advanceVisualColumn(4, 9)).toBe(8)
  })
  it('advances printable chars by 1', () => {
    expect(advanceVisualColumn(2, 97)).toBe(3)
  })
})

describe('calcVisualColumn', () => {
  it('returns 0 for empty string', () => {
    expect(calcVisualColumn('')).toBe(0)
  })
  it('counts ASCII chars 1:1', () => {
    expect(calcVisualColumn('abc')).toBe(3)
  })
  it('expands tab to next 4-boundary', () => {
    // a→1, tab(modulo=1, step=3)→4, b→5
    expect(calcVisualColumn('a\tb')).toBe(5)
  })
  it('keeps CR at current column', () => {
    // a→1, CR(13) 保持 1, b→2
    expect(calcVisualColumn('a\rb')).toBe(2)
  })
})

describe('offsetForVisualColumn', () => {
  it('returns 0 for non-finite or non-positive column', () => {
    expect(offsetForVisualColumn('abc', NaN)).toBe(0)
    expect(offsetForVisualColumn('abc', 0)).toBe(0)
    expect(offsetForVisualColumn('abc', -3)).toBe(0)
  })
  it('returns 1 for first char when column hits', () => {
    expect(offsetForVisualColumn('a', 1)).toBe(1)
  })
  it('respects tab expansion', () => {
    // "a\tb" → visual columns 0, 1, 4, 5
    // column=4 → offset should be 2 (right after \t)
    expect(offsetForVisualColumn('a\tb', 4)).toBe(2)
    // column=5 → offset 3 (after b)
    expect(offsetForVisualColumn('a\tb', 5)).toBe(3)
  })
  it('clamps to line end when column exceeds content', () => {
    expect(offsetForVisualColumn('abc', 100)).toBe(3)
  })
  it('returns 0 for column 0', () => {
    expect(offsetForVisualColumn('abc', 0)).toBe(0)
  })
})
