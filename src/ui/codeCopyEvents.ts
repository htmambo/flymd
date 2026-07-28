// 代码块"复制"按钮的全局 click 委托
// 抽离自 main.ts:8716-8780。
// 抽离理由:本块是纯 DOM 驱动的 capture 阶段 click 委托,无 main-local 闭包依赖;
// 仅依赖 document/navigator.clipboard 与全局 DOM 结构(.code-copy / .codebox / pre[data-code-copy-id])。
// 复制策略:默认复制纯文本;按住 Alt 点击时复制为 Markdown 围栏代码块(向后兼容旧行为)。

import { copyTextToClipboard } from '../utils/clipboard'

const COPIED_TEXT = '已复制'
const FAILED_TEXT = '复制失败'
const RESET_TEXT = '复制'
const RESET_DELAY_MS = 1200

// 图标按钮(所见模式,内嵌 SVG)的成功/失败反馈图标,风格与复制图标一致(feather icons)
const CHECK_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
const X_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'

/**
 * 在 document 上挂载代码块复制按钮的 click 委托(capture 阶段)。
 * 重复调用是安全的(每 init 一次,内部 addEventListener 即可累加 — main.ts 中此函数仅在启动时调用一次)。
 * 如需去重,可由调用方管理 lifecycle。
 */
export function initCodeCopyEvents(): void {
  document.addEventListener('click', async (ev) => {
    // 用 closest 匹配:所见模式的复制按钮内嵌 SVG 图标,点击图标时 ev.target 是
    // <rect>/<path> 等子元素而非按钮本身,classList.contains('code-copy') 会漏判
    const t = (ev?.target as HTMLElement | null)?.closest?.('.code-copy') as HTMLElement | null
    if (!t) return
    ev.preventDefault()
    let text: string | null = null
    const direct = (t as any).__copyText
    if (typeof direct === 'string') text = direct
    if (text == null) {
      const box = t.closest('.codebox') as HTMLElement | null
      let pre = box?.querySelector('pre') as HTMLElement | null
      if (!pre) {
        const id = t.getAttribute('data-copy-target')
        if (id) { pre = document.querySelector(`pre[data-code-copy-id="${id}"]`) as HTMLElement | null }
      }
      if (pre) {
        // 默认只复制代码文本;按住 Alt 点击则复制为 Markdown 围栏(兼容旧行为)
        const copyAsMarkdownFence = !!((ev as MouseEvent | undefined)?.altKey)
        const codeEl = pre.querySelector('code') as HTMLElement | null
        const raw = (() => {
          if (codeEl) return codeEl.textContent || ''
          try {
            const cloned = pre.cloneNode(true) as HTMLElement
            try { (cloned.querySelector('.code-lnums') as HTMLElement | null)?.remove() } catch {}
            return cloned.textContent || ''
          } catch {
            return pre.textContent || ''
          }
        })()
        if (!copyAsMarkdownFence) {
          text = raw
        } else {
          let lang = ''
          if (codeEl) {
            const codeClasses = codeEl.className || ''
            const preClasses = pre.className || ''
            const langMatch = (codeClasses + ' ' + preClasses).match(/language-([a-z0-9_+-]+)/i)
            if (langMatch && langMatch[1]) {
              lang = langMatch[1]
            }
          }
          text = lang ? ('```' + lang + '\n' + raw + '\n```') : ('```\n' + raw + '\n```')
        }
      } else {
        text = ''
      }
    }
    text = text || ''
    const ok = await copyTextToClipboard(text)
    // 成功绿色 / 失败红色,复位时移除
    t.classList.remove('copy-ok', 'copy-fail')
    t.classList.add(ok ? 'copy-ok' : 'copy-fail')
    if (t.querySelector('svg')) {
      // 图标按钮(所见模式):换成对勾/叉图标,1.2s 后还原原始图标
      // (不能用 textContent 文案反馈——会把 SVG 图标永久替换掉)
      if (!(t as any).__copyIconHTML) (t as any).__copyIconHTML = t.innerHTML
      t.innerHTML = ok ? CHECK_ICON_SVG : X_ICON_SVG
      try { if ((t as any).__copyResetTimer) clearTimeout((t as any).__copyResetTimer) } catch {}
      ;(t as any).__copyResetTimer = setTimeout(() => {
        t.innerHTML = (t as any).__copyIconHTML
        t.classList.remove('copy-ok', 'copy-fail')
        ;(t as any).__copyResetTimer = null
      }, RESET_DELAY_MS)
    } else {
      // 文字按钮(阅读模式):保持原有文案反馈
      t.textContent = ok ? COPIED_TEXT : FAILED_TEXT
      setTimeout(() => {
        ;(t as HTMLButtonElement).textContent = RESET_TEXT
        t.classList.remove('copy-ok', 'copy-fail')
      }, RESET_DELAY_MS)
    }
  }, { capture: true })
}
