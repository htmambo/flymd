// @vitest-environment jsdom
// 测试 platformInit 平台 class 与窗口拖动初始化逻辑

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPlatformInit } from './platformInit'

interface Deps {
  isCompactTitlebarEnabled: () => boolean
  isFocusModeEnabled: () => boolean
  getStickyNoteMode: () => boolean
  getStickyNoteLocked: () => boolean
  getCurrentWindow: () => { startDragging: () => Promise<void> } | null
}

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    isCompactTitlebarEnabled: () => false,
    isFocusModeEnabled: () => false,
    getStickyNoteMode: () => false,
    getStickyNoteLocked: () => false,
    getCurrentWindow: () => null,
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.className = ''
})

describe('initPlatformClass', () => {
  it('adds platform-windows on win', () => {
    const api = createPlatformInit(makeDeps())
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
    api.initPlatformClass()
    expect(document.body.classList.contains('platform-windows')).toBe(true)
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('adds platform-mac on mac', () => {
    const api = createPlatformInit(makeDeps())
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    api.initPlatformClass()
    expect(document.body.classList.contains('platform-mac')).toBe(true)
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('adds platform-linux on linux', () => {
    const api = createPlatformInit(makeDeps())
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    api.initPlatformClass()
    expect(document.body.classList.contains('platform-linux')).toBe(true)
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('does nothing for unknown platform', () => {
    const api = createPlatformInit(makeDeps())
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'BeOS' })
    api.initPlatformClass()
    expect(document.body.classList.contains('platform-windows')).toBe(false)
    expect(document.body.classList.contains('platform-mac')).toBe(false)
    expect(document.body.classList.contains('platform-linux')).toBe(false)
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })
})

describe('initWindowDrag', () => {
  it('returns early on Windows (no mousedown binding)', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
    document.body.innerHTML = '<div class="tabbar-row"></div>'
    const startDragging = vi.fn()
    const api = createPlatformInit(makeDeps({
      getCurrentWindow: () => ({ startDragging }),
      isFocusModeEnabled: () => true,
    }))
    api.initWindowDrag()
    document.querySelector('.tabbar-row')?.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    expect(startDragging).not.toHaveBeenCalled()
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('binds mousedown on mac and calls startDragging when focus mode', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    document.body.innerHTML = '<div class="tabbar-row"></div>'
    const startDragging = vi.fn()
    const api = createPlatformInit(makeDeps({
      getCurrentWindow: () => ({ startDragging }),
      isFocusModeEnabled: () => true,
    }))
    api.initWindowDrag()
    document.querySelector('.tabbar-row')?.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    expect(startDragging).toHaveBeenCalled()
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('returns early when sticky note locked', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    document.body.innerHTML = '<div class="tabbar-row"></div>'
    const startDragging = vi.fn()
    const api = createPlatformInit(makeDeps({
      getCurrentWindow: () => ({ startDragging }),
      isFocusModeEnabled: () => true,
      getStickyNoteLocked: () => true,
    }))
    api.initWindowDrag()
    document.querySelector('.tabbar-row')?.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    expect(startDragging).not.toHaveBeenCalled()
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('returns early when no focus mode / compact / sticky', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    document.body.innerHTML = '<div class="tabbar-row"></div>'
    const startDragging = vi.fn()
    const api = createPlatformInit(makeDeps({
      getCurrentWindow: () => ({ startDragging }),
    }))
    api.initWindowDrag()
    document.querySelector('.tabbar-row')?.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    expect(startDragging).not.toHaveBeenCalled()
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })

  it('ignores target inside button / .window-controls / .tabbar-tab', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' })
    document.body.innerHTML = '<div class="tabbar-row"><button class="x">x</button></div>'
    const startDragging = vi.fn()
    const api = createPlatformInit(makeDeps({
      getCurrentWindow: () => ({ startDragging }),
      isFocusModeEnabled: () => true,
    }))
    api.initWindowDrag()
    document.querySelector('button.x')?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    expect(startDragging).not.toHaveBeenCalled()
    if (orig) Object.defineProperty(navigator, 'platform', orig)
  })
})
