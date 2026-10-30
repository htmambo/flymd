// perf 批次 H 修复测试：大文档启动冻结的两处分片/批量改造
//
// 1) decorateCodeBlocks 分片：数千代码块不再单任务跑完（真机 35k 行 / 3352 块冻结），
//    分片让出主线程后全部装饰到位 + data-codebox 幂等
// 2) measureLineHeightsBatched：批量测量后容器恢复原状、空行占位、公式与单 probe 一致
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { decorateCodeBlocks } from '../decorate'
import { measureLineHeightsBatched } from './sourceLineNumbers'

function makePreview(count: number): HTMLElement {
  const preview = document.createElement('div')
  let html = ''
  for (let i = 0; i < count; i++) {
    html += `<pre><code class="hljs language-js">code ${i}</code></pre>`
  }
  preview.innerHTML = html
  document.body.appendChild(preview)
  return preview
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('decorateCodeBlocks 分片（perf 批次 H1）', () => {
  it('超过分片阈值（250 块）时异步分片推进，最终全部装饰到位', async () => {
    const preview = makePreview(250)
    await decorateCodeBlocks(preview)
    const boxes = preview.querySelectorAll('.codebox')
    expect(boxes.length).toBe(250)
    expect(preview.querySelectorAll('pre[data-codebox="1"]').length).toBe(250)
    // 语言角标与复制按钮逐块生成
    expect(preview.querySelectorAll('.code-lang').length).toBe(250)
    expect(preview.querySelectorAll('button.code-copy').length).toBe(250)
  })

  it('data-codebox 守卫：重复调用不重复包装（幂等）', async () => {
    const preview = makePreview(30)
    await decorateCodeBlocks(preview)
    await decorateCodeBlocks(preview)
    expect(preview.querySelectorAll('.codebox').length).toBe(30)
    // pre 仍在各自 codebox 内，未被二次搬移
    expect(preview.querySelectorAll('.codebox pre > code.hljs').length).toBe(30)
  })

  it('mermaid 代码块跳过装饰', async () => {
    const preview = makePreview(2)
    const mermaid = document.createElement('pre')
    mermaid.innerHTML = '<code class="hljs language-mermaid">flowchart TD</code>'
    preview.appendChild(mermaid)
    await decorateCodeBlocks(preview)
    expect(preview.querySelectorAll('.codebox').length).toBe(2)
    expect(mermaid.getAttribute('data-codebox')).toBeNull()
  })
})

describe('decorateCodeBlocks 离屏裁剪门控（perf 批次 I）', () => {
  // jsdom 无布局：clientHeight 恒为 0，而离屏裁剪必须先测出真实占位高度
  // （contain-intrinsic-size 写错会让整个文档的滚动比例失真）。
  // 这里给 clientHeight 打桩，模拟真实浏览器中的可测量状态。
  let restoreClientHeight: (() => void) | null = null
  beforeEach(() => {
    const orig = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get() { return 120 },
    })
    restoreClientHeight = () => {
      if (orig) Object.defineProperty(Element.prototype, 'clientHeight', orig)
      else delete (Element.prototype as any).clientHeight
    }
  })
  afterEach(() => {
    restoreClientHeight?.()
    restoreClientHeight = null
  })

  it('代码块数超阈值时逐块打 .codebox-cv', async () => {
    const preview = makePreview(201)
    await decorateCodeBlocks(preview)
    const boxes = preview.querySelectorAll('.codebox')
    expect(boxes.length).toBe(201)
    expect(preview.querySelectorAll('.codebox.codebox-cv').length).toBe(201)
  })

  it('占位高度按块写入内联 contain-intrinsic-size（写错会让滚动比例失真）', async () => {
    const preview = makePreview(201)
    await decorateCodeBlocks(preview)
    const box = preview.querySelector('.codebox') as HTMLElement
    // jsdom 里 padding 为 0 → 内容盒高度 = clientHeight = 120
    expect(box.style.containIntrinsicSize).toBe('auto 120px')
  })

  it('代码块数未超阈值时不打标（普通文档行为不变）', async () => {
    const preview = makePreview(200)
    await decorateCodeBlocks(preview)
    expect(preview.querySelectorAll('.codebox').length).toBe(200)
    expect(preview.querySelectorAll('.codebox.codebox-cv').length).toBe(0)
  })

  it('标记逐块施加在 codebox 上（content-visibility 的载体），而非其内部 pre', async () => {
    const preview = makePreview(201)
    await decorateCodeBlocks(preview)
    const box = preview.querySelector('.codebox') as HTMLElement
    expect(box.classList.contains('codebox-cv')).toBe(true)
    // pre 本身不带该类 —— 离屏裁剪必须作用在载体上，内部元素被跳过时没有盒子
    expect((box.querySelector('pre') as HTMLElement).classList.contains('codebox-cv')).toBe(false)
  })

  it('mermaid 块不参与打标（未生成 codebox）', async () => {
    const preview = makePreview(201)
    const mermaid = document.createElement('pre')
    mermaid.innerHTML = '<code class="hljs language-mermaid">flowchart TD</code>'
    preview.appendChild(mermaid)
    await decorateCodeBlocks(preview)
    expect(preview.querySelectorAll('.codebox.codebox-cv').length).toBe(201)
    expect(mermaid.getAttribute('data-codebox')).toBeNull()
  })

  it('测不到真实高度时不打标（宁可不裁剪，也不写错占位高度）', async () => {
    const orig = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get() { return 0 },
    })
    try {
      const preview = makePreview(201)
      await decorateCodeBlocks(preview)
      expect(preview.querySelectorAll('.codebox.codebox-cv').length).toBe(0)
    } finally {
      if (orig) Object.defineProperty(Element.prototype, 'clientHeight', orig)
    }
  })
})

describe('measureLineHeightsBatched（perf 批次 H2）', () => {
  it('返回值与输入一一对应；测量后容器恢复原状', () => {
    const container = document.createElement('div')
    container.className = 'editor-line-measure'
    document.body.appendChild(container)
    const before = container.childElementCount

    const texts = ['第一行', '第二行', '', '第四行', '第一行'] // 含空行与重复文本
    const heights = measureLineHeightsBatched(container, texts, 20)

    expect(heights).toHaveLength(texts.length)
    // jsdom 无布局：offsetHeight 恒 0 → 全部回落 metrics.lineHeight（与单 probe 公式一致）
    for (const h of heights) expect(h).toBe(20)
    // 测量行全部移除，容器恢复原状（后续单 probe 测量不受污染）
    expect(container.childElementCount).toBe(before)
  })

  it('空行用零宽占位（与单 probe 的 textContent 约定一致）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const heights = measureLineHeightsBatched(container, [''], 16, 1) // batchSize=1 逐块
    expect(heights).toEqual([16])
    expect(container.childElementCount).toBe(0)
  })

  it('分块边界：batchSize 切分不丢行', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const texts = Array.from({ length: 10 }, (_, i) => `line-${i}`)
    const heights = measureLineHeightsBatched(container, texts, 24, 3) // 4 块
    expect(heights).toHaveLength(10)
    expect(container.childElementCount).toBe(0)
  })
})
