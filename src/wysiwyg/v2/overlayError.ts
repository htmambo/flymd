// 所见模式浮层编辑：统一的错误提示条
// 用于在 KaTeX / 图片源码编辑弹层顶部展示"应用失败"等错误信息
// 设计要点：
// - 错误条由 attachOverlayError 在浮层构造时挂载一次，整个 apply() 流程复用同一个 handle
// - 默认隐藏（display:none），调用 setError(err) 后通过 data-visible="1" 切换为可见
// - 与项目主题一致：在 body.dark-mode 下切换为深色配色

export interface OverlayErrorHandle {
  setError(err: unknown): void
  clear(): void
  el: HTMLElement
}

export function attachOverlayError(overlayWrap: HTMLElement): OverlayErrorHandle {
  const bar = document.createElement('div')
  bar.className = 'ov-error-bar'
  bar.setAttribute('role', 'alert')
  bar.dataset.visible = '0'
  // 插到最前面，确保覆盖 textarea 之上的视觉位置
  try {
    if (overlayWrap.firstChild) overlayWrap.insertBefore(bar, overlayWrap.firstChild)
    else overlayWrap.appendChild(bar)
  } catch {
    overlayWrap.appendChild(bar)
  }

  const setError = (err: unknown) => {
    try {
      let msg = ''
      if (err == null) msg = ''
      else if (typeof err === 'string') msg = err
      else if (err instanceof Error) msg = err.message
      else if (typeof (err as any)?.message === 'string' && (err as any).message) msg = (err as any).message
      else {
        try { msg = String(err) } catch { msg = '未知错误' }
      }
      bar.textContent = msg || '操作失败'
      bar.dataset.visible = '1'
    } catch {
      bar.textContent = '操作失败'
      bar.dataset.visible = '1'
    }
  }

  const clear = () => {
    try {
      bar.textContent = ''
      bar.dataset.visible = '0'
    } catch {}
  }

  return { setError, clear, el: bar }
}
