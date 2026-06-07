// 预览里 callout 元素的交互事件 handler(折叠 + 复制)
// 抽离自 main.ts:1943-1982。
// 抽离理由:两个 handler 只依赖 ev.target / DOM / navigator.clipboard,完全无 main.ts 闭包依赖;
// 与 src/plugins/markdownItCallout.ts(产生 .callout DOM 的插件)同级。
// 复制行为用 navigator.clipboard.writeText,失败静默(无 catch handler)。

/**
 * 处理 .callout-fold-icon 上的点击:toggle .folded class + 隐藏内容 + 旋转 SVG。
 * 点击冒泡到 ev.target 内部任意子元素都能匹配(用 closest)。
 */
export function onCalloutFoldClick(ev: Event): void {
  try {
    const target = ev.target as HTMLElement | null
    const foldBtn = target?.closest?.('.callout-fold-icon') as HTMLElement | null
    if (!foldBtn) return
    const callout = foldBtn.closest('.callout') as HTMLElement | null
    if (!callout) return
    const content = callout.querySelector('.callout-content') as HTMLElement | null
    if (!content) return
    const isFolded = callout.classList.toggle('folded')
    callout.dataset.folded = String(isFolded)
    content.style.display = isFolded ? 'none' : ''
    const svg = foldBtn.querySelector('svg')
    if (svg) {
      svg.style.transform = isFolded ? 'rotate(-90deg)' : ''
    }
  } catch {}
}

/**
 * 处理 .callout-copy-icon 上的点击:把 callout-content 的直接子元素文本用空行拼起来,
 * 写入剪贴板。
 */
export function onCalloutCopyClick(ev: Event): void {
  try {
    const target = ev.target as HTMLElement | null
    const copyBtn = target?.closest?.('.callout-copy-icon') as HTMLElement | null
    if (!copyBtn) return
    const callout = copyBtn.closest('.callout') as HTMLElement | null
    if (!callout) return
    const content = callout.querySelector('.callout-content') as HTMLElement | null
    if (!content) return
    const texts: string[] = []
    content.querySelectorAll(':scope > *').forEach((el) => {
      const text = (el as HTMLElement).innerText || ''
      const trimmed = text.trim()
      if (trimmed) texts.push(trimmed)
    })
    const result = texts.join('\n\n')
    if (result) {
      navigator.clipboard.writeText(result).catch(() => {})
    }
  } catch {}
}
