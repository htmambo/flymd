// 代码块"缩放"按钮的显隐判定：内容是否实际被限高裁剪。
// 不能用 pre.scrollHeight > pre.clientHeight —— 所见模式的语言选择器
// （.code-lang-selector，position:absolute; bottom:-36px）故意溢出 pre 底部 36px，
// 会使 pre.scrollHeight 恒比 clientHeight 大 36px，判定永远为真、按钮常驻。
// 这里以"代码内容自身的实际高度"（.code-layers / code.hljs）对比 pre 可用内容区高度。

export function isCodeContentClipped(pre: HTMLElement): boolean {
  try {
    const inner = pre.querySelector('.code-layers') || pre.querySelector('code')
    if (!inner) return false
    const cs = getComputedStyle(pre)
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const avail = pre.clientHeight - padV
    if (avail <= 0) return false
    return inner.getBoundingClientRect().height > avail + 4
  } catch {
    return false
  }
}
