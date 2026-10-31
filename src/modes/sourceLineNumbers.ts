import { logInfo, logDebug } from '../core/logger'
import {
  SOURCE_LINE_NUMBERS_CHANGED_EVENT,
  getSourceLineNumbersEnabled,
} from '../core/sourceLineNumbersPref'

type EditorMode = 'edit' | 'preview'

type Metrics = {
  contentWidth: number
  paddingTop: number
  paddingBottom: number
  lineHeight: number
}

type LinePatch = {
  startLine: number
  oldLineCount: number
  newLines: string[]
}

type InputPatchHint = {
  startLine: number
  oldLineCount: number
  startLinePos: number
  endLinePos: number
}

type VisibleRange = {
  startLine: number
  endLine: number
}

// Ctrl+滚轮每 tick 都派发 uiZoom:changed；trailing 防抖把手势期间的 layout 刷新
// 合并为一次，避免大文档缩放时逐 tick 触发 remeasureAll（每行一次强制 reflow）
const ZOOM_LAYOUT_DEBOUNCE_MS = 120

function px(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function getFlymd(): any {
  return window as any
}

function getEditorMode(): EditorMode {
  try {
    return (getFlymd().flymdGetMode?.() ?? 'edit') as EditorMode
  } catch {
    return 'edit'
  }
}

function isWysiwygMode(): boolean {
  try {
    return !!getFlymd().flymdGetWysiwygEnabled?.()
  } catch {
    return false
  }
}

function splitLines(text: string): string[] {
  return String(text || '').split('\n')
}

function buildLineStarts(lines: string[]): number[] {
  const starts = new Array<number>(lines.length)
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos
    pos += lines[i].length + 1
  }
  return starts
}

function rebuildLineStartsFrom(lines: string[], lineStarts: number[], startLine: number): void {
  if (!lines.length) {
    lineStarts.length = 0
    return
  }
  let pos = 0
  if (startLine > 0) {
    const prev = startLine - 1
    pos = lineStarts[prev] + lines[prev].length + 1
  }
  for (let i = startLine; i < lines.length; i++) {
    lineStarts[i] = pos
    pos += lines[i].length + 1
  }
  lineStarts.length = lines.length
}

function rebuildRowOffsetsFrom(rowHeights: number[], rowOffsets: number[], startLine: number): number {
  if (!rowHeights.length) {
    rowOffsets.length = 0
    return 0
  }
  if (startLine <= 0) {
    rowOffsets[0] = 0
    startLine = 1
  }
  for (let i = startLine; i < rowHeights.length; i++) {
    rowOffsets[i] = rowOffsets[i - 1] + rowHeights[i - 1]
  }
  rowOffsets.length = rowHeights.length
  return rowOffsets[rowHeights.length - 1] + rowHeights[rowHeights.length - 1]
}

function findLineByPos(lineStarts: number[], pos: number, textLength: number): number {
  if (!lineStarts.length) return 0
  const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= safePos) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(hi, lineStarts.length - 1))
}

function findLineByYOffset(rowOffsets: number[], offset: number, totalHeight: number): number {
  if (!rowOffsets.length) return 0
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, totalHeight - 1)))
  let lo = 0
  let hi = rowOffsets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rowOffsets[mid] <= safeOffset) lo = mid + 1
    else hi = mid - 1
  }
  return Math.max(0, Math.min(hi, rowOffsets.length - 1))
}

// perf 批次 H3：读走内存缓存（与 theme.ts 共用同一份缓存与同一个键）

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++
  return i
}

function createLinePatch(
  prevText: string,
  nextText: string,
  prevLines: string[],
  prevLineStarts: number[],
): LinePatch | null {
  if (prevText === nextText) return null
  const prefix = commonPrefixLength(prevText, nextText)
  const suffix = commonSuffixLength(prevText, nextText, prefix)
  const oldChangeStart = prefix
  const oldChangeEnd = prevText.length - suffix
  const newChangeEnd = nextText.length - suffix
  const startLine = findLineByPos(prevLineStarts, oldChangeStart, prevText.length)
  const endLine = findLineByPos(prevLineStarts, Math.max(oldChangeStart, oldChangeEnd), prevText.length)
  const startLinePos = prevLineStarts[startLine] ?? 0
  const endLinePos = (prevLineStarts[endLine] ?? 0) + (prevLines[endLine]?.length ?? 0)
  const prefixFragment = prevText.slice(startLinePos, oldChangeStart)
  const suffixFragment = prevText.slice(oldChangeEnd, endLinePos)
  const replacement = prefixFragment + nextText.slice(oldChangeStart, newChangeEnd) + suffixFragment
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    newLines: splitLines(replacement),
  }
}

