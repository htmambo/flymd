// 剪贴板写入工具
// 背景:Tauri macOS (WKWebView) 下 navigator.clipboard.writeText 常被拒绝,
// 而 execCommand('copy') 静默返回 false 时旧逻辑仍当作成功(按钮显示"已复制"但剪贴板为空)。
// 策略:Tauri 运行时优先走原生插件(tauri-plugin-clipboard-manager,不依赖 WebKit 权限),
// 其次 navigator.clipboard,最后 textarea + execCommand(检查返回值,不再无条件视为成功)。

function isTauriRuntime(): boolean {
  try {
    return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
  } catch {}
  return false
}

/** 把 text 写入系统剪贴板;返回是否真正成功。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // 1) Tauri 原生剪贴板(最可靠,绕开 WKWebView 的 clipboard 权限限制)
  if (isTauriRuntime()) {
    try {
      const mod = await import('@tauri-apps/plugin-clipboard-manager')
      await mod.writeText(text)
      return true
    } catch {}
  }
  // 2) Web Clipboard API(浏览器 dev / WKWebView 未拒绝时)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {}
  // 3) textarea + execCommand 兜底(检查返回值,失败则如实上报)
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return !!ok
  } catch {}
  return false
}
