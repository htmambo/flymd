// WYSIWYG 模式 caret 反馈 + 虚拟 padding 工具集
// 抽离自 main.ts:2155-2310。
// 抽离理由:5 个函数聚类成完整的"WYSIWYG caret 渲染反馈"子系统,
// 共享 main-local 引用(editor / preview / wysiwygLineEl / wysiwygCaretEl / wysiwyg 模式),
// 全部用 getter 注入;模块级缓存(_caretCharWidth / _caretFontKey /
// _wysiwygCaretLineIndex / _wysiwygCaretVisualColumn)闭包到工厂内部;
// _editorPadBottomBasePx 因 main.ts 还有 2 处外部写入,走 getter/setter 注入
// 保持 main-local 单一事实源。
//
// 显式依赖视觉列号工具(calcVisualColumn / offsetForVisualColumn),从
// src/utils/visualColumn.ts 复用,不重新实现。

import { calcVisualColumn, offsetForVisualColumn } from '../utils/visualColumn'

export interface WysiwygCaretDeps {
  /** 当前是否为 wysiwyg 模式(true 时才执行实质操作) */
  getWysiwyg: () => boolean
  /** 主编辑器 textarea(读 selectionStart/value/写 selectionStart) */
  getEditor: () => HTMLTextAreaElement
  /** 预览容器(查 .caret-dot + scrollTop/Height) */
  getPreview: () => HTMLElement
  /** 行高亮覆盖层 div(写 style.top/height) */
  getLineEl: () => HTMLDivElement | null
  /** caret dot 元素(写 style.top/left + show class) */
  getCaretEl: () => HTMLDivElement | null
  /** editor padding-bottom 基线 px(main-local 模块级变量,工厂用 getter/setter 保持共享) */
  getPadBottomBasePx: () => number
  setPadBottomBasePx: (n: number) => void
}

export interface WysiwygCaretApi {
  /** 更新行高亮覆盖层位置(基于当前 selectionStart + lineHeight + scrollTop) */
  updateWysiwygLineHighlight: () => void
  /** 测量等宽字符宽度(canvas measureText,带 font 缓存) */
  measureCharWidth: () => number
  /** 按视觉列号纵向移动 caret(保留 preferred column) */
  moveWysiwygCaretByLines: (deltaLines: number, preferredColumn?: number) => number
  /** 更新 caret dot 位置 + show class(系统光标覆盖) */
  updateWysiwygCaretDot: () => void
  /** 动态补齐 editor padding-bottom,确保预览可滚动到末尾 */
  updateWysiwygVirtualPadding: () => void
  /** 滚动 preview 确保 .caret-dot 元素进入可视区 */
  ensureWysiwygCaretDotInView: () => void
  /** 读当前 caret 的视觉列号(供外部 nudge 调用方复用) */
  getVisualColumn: () => number
}

