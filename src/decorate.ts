// 代码块装饰：语言角标、行号与复制按钮（仅阅读模式生成行号；不改动 hljs 结构，避免 HTML 等语言错位）
import { isCodeContentClipped } from './ui/codeExpandClip'

export function decorateCodeBlocks(preview: HTMLElement) {
  try {
    const codes = Array.from(preview.querySelectorAll('pre > code.hljs')) as HTMLElement[]
    for (const code of codes) {
      const pre = code.parentElement as HTMLElement | null
      if (!pre || pre.getAttribute('data-codebox') === '1') continue
      if (code.classList.contains('language-mermaid')) continue

      const lang = ((Array.from(code.classList).find(c => c.startsWith('language-')) || '').slice(9) || 'text').toUpperCase()

      // 外层容器（不改动 code 内部结构）
      const box = document.createElement('div')
      box.className = 'codebox'
      if (pre.parentElement) pre.parentElement.insertBefore(box, pre)
      box.appendChild(pre)

      // 仅在阅读模式生成行号列
      let isWysiwyg = false
      try {
        const containerEl = preview.closest('.container') as HTMLElement | null
        isWysiwyg = !!(containerEl && (containerEl.classList.contains('wysiwyg') || containerEl.classList.contains('wysiwyg-v2')))
      } catch {}
      if (!isWysiwyg) {
        try {
          const raw = code.textContent || ''
          const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n')
          const lnWrap = document.createElement('div')
          lnWrap.className = 'code-lnums'
          lnWrap.setAttribute('aria-hidden', 'true')
          // 与代码实际行高对齐：读取 computed line-height（像素）并应用到行号列
          try {
            const cs = getComputedStyle(code)
            const csPre = getComputedStyle(pre)
            // 行高与字号（像素）
            const lhStr = cs.lineHeight
            const fsStr = cs.fontSize
            if (lhStr && lhStr !== 'normal') lnWrap.style.lineHeight = lhStr
            const lh = parseFloat(lhStr || '0')
            const fs = parseFloat(fsStr || '0')
            const pt = parseFloat(csPre.paddingTop || '0')
            // 以 half-leading 修正：offset = max((lh - fs)/2, 0)
            let offset = 0
            if (isFinite(lh) && isFinite(fs) && lh > fs) offset = (lh - fs) / 2
            const padTop = Math.max(0, pt + offset)
            lnWrap.style.paddingTop = padTop + 'px'
          } catch {}
          let buf = ''
          for (let i = 0; i < lines.length; i++) buf += '<span class="ln">' + (i + 1) + '</span>'
          lnWrap.innerHTML = buf
          // 行号列宽按位数动态计算：CSS 固定 3.5em 约容纳 3 位数字，超过 999 行时
          // 按实际位数加宽（等宽字体 + tabular-nums 下每位数字恰为 1ch），
          // 并同步加宽 pre 的 padding-left 让位（需 important 压过 CSS 里的固定公式）
          const digits = String(lines.length).length
          if (digits > 3) {
            const colWidth = `calc(${digits}ch + 0.6em + 0.5ch)` // 数字区 + 左内边距 0.6em + 右内边距 0.5ch
            lnWrap.style.width = colWidth
            pre.style.setProperty('padding-left', `calc(var(--code-pre-pad-y, 20px) + ${digits}ch + 0.6em + 0.5ch + 1px)`, 'important')
          }
          pre.appendChild(lnWrap)
          // 微对齐：测量第一行在 pre 内的实际像素起点，修正与行号列的起点差（通常为 0~2px）
          try {
            const probe = document.createElement('span')
            probe.style.display = 'inline-block'
            probe.style.width = '0'; probe.style.height = '0'; probe.style.padding = '0'; probe.style.margin = '0'
            code.insertBefore(probe, code.firstChild)
            const preRect = pre.getBoundingClientRect()
            const probeRect = probe.getBoundingClientRect()
            const csPre2 = getComputedStyle(pre)
            const pt2 = parseFloat(csPre2.paddingTop || '0')
            const yFirst = (probeRect.top - preRect.top) + pre.scrollTop  // 代码第一行相对 pre 顶部位置
            const current = parseFloat(lnWrap.style.paddingTop || '0')
            const delta = Math.round(yFirst - current)
            if (isFinite(delta) && Math.abs(delta) <= 4) {
              lnWrap.style.paddingTop = (current + delta) + 'px'
            }
            probe.remove()
          } catch {}
        } catch {}
      }

      // 角标与复制按钮
      const badge = document.createElement('div')
      badge.className = 'code-lang'
      badge.textContent = lang
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'code-copy'
      // 与所见模式一致的图标按钮(feather copy 图标);
      // 反馈走 codeCopyEvents 图标分支:成功对勾/失败叉,1.2s 还原
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
      box.appendChild(badge)
      box.appendChild(btn)

      // 缩放按钮（复制按钮左侧，点击行为在 codeCopyEvents 的全局委托中统一处理）：
      // 仅当内容实际超高（限高生效）时显示，展开状态由 .codebox 上的 .code-expanded 标记
      const expandBtn = document.createElement('button')
      expandBtn.type = 'button'
      expandBtn.className = 'code-expand'
      expandBtn.title = '全高显示代码块'
      expandBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>'
      try {
        expandBtn.style.display = isCodeContentClipped(pre) ? '' : 'none'
      } catch {}
      box.appendChild(expandBtn)

      pre.setAttribute('data-codebox', '1')
    }
  } catch {}
}
