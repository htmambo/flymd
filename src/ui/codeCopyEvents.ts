// 代码块"复制"按钮的全局 click 委托
// 抽离自 main.ts:8716-8780。
// 抽离理由:本块是纯 DOM 驱动的 capture 阶段 click 委托,无 main-local 闭包依赖;
// 仅依赖 document/navigator.clipboard 与全局 DOM 结构(.code-copy / .codebox / pre[data-code-copy-id])。
// 复制策略:默认复制纯文本;按住 Alt 点击时复制为 Markdown 围栏代码块(向后兼容旧行为)。

import { copyTextToClipboard } from '../utils/clipboard'
import { isCodeContentClipped } from './codeExpandClip'

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
  // 缩放按钮委托（toggle 语义，必须去重注册——复制分支幂等可容忍重复监听，
  // 翻转类操作被重复执行偶数次会互相抵消）。window 标记保证单页面仅注册一次。
  const w = window as any
  if (!w.__flymdCodeExpandDelegated) {
    w.__flymdCodeExpandDelegated = true
    document.addEventListener('click', (ev) => {
      // 缩放按钮：切换 .codebox 限高/全高显示（图标 feather maximize-2/minimize-2，
      // 与所见模式 overlay 按钮同款；点击 SVG 子元素时 closest 兜底）
      const expandT = (ev?.target as HTMLElement | null)?.closest?.('.code-expand') as HTMLElement | null
      if (!expandT) return
      ev.preventDefault()
      const box = expandT.closest('.codebox') as HTMLElement | null
      const pre = box?.querySelector('pre') as HTMLElement | null
      if (!box || !pre) return
      const expanded = box.classList.toggle('code-expanded')
      expandT.title = expanded ? '恢复限高显示' : '全高显示代码块'
      expandT.innerHTML = expanded
        ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>'
        : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>'
      // 展开状态保持按钮可见（供收回）；限高状态仅内容实际超高时显示
      try {
        expandT.style.display = (expanded || isCodeContentClipped(pre)) ? '' : 'none'
      } catch {}
    })
  }
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
