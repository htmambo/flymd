// 应用内确认弹窗：替代 Tauri 原生 ask/window.confirm。
// 原生对话框位置由窗口管理器决定（部分 Linux WM 会落在屏幕左上角），
// 应用内弹窗居中于窗口、跟随应用亮/暗主题，位置与样式完全可控。
import { t } from '../i18n'

export function confirmDialog(message: string, title = '确认'): Promise<boolean> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null

    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'
    overlay.innerHTML = `
      <div class="confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="confirm-header"></div>
        <div class="confirm-body"></div>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn-cancel"></button>
          <button type="button" class="confirm-btn-ok"></button>
        </div>
      </div>
    `
    const header = overlay.querySelector('.confirm-header') as HTMLElement
    const body = overlay.querySelector('.confirm-body') as HTMLElement
    const btnCancel = overlay.querySelector('.confirm-btn-cancel') as HTMLButtonElement
    const btnOk = overlay.querySelector('.confirm-btn-ok') as HTMLButtonElement
    header.textContent = title
    body.textContent = message
    btnCancel.textContent = t('dlg.cancel') || '取消'
    btnOk.textContent = t('dlg.ok') || '确定'

    let closed = false
    const close = (result: boolean) => {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      try { prevFocus?.focus() } catch {}
      resolve(result)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); close(true) }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(false) }
    }

    btnOk.addEventListener('click', () => close(true))
    btnCancel.addEventListener('click', () => close(false))
    // 点击遮罩空白处视为取消
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(false) })
    // capture 阶段拦截，避免 Enter/Esc 穿透到编辑器
    document.addEventListener('keydown', onKey, true)

    document.body.appendChild(overlay)
    btnOk.focus()
  })
}
