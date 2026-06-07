// 代码块"复制"按钮的全局 click 委托
// 抽离自 main.ts:8716-8780。
// 抽离理由:本块是纯 DOM 驱动的 capture 阶段 click 委托,无 main-local 闭包依赖;
// 仅依赖 document/navigator.clipboard 与全局 DOM 结构(.code-copy / .codebox / pre[data-code-copy-id])。
// 复制策略:默认复制纯文本;按住 Alt 点击时复制为 Markdown 围栏代码块(向后兼容旧行为)。

const COPIED_TEXT = '已复制'
const FAILED_TEXT = '复制失败'
const RESET_TEXT = '复制'
const RESET_DELAY_MS = 1200

/**
 * 在 document 上挂载代码块复制按钮的 click 委托(capture 阶段)。
 * 重复调用是安全的(每 init 一次,内部 addEventListener 即可累加 — main.ts 中此函数仅在启动时调用一次)。
 * 如需去重,可由调用方管理 lifecycle。
 */
export function initCodeCopyEvents(): void {
  document.addEventListener('click', async (ev) => {
    const t = ev?.target as HTMLElement
    if (!(t && t.classList.contains('code-copy'))) return
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
    let ok = false
    try { await navigator.clipboard.writeText(text); ok = true } catch {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        ok = true
      } catch {}
    }
    t.textContent = ok ? COPIED_TEXT : FAILED_TEXT
    setTimeout(() => { (t as HTMLButtonElement).textContent = RESET_TEXT }, RESET_DELAY_MS)
  }, { capture: true })
}
