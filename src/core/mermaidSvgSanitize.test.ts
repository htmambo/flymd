// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}))

import { applyMermaidSvgScale, mermaidViewBoxFitsContent, scrubInvalidSvgSizeAttrs, stripEmptySvgSizeAttrs } from './mermaid'

describe('stripEmptySvgSizeAttrs', () => {
  it('移除空的 width / height 属性', () => {
    expect(stripEmptySvgSizeAttrs('<svg width="" height="">x</svg>')).toBe('<svg>x</svg>')
    expect(stripEmptySvgSizeAttrs("<svg width='' height=''>x</svg>")).toBe('<svg>x</svg>')
    expect(stripEmptySvgSizeAttrs('<svg width = "" >x</svg>')).toBe('<svg >x</svg>')
  })

  it('保留有效尺寸', () => {
    const m = '<svg width="100%" height="40"><rect width="" height="0"/></svg>'
    expect(stripEmptySvgSizeAttrs(m)).toBe('<svg width="100%" height="40"><rect height="0"/></svg>')
  })

  it('空白值与 NaN 同样移除', () => {
    expect(stripEmptySvgSizeAttrs('<svg width=" " height="NaN">x</svg>')).toBe('<svg>x</svg>')
  })

  it('空输入安全', () => {
    expect(stripEmptySvgSizeAttrs('')).toBe('')
    expect(stripEmptySvgSizeAttrs(undefined as any)).toBe('')
  })
})

describe('applyMermaidSvgScale', () => {
  const NS = 'http://www.w3.org/2000/svg'
  function mount(hostWidth: number) {
    const host = document.createElement('div')
    host.className = 'preview-body'
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: hostWidth })
    const svg = document.createElementNS(NS, 'svg') as SVGElement
    svg.setAttribute('viewBox', '0 0 400 200')
    host.appendChild(svg)
    document.body.appendChild(host)
    return { host, svg }
  }

  it('按容器宽度与 viewBox 的较小值同步定宽', () => {
    const { svg } = mount(500)
    applyMermaidSvgScale(svg)
    // min(500, 400) * 默认比例 0.75
    expect((svg.style as any).width).toBe('300px')
  })

  it('容器宽度小于图表时按容器宽度定宽', () => {
    const { svg } = mount(200)
    applyMermaidSvgScale(svg)
    expect((svg.style as any).width).toBe('150px')
  })

  it('容器不可测量时不做任何写入', () => {
    const { svg } = mount(0)
    applyMermaidSvgScale(svg)
    expect((svg.style as any).width).toBe('')
  })
})

describe('mermaidViewBoxFitsContent', () => {
  const NS = 'http://www.w3.org/2000/svg'
  function svgWith(viewBox: string) {
    const svg = document.createElementNS(NS, 'svg') as SVGElement
    svg.setAttribute('viewBox', viewBox)
    return svg
  }

  it('viewBox 恰好包住内容时不重置', () => {
    expect(mermaidViewBoxFitsContent(svgWith('-8 -8 116 66'), { x: 0, y: 0, width: 100, height: 50 })).toBe(true)
  })

  it('viewBox 远大于内容时重置', () => {
    expect(mermaidViewBoxFitsContent(svgWith('0 0 10000 5000'), { x: 0, y: 0, width: 100, height: 50 })).toBe(false)
  })

  it('viewBox 未包住内容时重置', () => {
    expect(mermaidViewBoxFitsContent(svgWith('0 0 40 20'), { x: 0, y: 0, width: 100, height: 50 })).toBe(false)
  })

  it('缺少或非法 viewBox 时重置', () => {
    expect(mermaidViewBoxFitsContent(svgWith(''), { x: 0, y: 0, width: 100, height: 50 })).toBe(false)
    expect(mermaidViewBoxFitsContent(svgWith('0 0 NaN 20'), { x: 0, y: 0, width: 100, height: 50 })).toBe(false)
  })
})

describe('scrubInvalidSvgSizeAttrs', () => {
  it('移除根与嵌套 svg 上的非法尺寸，保留合法值', () => {
    const NS = 'http://www.w3.org/2000/svg'
    const root = document.createElementNS(NS, 'svg')
    root.setAttribute('width', '')
    root.setAttribute('height', '40')
    const child = document.createElementNS(NS, 'svg')
    child.setAttribute('width', 'NaN')
    child.setAttribute('height', ' ')
    root.appendChild(child)

    scrubInvalidSvgSizeAttrs(root)

    expect(root.hasAttribute('width')).toBe(false)
    expect(root.getAttribute('height')).toBe('40')
    expect(child.hasAttribute('width')).toBe(false)
    expect(child.hasAttribute('height')).toBe(false)
  })
})