function createInputPatchHint(
  lines: string[],
  lineStarts: number[],
  textLength: number,
  startPos: number,
  endPos: number,
): InputPatchHint | null {
  if (!lines.length || !lineStarts.length) return null
  const safeStart = Math.max(0, Math.min(startPos >>> 0, textLength))
  const safeEnd = Math.max(safeStart, Math.min(endPos >>> 0, textLength))
  const startLine = findLineByPos(lineStarts, safeStart, textLength)
  const endLine = findLineByPos(lineStarts, safeEnd, textLength)
  return {
    startLine,
    oldLineCount: Math.max(1, endLine - startLine + 1),
    startLinePos: lineStarts[startLine] ?? 0,
    endLinePos: (lineStarts[endLine] ?? 0) + (lines[endLine]?.length ?? 0),
  }
}

function createLinePatchFromHint(prevText: string, nextText: string, hint: InputPatchHint): LinePatch | null {
  const tailLength = Math.max(0, prevText.length - hint.endLinePos)
  const nextEndLinePos = Math.max(hint.startLinePos, nextText.length - tailLength)
  if (nextEndLinePos < hint.startLinePos) return null
  return {
    startLine: hint.startLine,
    oldLineCount: hint.oldLineCount,
    newLines: splitLines(nextText.slice(hint.startLinePos, nextEndLinePos)),
  }
}

function readMetrics(editor: HTMLTextAreaElement): Metrics {
  const style = window.getComputedStyle(editor)
  const paddingLeft = px(style.paddingLeft)
  const paddingRight = px(style.paddingRight)
  let lineHeight = px(style.lineHeight)
  if (!lineHeight) {
    const fontSize = px(style.fontSize, 16)
    lineHeight = fontSize * 1.7
  }
  return {
    contentWidth: Math.max(0, editor.clientWidth - paddingLeft - paddingRight),
    paddingTop: px(style.paddingTop),
    paddingBottom: px(style.paddingBottom),
    lineHeight,
  }
}

function applyMeasureStyle(
  shell: HTMLDivElement,
  editor: HTMLTextAreaElement,
  gutter: HTMLDivElement,
  measure: HTMLDivElement,
  metrics: Metrics,
): string {
  const style = window.getComputedStyle(editor)
  const shared: Array<[string, string]> = [
    ['fontFamily', style.fontFamily],
    ['fontSize', style.fontSize],
    ['fontWeight', style.fontWeight],
    ['fontStyle', style.fontStyle],
    ['lineHeight', style.lineHeight],
    ['letterSpacing', style.letterSpacing],
    ['tabSize', (style as any).tabSize || '4'],
  ]
  for (const [key, value] of shared) {
    try {
      ;(gutter.style as any)[key] = value
      ;(measure.style as any)[key] = value
    } catch {}
  }
  shell.style.setProperty('--editor-line-height', `${metrics.lineHeight}px`)
  gutter.style.paddingTop = `${metrics.paddingTop}px`
  gutter.style.paddingBottom = `${metrics.paddingBottom}px`
  measure.style.width = `${metrics.contentWidth}px`
  return [
    editor.clientWidth,
    metrics.contentWidth,
    metrics.paddingTop,
    metrics.paddingBottom,
    metrics.lineHeight,
    style.fontFamily,
    style.fontSize,
    style.letterSpacing,
    style.fontWeight,
    style.fontStyle,
    (style as any).tabSize || '4',
  ].join('|')
}

function createRow(): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'editor-line-number'
  return row
}

function setRowGeometry(row: HTMLDivElement, top: number, height: number): void {
  row.style.top = `${top}px`
  row.style.height = `${height}px`
}

function measureLineHeight(
  probe: HTMLDivElement,
  metrics: Metrics,
  lineText: string,
): number {
  probe.textContent = lineText || '\u200b'
  return Math.max(metrics.lineHeight, probe.offsetHeight || 0)
}

/**
 * 批量行高测量（perf 批次 H）：把行文本作为 editor-line-measure-row 挂入与单 probe
 * 同继承样式的容器，分块"一次挂行 → 一次读取"，把 O(N) 次强制布局压成 ⌈N/块⌉ 次。
 * 测量公式与 measureLineHeight 逐字一致：max(lineHeight, offsetHeight || 0)。
 * 返回值与 texts 一一对应；调用后容器恢复原状（行全部移除）。
 */
