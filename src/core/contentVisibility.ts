// 离屏渲染裁剪（content-visibility）的克隆体兜底（perf 批次 I）
//
// 背景：大文档（数百个以上代码围栏）下，预览里的 .codebox 会带
// `content-visibility: auto`（见 styles/code-block-decoration.css），
// 离屏代码块跳过布局与绘制——这是大文档滚动流畅度的关键优化。
//
// 但打印 / PDF 导出 / DOCX 导出都是 cloneNode(true) 克隆预览 DOM，
// 克隆体会把 content-visibility 一并带走。而这些副本需要**全部**内容被渲染，
// 否则离屏代码块会在打印稿与导出文件里整块缺失。
//
// 因此克隆完成后统一把 content-visibility 恢复为 visible。
// 独立模块、零依赖：打印/导出链路不引入 Tauri API 与图片解析的静态闭包。
//
// 解除方式说明（外部审查确认）：
//   内联 `contentVisibility = 'visible'` 必须显式写 'visible'，**不能**写 ''——
//   样式表规则 `.codebox.codebox-cv { content-visibility: auto }` 会在写 '' 时
//   重新生效，把离屏裁剪又装回去。同时移除 `codebox-cv` 类，双保险：
//   引擎若只认样式表不认内联属性，类被移除后同样回落到 visible。

/**
 * 离屏裁剪的载体类名。
 * 三方契约：decorate.ts 打上它 → 样式表 `.codebox.codebox-cv` 生效 →
 * 本模块在克隆体上移除它。三处共用同一常量，避免改名后静默失效。
 */
export const CODEBOX_CV_CLASS = 'codebox-cv'

export function releaseClonedContentVisibility(clone: ParentNode): void {
  try {
    const targets = clone.querySelectorAll<HTMLElement>(`.${CODEBOX_CV_CLASS}`)
    if (targets.length === 0) return
    for (const el of targets) {
      el.classList.remove(CODEBOX_CV_CLASS)
      el.style.contentVisibility = 'visible'
      // contain-intrinsic-size 仅在 content-visibility 非 visible 时生效，
      // 这里显式清空，避免内联残留。
      el.style.containIntrinsicSize = ''
    }
  } catch (err) {
    // 导出不因兜底失败而中断，但留痕便于回归定位
    // （console 在受限 iframe 里也可能不可用，故再包一层 try）
    try { console.warn('[releaseClonedContentVisibility] 解裁剪失败:', err) } catch {}
  }
}
