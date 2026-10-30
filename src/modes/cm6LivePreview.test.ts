import { describe, expect, it } from 'vitest'
import { parseCm6Blocks } from './cm6LivePreview'

describe('cm6LivePreview.parseCm6Blocks', () => {
  it('识别 mermaid、数学围栏和 $$ 块并保留源码', () => {
    const source = '前导\n\n```mermaid\nA-->B\n```\n\n$$\nx^2\n$$\n\n```katex\ny=1\n```'
    const blocks = parseCm6Blocks(source)
    expect(blocks.map(block => block.kind)).toEqual(['mermaid', 'math', 'math'])
    expect(blocks.map(block => block.source)).toEqual(['A-->B', 'x^2', 'y=1'])
    for (const block of blocks) expect(source.slice(block.from, block.to)).toContain(block.source)
  })

  it('未闭合块不进入替换装饰', () => {
    expect(parseCm6Blocks('```mermaid\nA-->B')).toEqual([])
    expect(parseCm6Blocks('$$\nx^2')).toEqual([])
  })

  it('普通代码围栏不参与 Live Preview widget', () => {
    expect(parseCm6Blocks('```ts\nconst x = 1\n```')).toEqual([])
  })

  it('支持引用、缩进、~~~ 围栏与带参数 info string', () => {
    const source = '> ~~~mermaid theme=dark\n> A-->B\n> ~~~\n\n  ```math\n  y=2\n  ```'
    const blocks = parseCm6Blocks(source)
    expect(blocks.map(block => block.kind)).toEqual(['mermaid', 'math'])
    expect(blocks[0].source).toBe('> A-->B')
    expect(blocks[1].source).toBe('  y=2')
  })
})