export function measureLineHeightsBatched(
  container: HTMLElement,
  texts: string[],
  lineHeight: number,
  batchSize = 4096,
): number[] {
  const out: number[] = []
  for (let base = 0; base < texts.length; base += batchSize) {
    const chunk = texts.slice(base, base + batchSize)
    const rows: HTMLDivElement[] = []
    for (const text of chunk) {
      const row = document.createElement('div')
      row.className = 'editor-line-measure-row'
      row.textContent = text || '\u200b'
      container.appendChild(row)
      rows.push(row)
    }
    for (let i = 0; i < chunk.length; i++) {
      out.push(Math.max(lineHeight, rows[i].offsetHeight || 0))
    }
    for (const row of rows) row.remove()
  }
  return out
}

function setActiveRow(
  renderedRows: HTMLDivElement[],
  renderedStartLine: number,
  renderedEndLine: number,
  lineCount: number,
  nextRow: number,
  prevRow: number,
): number {
  const maxRow = Math.max(1, lineCount || 1)
  const safeRow = Math.max(1, Math.min(nextRow, maxRow))
  if (prevRow > 0 && prevRow !== safeRow) {
    const prevIndex = prevRow - 1
    if (prevIndex >= renderedStartLine && prevIndex < renderedEndLine) {
      renderedRows[prevIndex - renderedStartLine]?.classList.remove('active')
    }
  }
  const nextIndex = safeRow - 1
  if (nextIndex >= renderedStartLine && nextIndex < renderedEndLine) {
    renderedRows[nextIndex - renderedStartLine]?.classList.add('active')
  }
  return safeRow
}

function hookEditorTextMutations(editor: HTMLTextAreaElement, onTextChanged: () => void): void {
  try {
    const valueDesc =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (valueDesc?.get && valueDesc?.set) {
      const readValue = () => String(valueDesc.get!.call(editor) || '')
      const writeValue = (next: string) => valueDesc.set!.call(editor, next)
      Object.defineProperty(editor, 'value', {
        configurable: true,
        enumerable: valueDesc.enumerable ?? true,
        get() {
          return readValue()
        },
        set(next: string) {
          const prev = readValue()
          writeValue(next)
          if (readValue() !== prev) onTextChanged()
        },
      })
    }
  } catch {}

  try {
    const originalSetRangeText = editor.setRangeText.bind(editor)
    ;(editor as any).setRangeText = (...args: any[]) => {
      const prev = String(editor.value || '')
      // setRangeText(text, start?, end?, mode?)；这里作为通用代理把 args 透传给
      // 原方法，TS 5.4+ 收紧"任意数组 spread 给 rest"规则，用断言表达意图
      // setRangeText 形参固定为 (text, start, end, mode?)；作为通用代理透传 args
      // 用 Parameters 推导原方法形参，避免 TS 5.4+ "任意数组 spread 给 rest" 报错
      const result = originalSetRangeText(...(args as Parameters<typeof editor.setRangeText>))
      if (String(editor.value || '') !== prev) onTextChanged()
      return result
    }
  } catch {}
}

