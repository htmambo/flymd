// 代码块自动换行全局开关：状态存 localStorage，开启时 body 加 .code-wrap class，
// 阅读/可见两个模式的换行样式全部通过该 class 以纯 CSS 生效（可见模式避免直接
// 改 pre class，防止触发 automd 读 DOM → 节点重建的无限循环）。
// 变更时派发 flymd:codeWrap:changed，阅读模式监听后重渲染以重算行号高度。

const CODE_WRAP_KEY = 'flymd:codeWrap:enabled'
export const CODE_WRAP_CHANGED_EVENT = 'flymd:codeWrap:changed'

export function isCodeWrapEnabled(): boolean {
  try {
    return localStorage.getItem(CODE_WRAP_KEY) === 'true'
  } catch {
    return false
  }
}

function applyCodeWrapClass(enabled: boolean): void {
  try {
    document.body.classList.toggle('code-wrap', enabled)
  } catch {}
}

export function setCodeWrapEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CODE_WRAP_KEY, enabled ? 'true' : 'false')
  } catch {}
  applyCodeWrapClass(enabled)
  try {
    const ev = new CustomEvent(CODE_WRAP_CHANGED_EVENT, { detail: { enabled } })
    window.dispatchEvent(ev)
  } catch {}
}

// 启动时按存储值恢复 body class（不派事件，避免无谓的重渲染）
export function initCodeWrap(): void {
  applyCodeWrapClass(isCodeWrapEnabled())
}
