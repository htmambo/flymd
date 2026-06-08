// KaTeX 兜底 CSS 注入(抽离自 main.ts:465-506)
//
// 设计:
//   - factory createKatexCriticalStyle({ id }) → { ensure() }
//   - id 注入便于测试与避免多实例冲突
//   - 工厂无外部状态,ensure() 内部 idempotent(getElementById 早返)
//   - CSS 文本 verbatim 保留,作用域限制在 .preview-body 避免污染所见模式

export interface KatexCriticalStyleDeps {
  id: string
}

export interface KatexCriticalStyleApi {
  ensure(): void
}

export const KATEX_CRITICAL_STYLE_ID = 'flymd-katex-critical-style'

const KATEX_CRITICAL_CSS = `
      /* KaTeX critical styles：仅作为 CSS 动态加载失败时的兜底；作用域限制在预览区，避免污染所见模式 */
      .preview-body .katex svg {
        fill: currentColor;
        stroke: currentColor;
        fill-rule: nonzero;
        fill-opacity: 1;
        stroke-width: 1;
        stroke-linecap: butt;
        stroke-linejoin: miter;
        stroke-miterlimit: 4;
        stroke-dasharray: none;
        stroke-dashoffset: 0;
        stroke-opacity: 1;
        display: block;
        height: inherit;
        position: absolute;
        width: 100%;
      }
      .preview-body .katex svg path { stroke: none; }
      .preview-body .katex .stretchy { display: block; overflow: hidden; position: relative; width: 100%; }
      .preview-body .katex .hide-tail { overflow: hidden; position: relative; width: 100%; }
      .preview-body .katex .halfarrow-left { left: 0; overflow: hidden; position: absolute; width: 50.2%; }
      .preview-body .katex .halfarrow-right { overflow: hidden; position: absolute; right: 0; width: 50.2%; }
      .preview-body .katex .brace-left { left: 0; overflow: hidden; position: absolute; width: 25.1%; }
      .preview-body .katex .brace-center { left: 25%; overflow: hidden; position: absolute; width: 50%; }
      .preview-body .katex .brace-right { overflow: hidden; position: absolute; right: 0; width: 25.1%; }
      .preview-body .katex .x-arrow-pad { padding: 0 .5em; }
      .preview-body .katex .cd-arrow-pad { padding: 0 .55556em 0 .27778em; }
      .preview-body .katex .mover,
      .preview-body .katex .munder,
      .preview-body .katex .x-arrow { text-align: center; }
    `

export function createKatexCriticalStyle(deps: KatexCriticalStyleDeps): KatexCriticalStyleApi {
  const { id } = deps
  return {
    ensure(): void {
      try {
        if (document.getElementById(id)) return
        const styleEl = document.createElement('style')
        styleEl.id = id
        styleEl.textContent = KATEX_CRITICAL_CSS
        document.head.appendChild(styleEl)
      } catch {}
    },
  }
}