function installLineNumbers(): void {
  try {
    const editor = document.getElementById('editor') as HTMLTextAreaElement | null
    if (!editor) return
    const flymd = getFlymd()
    if (flymd.__flymdSourceLineNumbersInit) return

    // 防御：若编辑器已被移进 .editor-shell，说明上次安装在"移动编辑器"那一步之后
    // 中断过（外壳可能已就位，标志却没置上）。此时只补标志，避免二次插入
    // 把外壳插进自己的后代而触发层级错误，把安装永久卡死。
    const existingShell = editor.parentElement?.parentElement
    if (existingShell && existingShell.classList.contains('editor-shell')) {
      flymd.__flymdSourceLineNumbersInit = true
      return
    }

    const shell = document.createElement('div')
    shell.className = 'editor-shell'

    const gutter = document.createElement('div')
    gutter.className = 'editor-gutter'
    gutter.setAttribute('aria-hidden', 'true')

    const lineNumbers = document.createElement('div')
    lineNumbers.className = 'editor-line-numbers'
    gutter.appendChild(lineNumbers)

    const surface = document.createElement('div')
    surface.className = 'editor-surface'

    const measure = document.createElement('div')
    measure.className = 'editor-line-measure'
    measure.setAttribute('aria-hidden', 'true')

    const measureProbe = document.createElement('div')
    measureProbe.className = 'editor-line-measure-row'
    measure.appendChild(measureProbe)

    const parent = editor.parentElement
    if (!parent) return
    // 先在游离状态组装完整子树，最后一次性插入 DOM：
    // 中途抛错不会在页面上留下半成品外壳，也就不会让后续重试插入第二个外壳。
    shell.appendChild(gutter)
    shell.appendChild(surface)
    surface.appendChild(measure)
    parent.insertBefore(shell, editor)
    // 编辑器本体移入 surface（同一棵树内的移动，不会失败）
    surface.appendChild(editor)

    // DOM 全部就位后才置幂等标志。早置会在"编辑器尚未挂载"（parent 为空）时
    // 把这次安装机会永久消耗掉——装不成行号列，且本会话再也不会重来，
    // 退化回"只能重启才看得到"的失败形态。
    flymd.__flymdSourceLineNumbersInit = true

    let lastText = String(editor.value || '')
    let lastMetricsKey = ''
    let activeRow = 0
    let lines: string[] = splitLines(lastText)
    let lineStarts: number[] = buildLineStarts(lines)
    let rowHeights: number[] = []
    let rowOffsets: number[] = []
    let totalHeight = 0
    let currentMetrics: Metrics | null = null
    let needsTextRefresh = false
    let needsLayoutRefresh = true
    let raf = 0
    let lastGutterWidth = ''
    let lastScrollTop = Number.NaN
    let renderedStartLine = -1
    let renderedEndLine = -1
    let renderedRows: HTMLDivElement[] = []
    let pendingInputPatch: InputPatchHint | null = null
    let lineNumbersPrefEnabled = getSourceLineNumbersEnabled()
    let lineNumbersActive = false
    let zoomLayoutDebounce: any = 0

    flymd.flymdGetSourceEditorPositionInfo = (pos: number) => {
      try {
        const textLength = lastText.length >>> 0
        const safePos = Math.max(0, Math.min(pos >>> 0, textLength))
        const lineIndex = findLineByPos(lineStarts, safePos, textLength)
        const lineStart = lineStarts[lineIndex] ?? 0
        return {
          row: lineIndex + 1,
          col: Math.max(1, safePos - lineStart + 1),
          chars: textLength,
        }
      } catch {
        return null
      }
    }

    flymd.flymdGetSourceEditorLineText = (lineNumber: number) => {
      try {
        const idx = Math.max(1, Math.floor(Number(lineNumber) || 1)) - 1
        return lines[idx] ?? ''
      } catch {
        return ''
      }
    }

    flymd.flymdGetSourceEditorLinesSnapshot = () => {
      try {
        return {
          lines,
          lineStarts,
          chars: lastText.length >>> 0,
        }
      } catch {
        return null
      }
    }

    const clearRenderedRows = (resetHeight = false) => {
      if (renderedRows.length || lineNumbers.childElementCount) {
        lineNumbers.replaceChildren()
      }
      renderedRows = []
      renderedStartLine = -1
      renderedEndLine = -1
      if (resetHeight) lineNumbers.style.height = '0px'
      lineNumbers.style.counterReset = 'flymd-line 0'
    }

    const rebuildTextState = (text: string) => {
      lines = splitLines(text)
      lineStarts = buildLineStarts(lines)
      lastText = text
    }

    const resetLayoutState = (metrics: Metrics) => {
      rowHeights = new Array<number>(lines.length).fill(metrics.lineHeight)
      rowOffsets = new Array<number>(lines.length).fill(0)
      totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, 0)
      clearRenderedRows(false)
    }

    const rebuildAllState = (metrics: Metrics | null, text: string) => {
      rebuildTextState(text)
      if (metrics) resetLayoutState(metrics)
      else {
        rowHeights = []
        rowOffsets = []
        totalHeight = 0
        clearRenderedRows(true)
      }
      activeRow = 0
    }

    const syncGutterWidth = () => {
      if (!lineNumbersPrefEnabled) return false
      const digits = Math.max(2, String(Math.max(1, lines.length)).length)
      const widthPx = Math.max(48, 20 + digits * 10)
      const next = `${widthPx}px`
      if (next === lastGutterWidth) return false
      lastGutterWidth = next
      shell.style.setProperty('--editor-line-gutter-width', next)
      return true
    }

    // 大范围测量分块（perf 批次 H）：每块行一次性挂入 measure 容器再统一读取，
    // 一次强制布局测一整块；打字等小范围仍走单 probe 路径（更廉价）
    const REMEASURE_BATCH_MIN_RANGE = 16

    const remeasureRange = (startLine: number, count: number, metrics: Metrics) => {
      if (!rowHeights.length) return false
      const safeStart = Math.max(0, Math.min(startLine, lines.length))
      const safeEnd = Math.max(safeStart, Math.min(lines.length, safeStart + Math.max(0, count)))
      let changedFrom = -1
      const rangeSize = safeEnd - safeStart

      if (rangeSize > REMEASURE_BATCH_MIN_RANGE) {
        // —— 批量路径：打开超大文件/整体重测时，逐行 write+offsetHeight 是
        // O(N) 次强制布局（真机复现：35k 行文档启动冻结数分钟）。同字体同宽度下
        // 等文本行必等高：先按文本去重，再交由批量测量（每块只触发一次强制布局，
        // 测量值与单 probe 逐字等价）
        const pendingTexts: string[] = []
        const textIndex = new Map<string, number>()
        for (let i = safeStart; i < safeEnd; i++) {
          const lineText = lines[i] || ''
          if (!textIndex.has(lineText)) {
            textIndex.set(lineText, pendingTexts.length)
            pendingTexts.push(lineText)
          }
        }
        const heights = measureLineHeightsBatched(measure, pendingTexts, metrics.lineHeight)
        for (let i = safeStart; i < safeEnd; i++) {
          const measured = heights[textIndex.get(lines[i] || '') as number]
          if (rowHeights[i] !== measured) {
            rowHeights[i] = measured
            if (changedFrom < 0) changedFrom = i
          }
        }
        if (changedFrom >= 0) {
          totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, changedFrom)
          return true
        }
        return false
      }

      // —— 小范围路径：单 probe 逐行测量（含按文本去重）——
      const heightByText = new Map<string, number>()
      for (let i = safeStart; i < safeEnd; i++) {
        const lineText = lines[i] || ''
        let height = heightByText.get(lineText)
        if (height === undefined) {
          height = measureLineHeight(measureProbe, metrics, lineText)
          heightByText.set(lineText, height)
        }
        if (rowHeights[i] !== height) {
          rowHeights[i] = height
          if (changedFrom < 0) changedFrom = i
        }
      }
      if (changedFrom >= 0) {
        totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, changedFrom)
        return true
      }
      return false
    }

    const remeasureAll = (metrics: Metrics) => {
      if (!rowHeights.length || rowHeights.length !== lines.length) {
        resetLayoutState(metrics)
      }
      const changed = remeasureRange(0, lines.length, metrics)
      if (!changed) totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, 0)
    }

    const applyTextPatch = (text: string, metrics: Metrics | null, hint: InputPatchHint | null) => {
      if (text === lastText) return
      // perf 批次 H 分相观测：大文档补丁（含批测/offsets 重建）≥300ms 时记录
      try { logDebug('[行号栏] applyTextPatch 开始', { 行数: text.split('\n').length }) } catch {}
      const _tPatch = performance.now()
      const patch = (hint ? createLinePatchFromHint(lastText, text, hint) : null)
        || createLinePatch(lastText, text, lines, lineStarts)
      if (!patch) {
        lastText = text
        return
      }

      const startLine = patch.startLine
      const oldLineCount = patch.oldLineCount
      const newLineCount = patch.newLines.length

      lines.splice(startLine, oldLineCount, ...patch.newLines)
      if (lineStarts.length) {
        lineStarts.splice(startLine, oldLineCount, ...new Array<number>(newLineCount).fill(0))
      }
      rebuildLineStartsFrom(lines, lineStarts, startLine)
      lastText = text
      activeRow = 0
      // 行数变化时才全量清空行号 DOM；同行编辑（如打字）只需就地更新几何信息
      if (oldLineCount !== newLineCount) clearRenderedRows(false)

      if (!metrics || !rowHeights.length) return

      rowHeights.splice(startLine, oldLineCount, ...new Array<number>(newLineCount).fill(metrics.lineHeight))
      totalHeight = rebuildRowOffsetsFrom(rowHeights, rowOffsets, startLine)
      // composing 期间跳过 DOM 测量（measureLineHeight 会触发回流）；compositionend 后只测量变化行
      let _msBatch = 0
      if (!_composing || _needsRemeasureAfterComposing) {
        _needsRemeasureAfterComposing = false
        const _tBatch = performance.now()
        remeasureRange(startLine, newLineCount, metrics)
        _msBatch = Math.round(performance.now() - _tBatch)
      }
      const _msPatch = Math.round(performance.now() - _tPatch)
      if (_msPatch >= 300) {
        try {
          logInfo('[启动耗时] 行号栏文本同步', {
            行数: newLineCount,
            补丁ms: _msPatch,
            测量ms: _msBatch,
          })
        } catch {}
      }
    }

    const getVisibleRange = (metrics: Metrics): VisibleRange => {
      if (!lines.length || !rowOffsets.length) return { startLine: 0, endLine: 0 }
      const viewportHeight = Math.max(
        metrics.lineHeight * 6,
        editor.clientHeight - metrics.paddingTop - metrics.paddingBottom,
      )
      const buffer = Math.max(metrics.lineHeight * 24, viewportHeight * 0.75)
      const startOffset = Math.max(0, editor.scrollTop - buffer)
      const endOffset = editor.scrollTop + viewportHeight + buffer
      const startIndex = findLineByYOffset(rowOffsets, startOffset, totalHeight)
      const endIndex = findLineByYOffset(rowOffsets, endOffset, totalHeight)
      return {
        startLine: Math.max(0, startIndex - 1),
        endLine: Math.min(lines.length, endIndex + 2),
      }
    }

    const syncScroll = () => {
      const scrollTop = editor.scrollTop
      if (scrollTop === lastScrollTop) return false
      lastScrollTop = scrollTop
      lineNumbers.style.transform = `translateY(${-scrollTop}px)`
      return true
    }

    const renderVisibleRows = (force = false) => {
      if (!lineNumbersActive || !currentMetrics || !rowHeights.length || !rowOffsets.length || !lines.length) {
        clearRenderedRows(true)
        activeRow = 0
        return
      }

      const range = getVisibleRange(currentMetrics)
      if (range.endLine <= range.startLine) {
        clearRenderedRows(true)
        activeRow = 0
        return
      }

      lineNumbers.style.height = `${Math.max(0, totalHeight)}px`
      lineNumbers.style.counterReset = `flymd-line ${range.startLine}`

      if (force || range.startLine !== renderedStartLine || range.endLine !== renderedEndLine) {
        // 范围相同 + 已有渲染行：就地更新几何信息，避免 DOM 全量重建
        if (range.startLine === renderedStartLine && range.endLine === renderedEndLine && renderedRows.length > 0) {
          for (let i = 0; i < renderedRows.length; i++) {
            const li = renderedStartLine + i
            setRowGeometry(renderedRows[i], rowOffsets[li] ?? 0, rowHeights[li] ?? currentMetrics.lineHeight)
          }
        } else {
          const frag = document.createDocumentFragment()
          const nextRows: HTMLDivElement[] = []
          for (let i = range.startLine; i < range.endLine; i++) {
            const row = createRow()
            setRowGeometry(row, rowOffsets[i] ?? 0, rowHeights[i] ?? currentMetrics.lineHeight)
            nextRows.push(row)
            frag.appendChild(row)
          }
          renderedRows = nextRows
          renderedStartLine = range.startLine
          renderedEndLine = range.endLine
          lineNumbers.replaceChildren(frag)
        }
      }

      const nextRow = findLineByPos(lineStarts, editor.selectionStart >>> 0, lastText.length) + 1
      activeRow = setActiveRow(
        renderedRows,
        renderedStartLine,
        renderedEndLine,
        lines.length,
        nextRow,
        activeRow,
      )
    }

    const flush = () => {
      raf = 0
      if (!editor.isConnected) return

      const prefEnabled = getSourceLineNumbersEnabled()
      if (prefEnabled !== lineNumbersPrefEnabled) {
        lineNumbersPrefEnabled = prefEnabled
        needsLayoutRefresh = true
      }

      const mode = getEditorMode()
      const wysiwyg = isWysiwygMode()
      const stickyNote = document.body.classList.contains('sticky-note-mode')
      const nextLineNumbersActive = lineNumbersPrefEnabled && mode === 'edit' && !wysiwyg && !stickyNote
      const activeChanged = nextLineNumbersActive !== lineNumbersActive
      lineNumbersActive = nextLineNumbersActive
      shell.classList.toggle('line-numbers-disabled', !lineNumbersActive)

      // composing 期间跳过所有文本处理（全文 diff / rebuildLineStarts / rebuildRowOffsets 均 O(N)），
      // 只做 scroll 同步和 active row 高亮，compositionend 会触发 needsLayoutRefresh 做完整刷新
      if (_composing) {
        if (lineNumbersActive) {
          syncScroll()
          // 只更新 active row 高亮
          if (renderedRows.length && currentMetrics) {
            const nextRow = findLineByPos(lineStarts, editor.selectionStart >>> 0, lastText.length) + 1
            activeRow = setActiveRow(renderedRows, renderedStartLine, renderedEndLine, lines.length, nextRow, activeRow)
          }
        }
        needsTextRefresh = false
        needsLayoutRefresh = false
        return
      }

      const text = String(editor.value || '')
      const textChanged = needsTextRefresh || text !== lastText

      if (textChanged) {
        if (lineNumbersPrefEnabled) {
          if (!currentMetrics) currentMetrics = readMetrics(editor)
          applyTextPatch(text, currentMetrics, pendingInputPatch)
        } else {
          applyTextPatch(text, null, pendingInputPatch)
        }
      }
      pendingInputPatch = null

      if (lineNumbersPrefEnabled) {
        if (!currentMetrics) currentMetrics = readMetrics(editor)
        const gutterWidthChanged = syncGutterWidth()
        const layoutNeedsRefresh =
          needsLayoutRefresh
          || gutterWidthChanged
          || !lastMetricsKey
          || !rowHeights.length
          || rowHeights.length !== lines.length

        let forceRender = textChanged || activeChanged

        if (layoutNeedsRefresh && currentMetrics) {
          currentMetrics = readMetrics(editor)
          lastMetricsKey = applyMeasureStyle(shell, editor, gutter, measure, currentMetrics)
          remeasureAll(currentMetrics)
          forceRender = true
        }

        if (lineNumbersActive) {
          const scrolled = syncScroll()
          renderVisibleRows(forceRender || scrolled)
        } else {
          clearRenderedRows(true)
          activeRow = 0
          lastScrollTop = Number.NaN
        }
      } else {
        currentMetrics = null
        lastMetricsKey = ''
        lastGutterWidth = ''
        rowHeights = []
        rowOffsets = []
        totalHeight = 0
        clearRenderedRows(true)
        activeRow = 0
        lastScrollTop = Number.NaN
      }

      needsTextRefresh = false
      needsLayoutRefresh = false
    }

    const schedule = (kind: 'text' | 'layout' | 'selection' = 'selection') => {
      if (kind === 'text') needsTextRefresh = true
      if (kind === 'layout') needsLayoutRefresh = true
      if (raf) return
      raf = window.requestAnimationFrame(flush)
    }

    const scheduleExternalTextRefresh = () => {
      pendingInputPatch = null
      schedule('text')
    }

    const flushNowIfNeeded = () => {
      const liveText = String(editor.value || '')
      if (!raf && !needsLayoutRefresh && !needsTextRefresh && liveText === lastText) return
      if (raf) {
        try { window.cancelAnimationFrame(raf) } catch {}
        raf = 0
      }
      flush()
    }

    let _composing = false
    let _needsRemeasureAfterComposing = false
    editor.addEventListener('compositionstart', () => { _composing = true }, { passive: true } as any)
    editor.addEventListener('compositionend', () => {
      _composing = false
      // compositionend 后需要处理 composing 期间积累的文本变化
      // 标记需要 remeasure（在 applyTextPatch 中会对变化行做测量）
      _needsRemeasureAfterComposing = true
      needsTextRefresh = true
      pendingInputPatch = null
      schedule('text')
    }, { passive: true } as any)

    const captureInputPatchHint = () => {
      try {
        // composing 期间跳过同步 flush，避免 DOM 测量阻塞输入
        if (!_composing) flushNowIfNeeded()
        pendingInputPatch = createInputPatchHint(
          lines,
          lineStarts,
          lastText.length,
          editor.selectionStart >>> 0,
          editor.selectionEnd >>> 0,
        )
      } catch {
        pendingInputPatch = null
      }
    }

    hookEditorTextMutations(editor, () => {
      // composing 期间延迟到 compositionend 后再通知，避免 imePatch 的 ta.value = newVal 触发额外同步刷新
      if (_composing) return
      scheduleExternalTextRefresh()
    })

    editor.addEventListener('beforeinput', () => captureInputPatchHint(), { passive: true } as any)
    editor.addEventListener('input', () => schedule('text'))
    editor.addEventListener('scroll', () => schedule('selection'))
    editor.addEventListener('click', () => schedule('selection'))
    editor.addEventListener('keyup', () => schedule('selection'))
    editor.addEventListener('mouseup', () => schedule('selection'))
    editor.addEventListener('select', () => schedule('selection'))
    editor.addEventListener('focus', () => schedule('selection'))
    editor.addEventListener('cut', () => schedule('text'))
    editor.addEventListener('paste', () => schedule('text'))
    window.addEventListener('resize', () => schedule('layout'))
    window.addEventListener('flymd:mode:changed', () => schedule('layout'))
    window.addEventListener('flymd:theme:changed', () => schedule('layout'))
    window.addEventListener('flymd:localeChanged', () => schedule('layout'))
    window.addEventListener('flymd:uiZoom:changed', () => {
      try { if (zoomLayoutDebounce) clearTimeout(zoomLayoutDebounce) } catch {}
      zoomLayoutDebounce = setTimeout(() => {
        zoomLayoutDebounce = 0
        schedule('layout')
      }, ZOOM_LAYOUT_DEBOUNCE_MS)
    })
    window.addEventListener(SOURCE_LINE_NUMBERS_CHANGED_EVENT, () => schedule('layout'))
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === editor) schedule('selection')
    })

    try {
      const ro = new ResizeObserver(() => schedule('layout'))
      ro.observe(surface)
      ro.observe(editor)
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedOpenFile && typeof flymd.flymdOpenFile === 'function') {
        flymd.__lineNumbersPatchedOpenFile = true
        const original = flymd.flymdOpenFile
        flymd.flymdOpenFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    try {
      if (!flymd.__lineNumbersPatchedNewFile && typeof flymd.flymdNewFile === 'function') {
        flymd.__lineNumbersPatchedNewFile = true
        const original = flymd.flymdNewFile
        flymd.flymdNewFile = async (...args: any[]) => {
          const result = await original.apply(flymd, args)
          scheduleExternalTextRefresh()
          return result
        }
      }
    } catch {}

    rebuildAllState(lineNumbersPrefEnabled ? readMetrics(editor) : null, lastText)
    if (lineNumbersPrefEnabled) currentMetrics = readMetrics(editor)
    schedule('layout')
  } catch {}
}

