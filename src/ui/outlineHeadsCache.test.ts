// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearOutlineHeadsCache,
  cssEscapeCompat,
  buildOutlineHeadsCacheFromCtx,
  ensureOutlineHeadsCacheFromCtx,
  type OutlineContext,
} from './outlineHeadsCache'

function makeHead(id: string, offsetTop: number): HTMLElement {
  const h = document.createElement('h2')
  if (id) h.setAttribute('id', id)
  Object.defineProperty(h, 'offsetTop', { configurable: true, value: offsetTop })
  return h
}

function makeCtx(heads: HTMLElement[]): OutlineContext {
  const body = document.createElement('div')
  const scroll = document.createElement('div')
  for (const h of heads) body.appendChild(h)
  return { mode: 'preview', scrollEl: scroll, bodyEl: body, heads }
}

describe('cssEscapeCompat', () => {
  it('returns input when CSS.escape is unavailable', () => {
    // jsdom 也不提供 CSS.escape,fallback 走正则
    const s = 'simple-id'
    expect(cssEscapeCompat(s)).toBe('simple-id')
  })
  it('escapes backslashes and double-quotes in fallback', () => {
    expect(cssEscapeCompat('a\\b')).toBe('a\\\\b')
    expect(cssEscapeCompat('a"b')).toBe('a\\"b')
  })
  it('handles non-string input', () => {
    expect(cssEscapeCompat(null as any)).toBe('null')
  })
})

describe('buildOutlineHeadsCacheFromCtx', () => {
  beforeEach(() => clearOutlineHeadsCache())

  it('returns null when scrollEl/bodyEl missing', () => {
    expect(buildOutlineHeadsCacheFromCtx({ mode: 'preview', scrollEl: null, bodyEl: null, heads: [] })).toBeNull()
  })
  it('returns null when no headings', () => {
    const ctx = makeCtx([])
    expect(buildOutlineHeadsCacheFromCtx(ctx)).toBeNull()
  })
  it('returns null when all offsetTops are 0 (cache disabled fallback)', () => {
    const ctx = makeCtx([makeHead('a', 0), makeHead('b', 0)])
    expect(buildOutlineHeadsCacheFromCtx(ctx)).toBeNull()
  })
  it('skips heads without id', () => {
    const ctx = makeCtx([makeHead('', 100), makeHead('a', 200)])
    const r = buildOutlineHeadsCacheFromCtx(ctx)
    expect(r?.ids).toEqual(['a'])
    expect(r?.tops).toEqual([200])
  })
  it('queries bodyEl when heads is empty', () => {
    const body = document.createElement('div')
    body.appendChild(makeHead('a', 100))
    const ctx: OutlineContext = { mode: 'preview', scrollEl: document.createElement('div'), bodyEl: body, heads: [] }
    const r = buildOutlineHeadsCacheFromCtx(ctx)
    expect(r?.ids).toEqual(['a'])
  })
  it('preserves id order', () => {
    const ctx = makeCtx([makeHead('a', 100), makeHead('b', 200), makeHead('c', 300)])
    const r = buildOutlineHeadsCacheFromCtx(ctx)
    expect(r?.ids).toEqual(['a', 'b', 'c'])
    expect(r?.tops).toEqual([100, 200, 300])
  })
})

describe('ensureOutlineHeadsCacheFromCtx', () => {
  beforeEach(() => clearOutlineHeadsCache())

  it('returns null when scrollEl/bodyEl missing', () => {
    expect(ensureOutlineHeadsCacheFromCtx({ mode: 'preview', scrollEl: null, bodyEl: null, heads: [] })).toBeNull()
  })
  it('caches and reuses for same context', () => {
    const ctx = makeCtx([makeHead('a', 100), makeHead('b', 200)])
    const r1 = ensureOutlineHeadsCacheFromCtx(ctx)
    // mutate ctx (add a new head) but expect cached result to be unchanged
    ctx.bodyEl!.appendChild(makeHead('c', 300))
    const r2 = ensureOutlineHeadsCacheFromCtx(ctx)
    expect(r1).toBe(r2)
    expect(r2?.ids).toEqual(['a', 'b'])
  })
  it('rebuilds when mode changes', () => {
    const ctx = makeCtx([makeHead('a', 100)])
    const r1 = ensureOutlineHeadsCacheFromCtx(ctx)
    const r2 = ensureOutlineHeadsCacheFromCtx({ ...ctx, mode: 'wysiwyg' })
    expect(r2).not.toBe(r1)
    expect(r2?.mode).toBe('wysiwyg')
  })
  it('rebuilds when bodyEl changes', () => {
    const ctx1 = makeCtx([makeHead('a', 100)])
    ensureOutlineHeadsCacheFromCtx(ctx1)
    const ctx2 = makeCtx([makeHead('a', 200)])
    const r = ensureOutlineHeadsCacheFromCtx(ctx2)
    expect(r?.bodyEl).toBe(ctx2.bodyEl)
  })
  it('rebuilds when scrollEl changes', () => {
    const ctx1 = makeCtx([makeHead('a', 100)])
    ensureOutlineHeadsCacheFromCtx(ctx1)
    const body = ctx1.bodyEl
    const ctx2: OutlineContext = { mode: 'preview', scrollEl: document.createElement('div'), bodyEl: body, heads: [] }
    const r = ensureOutlineHeadsCacheFromCtx(ctx2)
    expect(r?.scrollEl).toBe(ctx2.scrollEl)
  })
  it('clearOutlineHeadsCache forces rebuild', () => {
    const ctx = makeCtx([makeHead('a', 100)])
    const r1 = ensureOutlineHeadsCacheFromCtx(ctx)
    clearOutlineHeadsCache()
    const r2 = ensureOutlineHeadsCacheFromCtx(ctx)
    expect(r2).not.toBe(r1)
  })
})
