// 预览消毒策略与开关（从 main.ts 拆分）

// 消毒配置：只保留 HTML profile（预览不需要 SVG/MathML；KaTeX 与 Mermaid 都是
// 消毒之后才由各自渲染器写入 DOM），并剥离：
// - 所有事件属性与 javascript: URL（DOMPurify 默认行为）
// - style 属性：可构造 `position:fixed;inset:0;z-index:99999` 的全屏伪 UI 覆盖层
// - form/input(非 checkbox)/button/dialog 等可伪装登录/确认框的节点
// data-* 保留给 KaTeX 占位符（data-math）与 Mermaid 占位（class 即可）。
export const PREVIEW_SANITIZE_CONFIG = {
  ADD_ATTR: ['target'],
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  // 允许 SVG：markdown-it-callout 的图标/折叠/复制按钮是内联 SVG，
  // 只开 html profile 会把它们全部剥掉。DOMPurify 的 SVG profile 仍会
  // 剥离 script/foreignObject/事件属性，风险可控。
  USE_PROFILES: { html: true, svg: true },
  FORBID_ATTR: ['style'],
  FORBID_TAGS: [
    'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta',
    'dialog', 'template', 'slot', 'marquee', 'select', 'textarea', 'button',
    // SVG 只用于 callout 图标；image/use/foreignObject 可被用来加载外部资源或嵌套 HTML
    'image', 'use', 'foreignObject',
  ],
} as const

/**
 * 统一的预览消毒入口。
 * 额外策略在**每次调用**的 DOM 上执行，而不是给 DOMPurify 单例挂全局 hook：
 * 同一份 DOMPurify 实例还被剪贴板粘贴、所见模式、更新弹窗复用，全局 hook 会让
 * 这些路径的行为依赖“预览是否先跑过”，产生顺序相关副作用。
 * - 任务列表保留 checkbox；其它 input（尤其 password）移除，防止钓鱼表单
 * - target=_blank 自动补 rel=noopener noreferrer
 * 调用方负责在异常时 fail-closed（见 main.ts 的 sanitizePreviewHtml）。
 */
export function sanitizePreviewWith(dompurify: any, html: string): string {
  const clean = dompurify.sanitize(html, PREVIEW_SANITIZE_CONFIG as any)
  try {
    const tpl = document.createElement('template')
    tpl.innerHTML = clean
    const root = tpl.content
    root.querySelectorAll('input').forEach((node: Element) => {
      const type = String(node.getAttribute('type') || '').toLowerCase()
      if (type !== 'checkbox') node.remove()
    })
    root.querySelectorAll('a[target="_blank"]').forEach((node: Element) => {
      node.setAttribute('rel', 'noopener noreferrer')
    })
    return tpl.innerHTML
  } catch {
    // DOM 后处理失败时仍返回已消毒内容（DOMPurify 已剥离事件属性）
    return clean
  }
}

// 预览消毒开关：默认**开启**，发行版不可关闭。
// 历史上发行版默认关闭过（为了定位渲染差异），但那会让 markdown 里的原始 HTML
// 直接进入 webview：`<img onerror>` 一类属性在 html:true + 无 CSP 下可执行任意 JS。
// 排障用的 localStorage 逃生开关仅在开发环境生效（导入的恶意内容/插件可写
// localStorage，发行版保留开关等于保留一个持久化的关闭入口）。
export function shouldSanitizePreview(): boolean {
  try {
    const isDev = !!((import.meta as any).env?.DEV)
    if (!isDev) return true
    const v = localStorage.getItem('flymd:sanitizePreview')
    if (v != null) {
      const s = String(v).toLowerCase()
      if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false
      if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true
    }
  } catch {}
  return true
}