// 安装时机：编辑器 DOM 还没挂上时不能直接放弃——放弃等于本会话永远没有行号列，
// 用户只能靠"重启应用"才看得到效果。这里改为有限次重试。
const INSTALL_RETRY_INTERVAL_MS = 800
const INSTALL_MAX_ATTEMPTS = 12

// 快速重试窗口用尽后转入 DOM 观察兜底：不允许"静默永久放弃"，
// 否则慢机器 / 冷启动 / 大文件场景下会重现同一类"必须重启"故障。
function watchForEditor(): void {
  try {
    if (typeof MutationObserver === 'undefined') return
    const root = document.body
    if (!root) return
    const observer = new MutationObserver((records) => {
      // 只在"确实新增了 #editor"时才动作：不为每次 DOM 变更都付一次全局查询的代价
      for (const rec of records) {
        for (const node of Array.from(rec.addedNodes)) {
          const el = node as HTMLElement | null
          if (!el) continue
          if (el.id === 'editor' || (typeof el.querySelector === 'function' && el.querySelector('#editor'))) {
            observer.disconnect()
            installLineNumbers()
            return
          }
        }
      }
    })
    observer.observe(root, { childList: true, subtree: true })
  } catch (e) {
    console.warn('[sourceLineNumbers] 编辑器 DOM 观察兜底启动失败', e)
  }
}

function scheduleInstall(attempt = 0): void {
  setTimeout(() => {
    if (!document.getElementById('editor')) {
      if (attempt + 1 < INSTALL_MAX_ATTEMPTS) {
        scheduleInstall(attempt + 1)
        return
      }
      console.warn('[sourceLineNumbers] 编辑器 DOM 仍未就绪，转入观察兜底')
      watchForEditor()
      return
    }
    installLineNumbers()
  }, INSTALL_RETRY_INTERVAL_MS)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    scheduleInstall()
  })
} else {
  scheduleInstall()
}

export {}
