// 克隆体离屏裁剪兜底测试（perf 批次 I）
//
// 打印 / PDF / DOCX 导出都 cloneNode(true) 克隆预览 DOM。若克隆体带着
// content-visibility: auto，离屏代码块会被跳过渲染，导致导出稿整块缺失。
// 本测试锁定 releaseClonedContentVisibility 的行为。
//
// 修正要点（外部审查后）：
//   1. 只处理**真正被打过标**的块（.codebox-cv），不再对所有 .codebox 写内联样式；
//   2. contentVisibility 必须显式写 'visible'——写 '' 会让样式表规则
//      `.codebox.codebox-cv { content-visibility: auto }` 重新生效；
//      因此同时移除 codebox-cv 类做双保险；
//   3. contain-intrinsic-size 在 content-visibility 变 visible 后自然失效，
//      这里显式清空，避免内联残留。

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { releaseClonedContentVisibility } from './contentVisibility'

function makeTaggedBox(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'codebox codebox-cv'
  box.style.contentVisibility = 'auto'
  box.style.containIntrinsicSize = 'auto 120px'
  return box
}

describe('releaseClonedContentVisibility', () => {
  it('把打过标的 codebox 恢复为可见并清掉内联占位', () => {
    const root = document.createElement('div')
    root.className = 'preview'
    const box = makeTaggedBox()
    root.appendChild(box)

    releaseClonedContentVisibility(root)

    expect(box.style.contentVisibility).toBe('visible')
    expect(box.style.containIntrinsicSize).toBe('')
    // 类被移除：即使引擎只认样式表不认内联属性，也回落到 visible
    expect(box.classList.contains('codebox-cv')).toBe(false)
    expect(box.classList.contains('codebox')).toBe(true)
  })

  it('未打标的 codebox 不被写入内联样式（避免无意义写操作）', () => {
    const root = document.createElement('div')
    const box = document.createElement('div')
    box.className = 'codebox'
    root.appendChild(box)

    releaseClonedContentVisibility(root)

    expect(box.style.contentVisibility).toBe('')
    expect(box.style.containIntrinsicSize).toBe('')
    expect(box.classList.contains('codebox-cv')).toBe(false)
  })

  it('不影响非 codebox 元素', () => {
    const root = document.createElement('div')
    const other = document.createElement('div')
    other.className = 'callout'
    other.style.contentVisibility = 'auto'
    root.appendChild(other)

    releaseClonedContentVisibility(root)

    expect(other.style.contentVisibility).toBe('auto')
  })

  it('空容器不报错', () => {
    const root = document.createElement('div')
    expect(() => releaseClonedContentVisibility(root)).not.toThrow()
  })

  it('多个打过标的 codebox 全部处理', () => {
    const root = document.createElement('div')
    const boxes = [0, 1, 2].map(() => {
      const b = makeTaggedBox()
      root.appendChild(b)
      return b
    })
    releaseClonedContentVisibility(root)
    for (const b of boxes) {
      expect(b.style.contentVisibility).toBe('visible')
      expect(b.classList.contains('codebox-cv')).toBe(false)
    }
  })
})