export function createWysiwygCaret(deps: WysiwygCaretDeps): WysiwygCaretApi {
  // 模块级缓存 — 原 main.ts 的 _wysiwygCaretLineIndex / _wysiwygCaretVisualColumn
  // / _caretCharWidth / _caretFontKey 全部闭包到这里。
  let _wysiwygCaretLineIndex = 0
  let _wysiwygCaretVisualColumn = 0
  let _caretCharWidth = 0
  let _caretFontKey = ''
  // measureCharWidth 的 canvas 缓存也闭包
  let _measureCanvas: HTMLCanvasElement | null = null

  function measureCharWidth(): number {
    try {
      const editor = deps.getEditor()
      const style = window.getComputedStyle(editor)
      const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`
      if (_caretCharWidth > 0 && _caretFontKey === font) return _caretCharWidth
      const canvas = _measureCanvas || document.createElement('canvas')
      _measureCanvas = canvas
      const ctx = canvas.getContext('2d')
      if (!ctx) return _caretCharWidth || 8
      ctx.font = font
      // 使用 '0' 作为等宽参考字符
      const w = ctx.measureText('0').width
      if (w && w > 0) {
        _caretCharWidth = w
        _caretFontKey = font
      }
      return _caretCharWidth || 8
    } catch {
      return _caretCharWidth || 8
    }
  }

  function updateWysiwygLineHighlight() {
    try {
      if (!deps.getWysiwyg()) return
      const lineEl = deps.getLineEl()
      if (!lineEl) return
      const editor = deps.getEditor()
      const st = editor.selectionStart >>> 0
      const before = editor.value.slice(0, st)
      const lineIdx = before.split('\n').length - 1
      _wysiwygCaretLineIndex = lineIdx
      const style = window.getComputedStyle(editor)
      let lh = parseFloat(style.lineHeight || '')
      if (!lh || Number.isNaN(lh)) {
        const fs = parseFloat(style.fontSize || '16') || 16
        lh = fs * 1.6
      }
      const padTop = parseFloat(style.paddingTop || '0') || 0
      const top = Math.max(0, Math.round(padTop + lineIdx * lh - editor.scrollTop))
      lineEl.style.top = `${top}px`
      lineEl.style.height = `${lh}px`
      // 不再显示高亮行,只更新位置(如需恢复,改为添加 show 类)
    } catch {}
  }

  function moveWysiwygCaretByLines(deltaLines: number, preferredColumn?: number): number {
    try {
      if (!deps.getWysiwyg()) return 0
      if (!Number.isFinite(deltaLines) || deltaLines === 0) return 0
      const editor = deps.getEditor()
      if (editor.selectionStart !== editor.selectionEnd) return 0
      const value = editor.value
      if (!value) return 0
      const len = value.length
      const pos = editor.selectionStart >>> 0
      let lineStart = pos
      while (lineStart > 0 && value.charCodeAt(lineStart - 1) !== 10) lineStart--
      const currentSegment = value.slice(lineStart, pos)
      let column = Number.isFinite(preferredColumn) ? Number(preferredColumn) : calcVisualColumn(currentSegment)
      if (!Number.isFinite(column) || column < 0) column = 0
      const steps = deltaLines > 0 ? Math.floor(deltaLines) : Math.ceil(deltaLines)
      if (steps === 0) return 0
      let moved = 0
      if (steps > 0) {
        let remaining = steps
        while (remaining > 0) {
          const nextNl = value.indexOf('\n', lineStart)
          if (nextNl < 0) { lineStart = len; break }
          lineStart = nextNl + 1
          moved++
          remaining--
        }
      } else {
        let remaining = steps
        while (remaining < 0) {
          if (lineStart <= 0) { lineStart = 0; break }
          const prevNl = value.lastIndexOf('\n', Math.max(0, lineStart - 2))
          lineStart = prevNl >= 0 ? prevNl + 1 : 0
          moved--
          remaining++
        }
      }
      if (moved === 0) return 0
      let lineEnd = value.indexOf('\n', lineStart)
      if (lineEnd < 0) lineEnd = len
      const targetLine = value.slice(lineStart, lineEnd)
      const offset = offsetForVisualColumn(targetLine, column)
      const newPos = lineStart + offset
      editor.selectionStart = editor.selectionEnd = newPos
      return moved
    } catch {
      return 0
    }
  }

  function updateWysiwygCaretDot() {
    try {
      if (!deps.getWysiwyg()) return
      const caretEl = deps.getCaretEl()
      if (!caretEl) return
      // 方案A:使用原生系统光标,禁用自定义覆盖光标
      try { caretEl.classList.remove('show') } catch {}
      const editor = deps.getEditor()
      const st = editor.selectionStart >>> 0
      const before = editor.value.slice(0, st)
      const style = window.getComputedStyle(editor)
      // 行高
      let lh = parseFloat(style.lineHeight || '')
      if (!lh || Number.isNaN(lh)) {
        const fs = parseFloat(style.fontSize || '16') || 16
        lh = fs * 1.6
      }
      const padTop = parseFloat(style.paddingTop || '0') || 0
      const padLeft = parseFloat(style.paddingLeft || '0') || 0
      // 计算当前行与列
      const lastNl = before.lastIndexOf('\n')
      const colStr = lastNl >= 0 ? before.slice(lastNl + 1) : before
      const lineIdx = before.split('\n').length - 1
      // 制表符按 4 个空格估算
      const tab4 = (s: string) => s.replace(/\t/g, '    ')
      const colLen = tab4(colStr).length
      _wysiwygCaretVisualColumn = colLen
      const ch = measureCharWidth()
      const top = Math.max(0, Math.round(padTop + lineIdx * lh - editor.scrollTop))
      const left = Math.max(0, Math.round(padLeft + colLen * ch - editor.scrollLeft))
      // 将光标放在当前行底部,并略微向下微调
      const caretH = (() => { try { return parseFloat(window.getComputedStyle(caretEl).height || '2') || 2 } catch { return 2 } })()
      const baseNudge = 1 // 像素级微调,使光标更贴近底部
      caretEl.style.top = `${Math.max(0, Math.round(top + lh - caretH + baseNudge))}px`
      caretEl.style.left = `${left}px`
      caretEl.classList.add('show')
    } catch {}
  }

  function updateWysiwygVirtualPadding() {
    try {
      const editor = deps.getEditor()
      const preview = deps.getPreview()
      const isWysiwyg = deps.getWysiwyg()
      // 基线与 CSS 对齐(包含文末留白);仅旧所见模式需要"动态补齐"滚动空间
      if (!isWysiwyg) {
        try { (editor as any).style.paddingBottom = '' } catch {}
        try {
          const cur = parseFloat(window.getComputedStyle(editor).paddingBottom || '40') || deps.getPadBottomBasePx()
          deps.setPadBottomBasePx(cur)
        } catch {}
        return
      }
      const base = deps.getPadBottomBasePx() || 40
      const er = Math.max(0, editor.scrollHeight - editor.clientHeight)
      const pr = Math.max(0, preview.scrollHeight - preview.clientHeight)
      const need = Math.max(0, pr - er)
      const pb = Math.min(100000, Math.round(base + need))
      try { (editor as any).style.paddingBottom = pb + "px" } catch {}
    } catch {}
  }

  function ensureWysiwygCaretDotInView() {
    try {
      if (!deps.getWysiwyg()) return
      const preview = deps.getPreview()
      const dot = preview.querySelector('.caret-dot') as HTMLElement | null
      if (!dot) return
      const pv = preview.getBoundingClientRect()
      const dr = dot.getBoundingClientRect()
      const margin = 10
      if (dr.top < pv.top + margin) {
        preview.scrollTop += dr.top - (pv.top + margin)
      } else if (dr.bottom > pv.bottom - margin) {
        preview.scrollTop += dr.bottom - (pv.bottom - margin)
      }
    } catch {}
  }

  return {
    updateWysiwygLineHighlight,
    measureCharWidth,
    moveWysiwygCaretByLines,
    updateWysiwygCaretDot,
    updateWysiwygVirtualPadding,
    ensureWysiwygCaretDotInView,
    getVisualColumn: () => _wysiwygCaretVisualColumn,
  }
}
