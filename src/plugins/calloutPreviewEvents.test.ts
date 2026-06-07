// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { onCalloutFoldClick, onCalloutCopyClick } from './calloutPreviewEvents'

function makeCallout(opts: { folded?: boolean } = {}) {
  const callout = document.createElement('div')
  callout.classList.add('callout')
  if (opts.folded) {
    callout.classList.add('folded')
    callout.dataset.folded = 'true'
  }
  const foldIcon = document.createElement('span')
  foldIcon.classList.add('callout-fold-icon')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  foldIcon.appendChild(svg)
  const copyIcon = document.createElement('span')
  copyIcon.classList.add('callout-copy-icon')
  const content = document.createElement('div')
  content.classList.add('callout-content')
  const child1 = document.createElement('p')
  child1.innerText = '  first paragraph  '
  const child2 = document.createElement('p')
  child2.innerText = 'second'
  const childEmpty = document.createElement('p')
  childEmpty.innerText = '   '
  content.appendChild(child1)
  content.appendChild(child2)
  content.appendChild(childEmpty)
  callout.appendChild(foldIcon)
  callout.appendChild(copyIcon)
  callout.appendChild(content)
  return { callout, foldIcon, copyIcon, content, svg }
}

describe('onCalloutFoldClick', () => {
  it('does nothing if click is not inside .callout-fold-icon', () => {
    const { callout } = makeCallout()
    const other = document.createElement('div')
    other.appendChild(callout)
    onCalloutFoldClick({ target: other } as any)
    expect(callout.classList.contains('folded')).toBe(false)
  })
  it('does nothing if .callout is missing', () => {
    const orphan = document.createElement('span')
    orphan.classList.add('callout-fold-icon')
    onCalloutFoldClick({ target: orphan } as any)
    // no error
  })
  it('toggles .folded on the callout and updates dataset + content display', () => {
    const { callout, content, foldIcon, svg } = makeCallout()
    onCalloutFoldClick({ target: foldIcon } as any)
    expect(callout.classList.contains('folded')).toBe(true)
    expect(callout.dataset.folded).toBe('true')
    expect(content.style.display).toBe('none')
    expect(svg.style.transform).toBe('rotate(-90deg)')
  })
  it('unfolds when already folded', () => {
    const { callout, content, foldIcon, svg } = makeCallout({ folded: true })
    onCalloutFoldClick({ target: foldIcon } as any)
    expect(callout.classList.contains('folded')).toBe(false)
    expect(callout.dataset.folded).toBe('false')
    expect(content.style.display).toBe('')
    expect(svg.style.transform).toBe('')
  })
  it('works when click target is a nested element inside the fold icon', () => {
    const { callout, foldIcon } = makeCallout()
    const nested = document.createElement('em')
    foldIcon.appendChild(nested)
    onCalloutFoldClick({ target: nested } as any)
    expect(callout.classList.contains('folded')).toBe(true)
  })
})

describe('onCalloutCopyClick', () => {
  let writeText: any
  beforeEach(() => {
    writeText = (globalThis as any).navigator.clipboard?.writeText
  })

  it('does nothing if click is not inside .callout-copy-icon', async () => {
    const { callout } = makeCallout()
    const other = document.createElement('div')
    other.appendChild(callout)
    let called = ''
    ;(navigator as any).clipboard = { writeText: (s: string) => { called = s; return Promise.resolve() } }
    onCalloutCopyClick({ target: other } as any)
    expect(called).toBe('')
    ;(navigator as any).clipboard = { writeText }
  })
  it('joins direct child paragraphs with blank line and trims', async () => {
    const { callout, copyIcon } = makeCallout()
    let called = ''
    ;(navigator as any).clipboard = { writeText: (s: string) => { called = s; return Promise.resolve() } }
    onCalloutCopyClick({ target: copyIcon } as any)
    expect(called).toBe('first paragraph\n\nsecond')
    ;(navigator as any).clipboard = { writeText }
  })
  it('does not call clipboard when content has no text', async () => {
    const callout = document.createElement('div')
    callout.classList.add('callout')
    const copyIcon = document.createElement('span')
    copyIcon.classList.add('callout-copy-icon')
    const content = document.createElement('div')
    content.classList.add('callout-content')
    const empty = document.createElement('p')
    empty.innerText = '   '
    content.appendChild(empty)
    callout.appendChild(copyIcon)
    callout.appendChild(content)
    let called = ''
    ;(navigator as any).clipboard = { writeText: (s: string) => { called = s; return Promise.resolve() } }
    onCalloutCopyClick({ target: copyIcon } as any)
    expect(called).toBe('')
    ;(navigator as any).clipboard = { writeText }
  })

  it('changes button text to "已复制" after successful copy and resets after 1.2s', async () => {
    vi.useFakeTimers()
    const { copyIcon } = makeCallout()
    copyIcon.textContent = '复制'
    ;(navigator as any).clipboard = { writeText: () => Promise.resolve() }
    onCalloutCopyClick({ target: copyIcon } as any)
    await Promise.resolve()
    await Promise.resolve()
    expect(copyIcon.textContent).toBe('已复制')
    vi.advanceTimersByTime(1200)
    expect(copyIcon.textContent).toBe('复制')
    vi.useRealTimers()
    ;(navigator as any).clipboard = { writeText }
  })

  it('does not change button text when clipboard write fails', async () => {
    const { copyIcon } = makeCallout()
    copyIcon.textContent = '复制'
    ;(navigator as any).clipboard = { writeText: () => Promise.reject(new Error('denied')) }
    onCalloutCopyClick({ target: copyIcon } as any)
    await Promise.resolve()
    await Promise.resolve()
    expect(copyIcon.textContent).toBe('复制')
    ;(navigator as any).clipboard = { writeText }
  })
})
