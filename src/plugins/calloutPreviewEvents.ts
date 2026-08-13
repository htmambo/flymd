// 预览里 callout 元素的交互事件 handler(折叠 + 复制)
// 抽离自 main.ts:1943-1982。
// 抽离理由:两个 handler 只依赖 ev.target / DOM / 剪贴板工具,完全无 main.ts 闭包依赖;
// 与 src/plugins/markdownItCallout.ts(产生 .callout DOM 的插件)同级。
// 复制按钮为图标式,反馈与 codeCopyEvents 图标分支一致:
//   成功对勾(copy-ok 绿)/失败叉(copy-fail 红),1.2s 还原原始图标。
// 剪贴板写入走 copyTextToClipboard(Tauri 原生插件 → navigator.clipboard → execCommand 兜底)。

import { copyTextToClipboard } from '../utils/clipboard'

const RESET_DELAY_MS = 1200

// 图标按钮的成功/失败反馈图标,风格与复制图标一致(feather icons),同 codeCopyEvents
const CHECK_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
const X_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'

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
 * 写入剪贴板。按钮为图标式:成功后换对勾(copy-ok 绿)、失败换叉(copy-fail 红),1.2s 还原。
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
    if (!result) return
    void (async () => {
      const ok = await copyTextToClipboard(result)
      // 不能用 textContent 文案反馈——会把 SVG 图标永久替换掉
      copyBtn.classList.remove('copy-ok', 'copy-fail')
      copyBtn.classList.add(ok ? 'copy-ok' : 'copy-fail')
      if (!(copyBtn as any).__copyIconHTML) (copyBtn as any).__copyIconHTML = copyBtn.innerHTML
      copyBtn.innerHTML = ok ? CHECK_ICON_SVG : X_ICON_SVG
      try { if ((copyBtn as any).__copyResetTimer) clearTimeout((copyBtn as any).__copyResetTimer) } catch {}
      ;(copyBtn as any).__copyResetTimer = setTimeout(() => {
        copyBtn.innerHTML = (copyBtn as any).__copyIconHTML
        copyBtn.classList.remove('copy-ok', 'copy-fail')
        ;(copyBtn as any).__copyResetTimer = null
      }, RESET_DELAY_MS)
    })()
  } catch {}
}
