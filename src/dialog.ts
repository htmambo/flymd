/**
 * 自定义三按钮确认对话框及相关 WebDAV 同步对话框
 * 所有用户可见文案统一接入 i18n
 */

import { t } from './i18n'
import { buildHunks, copyHunkToRight, copyHunkToLeft, nextHunkId, countHunks, rightRangeOf } from './core/diffMerge'
import { logDebug } from './core/logger'

// ============================================================
// 文件外部更改监听 — 冲突确认模态(由 main.ts 装配 extWatcher 时调用)
// ============================================================

/** 文件监听冲突模态的返回值 */
export type FileWatchConflictChoice = 'reload' | 'keep' | 'cancel' | 'diff'

/** diff 视图模态返回值 */
export type FileWatchDiffResult = { choice: 'applyMerged' | 'cancel'; mergedContent?: string }

/** 转义 HTML 特殊字符(避免文件名注入)。在多处对话框中复用。 */
export function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return c
    }
  })
}

/** 取纯文件名(用于模态文案) */
function fileWatchBasename(p: string): string {
  const s = String(p || '').replace(/[\\/]+/g, '/')
  const idx = s.lastIndexOf('/')
  return idx >= 0 ? s.slice(idx + 1) : s
}

/**
 * 模态:文件外部变更冲突(脏标签场景)
 *
 * 按钮顺序:取消(neutral,默认焦点) / 保留本地(primary) / 重新加载(danger) / 文本对比(accent)
 * - ESC 视为取消
 * - 遮罩点击视为取消
 * - 焦点默认落在"取消",防误操作
 */
export function showFileWatchConflictDialog(filePath: string): Promise<FileWatchConflictChoice> {
  return new Promise((resolve) => {
    injectStyles()

    const name = fileWatchBasename(filePath)
    const title = t('filewatch.conflict.title') || '文件已在外部修改'
    const body = (t('filewatch.conflict.body') || '{name} 已被其它程序修改,且当前文档存在未保存改动。请选择处理方式:')
      .replace('{name}', name)
    const buttons = {
      reload: t('filewatch.conflict.btn.reload') || '重新加载(放弃本地)',
      keep: t('filewatch.conflict.btn.keep') || '保留本地(下次保存覆盖)',
      cancel: t('filewatch.conflict.btn.cancel') || '取消',
      diff: t('filewatch.conflict.btn.diff') || '文本对比',
    }

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'
    const box = document.createElement('div')
    box.className = 'custom-dialog-box'
    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.innerHTML = `<span class="custom-dialog-icon">⚠</span>${escapeHtml(title)}`
    const msgEl = document.createElement('div')
    msgEl.className = 'custom-dialog-message'
    msgEl.textContent = body
    const btnRow = document.createElement('div')
    btnRow.className = 'custom-dialog-buttons'

    let closed = false
    function close(result: FileWatchConflictChoice): void {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', handleKeyDown)
      try { overlay.remove() } catch { /* 已被父级清理 */ }
      resolve(result)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close('cancel')
      }
    }
    function makeBtn(className: string, label: string, result: FileWatchConflictChoice): HTMLButtonElement {
      const btn = document.createElement('button')
      btn.className = className
      btn.textContent = label
      btn.addEventListener('click', () => close(result))
      return btn
    }

    const cancelBtn = makeBtn('custom-dialog-button', buttons.cancel, 'cancel')
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(makeBtn('custom-dialog-button primary', buttons.keep, 'keep'))
    btnRow.appendChild(makeBtn('custom-dialog-button danger', buttons.reload, 'reload'))
    btnRow.appendChild(makeBtn('custom-dialog-button accent', buttons.diff, 'diff'))

    box.appendChild(titleEl)
    box.appendChild(msgEl)
    box.appendChild(btnRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel') })
    document.addEventListener('keydown', handleKeyDown)
    setTimeout(() => cancelBtn.focus(), 50)
  })
}


// ============================================================
// 文件外部更改监听 — 文本对比 / 合并模态
// ============================================================

/**
 * 模态:文件外部变更"文本对比"
 *
 * 用法:用户在冲突模态点击"文本对比"后,由 main.ts 装配 askDiffView 调用本函数。
 *
 * 设计:
 * - 三列布局:左侧 = 外部(只读 pre,行级高亮),中间 = 操作栏(每个 hunk 的 ←/→ 按钮),右侧 = 本地(可编辑 textarea)
 * - 行级 diff 由 core/diffMerge.ts 计算;大文件自动降级为单 hunk 整体替换并显示提示
 * - 快捷键:n 下一处 / p 上一处 / Ctrl+Enter 应用 / Esc 取消
 * - 默认焦点落在"右侧编辑区",鼓励用户直接修改合并内容
 * - 关闭(取消 / Esc / 遮罩):resolve({ choice: 'cancel' })
 * - 应用:resolve({ choice: 'applyMerged', mergedContent: textarea.value })
 */
export function showFileWatchDiffDialog(
  filePath: string,
  external: string,
  local: string,
): Promise<FileWatchDiffResult> {
  return new Promise((resolve) => {
    // 防御性 try/catch:任何 throw 都会被捕获并打印到 console,避免弹窗静默失败
    try {
    injectStyles()
    injectFileWatchDiffStyles()

    const name = fileWatchBasename(filePath)
    const title = t('filewatch.diff.title', { name })
    const hintText = t('filewatch.diff.hint') || '右侧可直接编辑。点击 ←/→ 单段复制,n/p 跳到下一处/上一处,Ctrl+Enter 应用。'
    const colExternalLabel = t('filewatch.diff.col.external') || '外部(磁盘)'
    const colLocalLabel = t('filewatch.diff.col.local') || '本地(可编辑)'
    const btnLabels = {
      prev: t('filewatch.diff.btn.prev') || '上一处',
      next: t('filewatch.diff.btn.next') || '下一处',
      apply: t('filewatch.diff.btn.apply') || '应用结果',
      cancel: t('filewatch.diff.btn.cancel') || '取消',
      copyToRight: t('filewatch.diff.btn.copyToRight') || '从外部复制到本地',
      copyToLeft: t('filewatch.diff.btn.copyToLeft') || '从本地复制到外部',
      locate: t('filewatch.diff.btn.locate') || '定位到该差异',
      ignoreWhitespace: t('filewatch.diff.ignoreWhitespace') || '忽略空白字符(空格 / 制表符)',
    }
    const emptyText = t('filewatch.diff.empty') || '没有差异'
    const largeFileText = t('filewatch.diff.largeFile') || '文件较大,行级 diff 暂不可用,请在右侧直接编辑后点击"应用结果"'

    // 可变状态:左侧文本随"从右复制到左"操作变化(仅视觉用,不影响最终结果)
    let leftText = String(external ?? '')
    let rightText = String(local ?? '')
    // 用户可切换"忽略空白" → 重建 view(影响 buildHunks diff)
    let ignoreWhitespace = false
    let view = buildHunks(leftText, rightText, { ignoreWhitespace })
    let currentHunk = -1
    // 大文件降级检测:由 buildHunks 标记,意味着 copyHunkToXxx 不能用(会重复拼接)
    const isLargeFileFallback = view.isLargeFileFallback === true

    // ---- DOM 构造 ----
    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay filewatch-diff-overlay'
    const box = document.createElement('div')
    box.className = 'filewatch-diff-box'

    // header
    const header = document.createElement('div')
    header.className = 'filewatch-diff-header'
    const titleEl = document.createElement('div')
    titleEl.className = 'filewatch-diff-title'
    titleEl.textContent = title
    const hintEl = document.createElement('div')
    hintEl.className = 'filewatch-diff-hint'
    hintEl.textContent = isLargeFileFallback ? largeFileText : hintText
    header.appendChild(titleEl)
    header.appendChild(hintEl)
    // 改进 4:选项行(忽略空白复选框)。仅在非大文件降级时显示
    if (!isLargeFileFallback) {
      const optionsRow = document.createElement('div')
      optionsRow.className = 'filewatch-diff-options'
      const ignoreWsLabel = document.createElement('label')
      ignoreWsLabel.className = 'filewatch-diff-option-label'
      const ignoreWsCheckbox = document.createElement('input')
      ignoreWsCheckbox.type = 'checkbox'
      ignoreWsCheckbox.checked = ignoreWhitespace
      ignoreWsCheckbox.addEventListener('change', () => {
        ignoreWhitespace = ignoreWsCheckbox.checked
        rebuildAfterEdit({ preserveCurrent: false, ignoreWhitespace })
        // 切完 ignoreWhitespace 默认跳到第一处,免得停在某行
        if (view.hunks.length > 0) locateHunk(0)
      })
      const ignoreWsSpan = document.createElement('span')
      ignoreWsSpan.textContent = btnLabels.ignoreWhitespace
      ignoreWsLabel.appendChild(ignoreWsCheckbox)
      ignoreWsLabel.appendChild(ignoreWsSpan)
      optionsRow.appendChild(ignoreWsLabel)
      header.appendChild(optionsRow)
    }

    // body 三列
    const body = document.createElement('div')
    body.className = 'filewatch-diff-body'

    // 左列
    const leftCol = document.createElement('div')
    leftCol.className = 'filewatch-diff-col'
    const leftColHeader = document.createElement('div')
    leftColHeader.className = 'filewatch-diff-col-header'
    leftColHeader.textContent = colExternalLabel
    const leftPane = document.createElement('div')
    leftPane.className = 'filewatch-diff-pane filewatch-diff-pane-left'
    leftCol.appendChild(leftColHeader)
    leftCol.appendChild(leftPane)

    // 中列 gutter
    const gutter = document.createElement('div')
    gutter.className = 'filewatch-diff-col filewatch-diff-gutter-col'
    const gutterHeader = document.createElement('div')
    gutterHeader.className = 'filewatch-diff-col-header'
    gutterHeader.textContent = ''
    const gutterPane = document.createElement('div')
    gutterPane.className = 'filewatch-diff-pane filewatch-diff-gutter'
    gutter.appendChild(gutterHeader)
    gutter.appendChild(gutterPane)

    // 右列(textarea)
    const rightCol = document.createElement('div')
    rightCol.className = 'filewatch-diff-col'
    const rightColHeader = document.createElement('div')
    rightColHeader.className = 'filewatch-diff-col-header'
    rightColHeader.textContent = colLocalLabel
    const rightPane = document.createElement('div')
    rightPane.className = 'filewatch-diff-pane filewatch-diff-pane-right'
    // 内层:高亮层(只读 pre,展示 right 当前 diff 行)+ textarea(可编辑覆盖,但目前以纯 textarea 表达)
    const rightTextarea = document.createElement('textarea')
    rightTextarea.value = rightText
    rightTextarea.spellcheck = false
    rightTextarea.wrap = 'off'
    rightPane.appendChild(rightTextarea)
    rightCol.appendChild(rightColHeader)
    rightCol.appendChild(rightPane)

    body.appendChild(leftCol)
    body.appendChild(gutter)
    body.appendChild(rightCol)

    // footer
    const footer = document.createElement('div')
    footer.className = 'filewatch-diff-footer'
    const prevBtn = document.createElement('button')
    prevBtn.className = 'custom-dialog-button'
    prevBtn.textContent = btnLabels.prev
    const nextBtn = document.createElement('button')
    nextBtn.className = 'custom-dialog-button'
    nextBtn.textContent = btnLabels.next
    const counter = document.createElement('div')
    counter.className = 'filewatch-diff-counter'
    const spacer = document.createElement('div')
    spacer.className = 'spacer'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'custom-dialog-button'
    cancelBtn.textContent = btnLabels.cancel
    const applyBtn = document.createElement('button')
    applyBtn.className = 'custom-dialog-button primary'
    applyBtn.textContent = btnLabels.apply
    footer.appendChild(prevBtn)
    footer.appendChild(nextBtn)
    footer.appendChild(counter)
    footer.appendChild(spacer)
    footer.appendChild(cancelBtn)
    footer.appendChild(applyBtn)

    box.appendChild(header)
    box.appendChild(body)
    box.appendChild(footer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    // ---- 渲染:每次重算后调一次 ----
    function renderLeftPane(): void {
      // 重建左 pre 内容:按行号顺序输出 leftText 全部行,但给 hunk 内的 del/change 行加高亮 class
      const lines = leftText.split('\n')
      const lineKindByLeftLineNum = new Map<number, 'del' | 'chg' | 'add'>()
      const hunkIdByLeftLineNum = new Map<number, number>()
      for (const h of view.hunks) {
        for (const r of h.rows) {
          if (r.kind === 'del') {
            lineKindByLeftLineNum.set(r.leftLine, 'del')
            hunkIdByLeftLineNum.set(r.leftLine, h.id)
          } else if (r.kind === 'change') {
            lineKindByLeftLineNum.set(r.leftLine, 'chg')
            hunkIdByLeftLineNum.set(r.leftLine, h.id)
          }
          // add 行在左侧不存在,跳过
        }
      }
      // 清空并渲染
      leftPane.innerHTML = ''
      const frag = document.createDocumentFragment()
      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1
        const text = lines[i]
        const kind = lineKindByLeftLineNum.get(lineNum)
        const hunkId = hunkIdByLeftLineNum.get(lineNum)
        const row = document.createElement('div')
        row.className = 'filewatch-diff-line' + (kind ? ` ${kind}` : '')
        if (hunkId != null && hunkId === currentHunk) row.classList.add('active')
        if (hunkId != null) row.dataset.hunkId = String(hunkId)
        const numEl = document.createElement('span')
        numEl.className = 'filewatch-diff-line-num'
        numEl.textContent = String(lineNum)
        const txtEl = document.createElement('span')
        txtEl.className = 'filewatch-diff-line-text'
        txtEl.textContent = text
        row.appendChild(numEl)
        row.appendChild(txtEl)
        frag.appendChild(row)
      }
      leftPane.appendChild(frag)
    }

    function renderGutter(): void {
      gutterPane.innerHTML = ''
      const frag = document.createDocumentFragment()
      if (view.hunks.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'filewatch-diff-hunk-spacer'
        empty.textContent = emptyText
        empty.style.padding = '8px'
        empty.style.opacity = '0.6'
        empty.style.fontSize = '12px'
        frag.appendChild(empty)
      } else {
        // 行高:用 12px/1.5 字体(与 .filewatch-diff-pane 一致);通过首行实测 + fallback
        const sampleRow = leftPane.querySelector('.filewatch-diff-line') as HTMLElement | null
        const lineHeight = sampleRow ? Math.max(1, sampleRow.getBoundingClientRect().height) : 18
        // 计算每个 hunk 在左 pane 中的累计行数(按 hunk.rows.length 累加,各 hunk 之间是 equal 行)
        // 这里简化为:对每个 hunk 来说,它的行数 = hunk.rows.length
        // 顶部偏移 = 之前所有 hunk 的行数之和 × lineHeight + 顶部 padding(4px) + 行内 padding
        const topPad = 4  // .filewatch-diff-pane padding: 4px 0
        // 定位算法(改进 2 修复):之前用 accumRows += h.rows.length 错位 — 忽略了 hunk 之间的 equal 行。
        // 正确:用 hunk 第一个 del/change 行的 leftLine 作为起始 leftLine,左栏实际占用行数 = del+change 行数(连续)。
        // 起始 top = (minLeftLine - 1) * lineHeight + topPad,height = leftRowCount * lineHeight。
        for (const h of view.hunks) {
          const leftRows = h.rows.filter((r) => r.kind === 'del' || r.kind === 'change')
          if (leftRows.length === 0) continue  // 纯 add hunk 在左栏不可见,跳过 gutter
          const minLeftLine = leftRows[0].leftLine
          const leftRowCount = leftRows.length
          const block = document.createElement('div')
          block.className = 'filewatch-diff-hunk-block' + (h.id === currentHunk ? ' active' : '')
          block.dataset.hunkId = String(h.id)
          // 绝对定位:精确对齐 hunk 在左栏中的实际差异行
          block.style.top = `${topPad + (minLeftLine - 1) * lineHeight}px`
          block.style.height = `${leftRowCount * lineHeight}px`
          // 定位按钮(改进 3):跳到该 hunk(滚动左 pane + 设右 textarea caret)
          const locateBtn = document.createElement('button')
          locateBtn.type = 'button'
          locateBtn.className = 'filewatch-diff-hunk-btn filewatch-diff-hunk-btn-locate'
          locateBtn.textContent = '⊙'
          locateBtn.title = btnLabels.locate
          locateBtn.addEventListener('click', () => {
            locateHunk(h.id)
          })
          // → 按钮(从左复制到右)
          const rightBtn = document.createElement('button')
          rightBtn.type = 'button'
          rightBtn.className = 'filewatch-diff-hunk-btn'
          rightBtn.textContent = '→'
          rightBtn.title = btnLabels.copyToRight
          rightBtn.addEventListener('click', () => {
            applyHunkLeftToRight(h.id)
          })
          // ← 按钮(从右复制到左)
          const leftBtn = document.createElement('button')
          leftBtn.type = 'button'
          leftBtn.className = 'filewatch-diff-hunk-btn'
          leftBtn.textContent = '←'
          leftBtn.title = btnLabels.copyToLeft
          leftBtn.addEventListener('click', () => {
            applyHunkRightToLeft(h.id)
          })
          // 大文件降级模式禁用所有按钮(避免内容重复拼接;copyHunkToXxx 在 fallback 下不安全)
          // 定位按钮在降级模式下也禁用(无法定位到具体差异)
          if (isLargeFileFallback) {
            const fallbackTip = '大文件模式不支持分 hunk 操作'
            locateBtn.disabled = true
            locateBtn.title = fallbackTip
            rightBtn.disabled = true
            rightBtn.title = fallbackTip
            leftBtn.disabled = true
            leftBtn.title = fallbackTip
          }
          block.appendChild(locateBtn)
          block.appendChild(leftBtn)
          block.appendChild(rightBtn)
          frag.appendChild(block)
        }
      }
      gutterPane.appendChild(frag)
    }

    function renderCounter(): void {
      const total = countHunks(view.hunks)
      if (total === 0) {
        counter.textContent = emptyText
        return
      }
      const idx = currentHunk < 0 ? 0 : currentHunk + 1
      counter.textContent = `${idx}/${total}`
    }

    function rebuildAfterEdit(opts?: { preserveCurrent?: boolean; ignoreWhitespace?: boolean }): void {
      // 在右侧 textarea 被编辑 / 复制 / 切 ignoreWhitespace 后,重算 diff
      const ig = opts?.ignoreWhitespace ?? ignoreWhitespace
      rightText = rightTextarea.value
      view = buildHunks(leftText, rightText, { ignoreWhitespace: ig })
      if (!opts?.preserveCurrent || currentHunk >= view.hunks.length) {
        currentHunk = view.hunks.length > 0 ? Math.min(Math.max(currentHunk, 0), view.hunks.length - 1) : -1
      }
      renderLeftPane()
      renderGutter()
      renderCounter()
    }

    // ---- 操作:hunk 复制 ----
    function applyHunkLeftToRight(hunkId: number): void {
      const h = view.hunks.find((x) => x.id === hunkId)
      if (!h) return
      const newRight = copyHunkToRight(h, rightText)
      // 关键:ta.value = newRight 会把 selection/cursor/scroll 跳到末尾 → save/restore
      // 1) 先按"被改的 hunk 在右侧的 rightLine 起点"估算目标光标位置
      const rr = rightRangeOf(h)
      const beforeStart = rightTextarea.selectionStart
      const beforeEnd = rightTextarea.selectionEnd
      const beforeScroll = rightTextarea.scrollTop
      // 累计 hunk 第一个右侧行(rr.start)之前的所有 rightLines 行长度 + 换行
      const rightLinesOld = rightText.split('\n')
      let caretOffset = 0
      if (rr) {
        for (let i = 0; i < rr.start - 1 && i < rightLinesOld.length; i++) {
          caretOffset += rightLinesOld[i].length + 1  // +1 for '\n'
        }
      }
      rightTextarea.value = newRight
      // 恢复 selection:clamp 到新文本范围
      const newLen = newRight.length
      const newStart = Math.min(caretOffset || beforeStart, newLen)
      const newEnd = Math.min(caretOffset || beforeEnd, newLen)
      try { rightTextarea.selectionStart = newStart; rightTextarea.selectionEnd = newEnd } catch {}
      try { rightTextarea.scrollTop = beforeScroll } catch {}
      currentHunk = hunkId
      rebuildAfterEdit({ preserveCurrent: true })
      // 重新定位到下一处(若有)
      jumpTo(1)
    }
    /**
     * 定位(改进 3):跳到指定 hunk — 同步滚动到该 hunk 的左栏行 + 设右 textarea caret 到对应行。
     * 同步滚动会自动联动 gutter / 右 textarea(同一 scroll 比例)。
     */
    function locateHunk(hunkId: number): void {
      const h = view.hunks.find((x) => x.id === hunkId)
      if (!h) return
      currentHunk = hunkId
      // 1) 左 pane 滚到该 hunk 对应行(用 data-hunk-id 找,加 active 样式)
      const targetRow = leftPane.querySelector(
        `.filewatch-diff-line[data-hunk-id="${hunkId}"]`,
      ) as HTMLElement | null
      if (targetRow) {
        try { targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
      }
      // 2) 右 textarea caret 设到该 hunk 在右侧的对应行(由 rightRangeOf 推 line offset)
      const rr = rightRangeOf(h)
      if (rr) {
        const rightLines = rightText.split('\n')
        let caretOffset = 0
        for (let i = 0; i < rr.start - 1 && i < rightLines.length; i++) {
          caretOffset += rightLines[i].length + 1  // +1 for '\n'
        }
        try {
          rightTextarea.focus({ preventScroll: true })
          rightTextarea.setSelectionRange(caretOffset, caretOffset)
        } catch {}
      }
      // 3) 重新渲染高亮(加 active class)
      renderLeftPane()
      renderGutter()
      renderCounter()
    }
    function applyHunkRightToLeft(hunkId: number): void {
      const h = view.hunks.find((x) => x.id === hunkId)
      if (!h) return
      leftText = copyHunkToLeft(h, leftText)
      // 左侧文本变了 → 重算 view(用最新 leftText + 当前 rightText,沿用 ignoreWhitespace 偏好)
      view = buildHunks(leftText, rightText, { ignoreWhitespace })
      if (currentHunk >= view.hunks.length) currentHunk = view.hunks.length - 1
      renderLeftPane()
      renderGutter()
      renderCounter()
      jumpTo(1)
    }

    // ---- 跳转 ----
    function jumpTo(dir: 1 | -1): void {
      const total = countHunks(view.hunks)
      if (total === 0) return
      currentHunk = nextHunkId(view.hunks, currentHunk, dir, total)
      renderLeftPane()
      renderGutter()
      renderCounter()
      // scrollIntoView:左 pane 找 active 行,右 textarea 不滚(textarea 滚到行太复杂)
      try {
        const activeEl = leftPane.querySelector('.filewatch-diff-line.active') as HTMLElement | null
        if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {}
      try {
        const activeGutter = gutterPane.querySelector('.filewatch-diff-hunk-block.active') as HTMLElement | null
        if (activeGutter) activeGutter.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } catch {}
    }

    // ---- 关闭 ----
    let closed = false
    function close(result: FileWatchDiffResult): void {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', handleKeyDown)
      try { rightTextarea.removeEventListener('input', onTextareaInput) } catch {}
      try { overlay.remove() } catch { /* 已被父级清理 */ }
      logDebug('[showFileWatchDiffDialog] closed', { choice: result.choice })
      resolve(result)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close({ choice: 'cancel' })
        return
      }
      // textarea 内的按键:Ctrl+Enter 仍生效,但 n/p 不拦截
      const inTextarea = e.target === rightTextarea
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        close({ choice: 'applyMerged', mergedContent: rightTextarea.value })
        return
      }
      if (inTextarea) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        jumpTo(1)
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        jumpTo(-1)
      }
    }
    function onTextareaInput(): void {
      rebuildAfterEdit({ preserveCurrent: true })
    }
    cancelBtn.addEventListener('click', () => close({ choice: 'cancel' }))
    applyBtn.addEventListener('click', () => close({ choice: 'applyMerged', mergedContent: rightTextarea.value }))
    prevBtn.addEventListener('click', () => jumpTo(-1))
    nextBtn.addEventListener('click', () => jumpTo(1))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close({ choice: 'cancel' }) })
    document.addEventListener('keydown', handleKeyDown)
    rightTextarea.addEventListener('input', onTextareaInput)

    // ---- 同步滚动(左 pane / gutter pane / 右 textarea 三者按比例联动) ----
    let isSyncingScroll = false
    const syncTargets: [HTMLElement, HTMLElement, HTMLElement] = [leftPane, gutterPane, rightTextarea]
    function syncScrollFrom(src: HTMLElement): void {
      if (isSyncingScroll) return
      const maxSrc = src.scrollHeight - src.clientHeight
      if (maxSrc <= 0) return
      const ratio = Math.min(1, Math.max(0, src.scrollTop / maxSrc))
      isSyncingScroll = true
      try {
        for (const t of syncTargets) {
          if (t === src) continue
          const maxT = t.scrollHeight - t.clientHeight
          if (maxT > 0) t.scrollTop = Math.round(ratio * maxT)
        }
      } finally {
        // 用 setTimeout(0) 跳出当前 scroll 事件循环后再放锁,避免三向回环
        setTimeout(() => { isSyncingScroll = false }, 0)
      }
    }
    leftPane.addEventListener('scroll', () => syncScrollFrom(leftPane), { passive: true })
    gutterPane.addEventListener('scroll', () => syncScrollFrom(gutterPane), { passive: true })
    rightTextarea.addEventListener('scroll', () => syncScrollFrom(rightTextarea), { passive: true })

    // 首次渲染 + 默认焦点
    renderLeftPane()
    renderGutter()
    renderCounter()
    // 改进 1:不跳文件头也不跳文件尾,默认定位到第一处 hunk
    if (view.hunks.length > 0) {
      locateHunk(0)
    }
    // 默认焦点在右侧 textarea(鼓励用户直接编辑),失败时回退到 cancelBtn 防误触
    setTimeout(() => {
      try { rightTextarea.focus({ preventScroll: true }) } catch { try { cancelBtn.focus() } catch {} }
    }, 50)
    } catch (err) {
      // 任何 throw 都被兜底:打印到 console,确保弹窗至少能 resolve 而不卡住
      try { console.error('[showFileWatchDiffDialog] FATAL', err) } catch {}
      try { (window as any).flymdLastDiffError = String(err) } catch {}
      try { resolve({ choice: 'cancel' }) } catch {}
    }
  })
}

/** filewatch.diff.* 模态的局部样式;injectStyles 之外另注入一次 */
function injectFileWatchDiffStyles(): void {
  const styleId = 'filewatch-diff-dialog-styles'
  if (document.getElementById(styleId)) return
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = filewatchDiffStyles
  document.head.appendChild(style)
}

const filewatchDiffStyles = `
.filewatch-diff-overlay {
  /* 共享 custom-dialog-overlay 的定位/背景 */
}
.filewatch-diff-box {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: min(1100px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  font: 13px/1.5 -apple-system, "Segoe UI", sans-serif;
  animation: dialogSlideIn 0.2s ease;
}
.filewatch-diff-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.filewatch-diff-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}
.filewatch-diff-hint {
  font-size: 12px;
  opacity: 0.7;
  color: var(--fg);
}
.filewatch-diff-options {
  display: flex;
  gap: 16px;
  padding: 6px 0 0 0;
  font-size: 12px;
}
.filewatch-diff-option-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  color: var(--fg);
}
.filewatch-diff-option-label input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}
.filewatch-diff-body {
  flex: 1;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 120px 1fr;
  gap: 1px;
  background: var(--border);
  min-height: 320px;
}
.filewatch-diff-col {
  background: var(--bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.filewatch-diff-col-header {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(127, 127, 127, 0.06);
  border-bottom: 1px solid var(--border);
  color: var(--fg);
}
.filewatch-diff-pane {
  flex: 1;
  overflow: auto;
  font: 12px/1.5 ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  padding: 4px 0;
  background: var(--bg);
  color: var(--fg);
}
.filewatch-diff-pane-right {
  padding: 0;
  display: flex;
  flex-direction: column;
}
.filewatch-diff-line {
  display: grid;
  grid-template-columns: 48px 1fr;
  padding: 0 6px;
}
.filewatch-diff-line-num {
  color: var(--fg);
  opacity: 0.4;
  text-align: right;
  padding-right: 8px;
  user-select: none;
}
.filewatch-diff-line-text {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--fg);
}
.filewatch-diff-line.del {
  background: rgba(220, 38, 38, 0.10);
}
.filewatch-diff-line.add {
  background: rgba(34, 197, 94, 0.10);
}
.filewatch-diff-line.chg {
  background: rgba(234, 179, 8, 0.14);
}
.filewatch-diff-line.active {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}
.filewatch-diff-pane-right textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font: 12px/1.5 ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
  padding: 4px 8px;
  background: transparent;
  color: var(--fg);
  white-space: pre;
  overflow: auto;
}
.filewatch-diff-gutter {
  /* 作为 hunk 按钮的 absolute 定位容器;高度与左 pane 内容同步 */
  position: relative;
  padding: 4px 2px;
  background: rgba(127, 127, 127, 0.04);
  min-height: 100%;
}
.filewatch-diff-hunk-block {
  /* absolute 定位:top/height 由 JS 按 hunk 行数算,精确对齐左 pane 对应行 */
  position: absolute;
  left: 4px;
  right: 4px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  box-sizing: border-box;
  overflow: hidden;
}
.filewatch-diff-hunk-block.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
}
.filewatch-diff-hunk-label {
  font-size: 11px;
  opacity: 0.7;
  text-align: center;
}
.filewatch-diff-hunk-btn {
  -webkit-app-region: no-drag;
  cursor: pointer;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--border);
  background: rgba(127, 127, 127, 0.08);
  color: var(--fg);
  border-radius: 4px;
  transition: all 0.12s ease;
}
.filewatch-diff-hunk-btn:hover {
  background: #2563eb;
  color: white;
  border-color: #2563eb;
}
.filewatch-diff-hunk-btn-locate {
  /* 定位按钮:用对比色与复制按钮区分 */
  font-weight: 700;
  min-width: 28px;
  padding: 2px 6px;
}
.filewatch-diff-hunk-btn-locate:hover {
  background: #059669;
  color: white;
  border-color: #059669;
}
.filewatch-diff-hunk-spacer {
  flex: 1;
}
.filewatch-diff-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.filewatch-diff-footer .spacer {
  flex: 1;
}
.filewatch-diff-counter {
  font-size: 12px;
  opacity: 0.7;
  color: var(--fg);
  margin-left: 8px;
}
.filewatch-diff-footer .custom-dialog-button {
  min-width: 80px;
  padding: 6px 12px;
  font-size: 13px;
}
`


// 对话框返回值类型
export type DialogResult = 'save' | 'discard' | 'cancel'

// WebDAV 同步冲突对话框返回值
export type ConflictResult = 'local' | 'remote' | 'cancel'
export type TwoChoiceResult = 'confirm' | 'cancel'
export type BoolResult = boolean

export type ApplyToAllResult<T> = { result: T; applyToAll: boolean }
type DialogApplyAllOptions = { withApplyToAll?: boolean }

// 对话框样式
const dialogStyles = `
.custom-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(4px);
  animation: dialogFadeIn 0.15s ease;
}

@keyframes dialogFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.custom-dialog-box {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
  animation: dialogSlideIn 0.2s ease;
}

@keyframes dialogSlideIn {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.custom-dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--fg);
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-dialog-icon {
  font-size: 24px;
}

.custom-dialog-message {
  font-size: 14px;
  color: var(--fg);
  opacity: 0.85;
  line-height: 1.6;
  margin: 0 0 24px 0;
  white-space: pre-line;
}

.custom-dialog-extra {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -12px 0 18px 0;
  color: var(--fg);
  opacity: 0.85;
  font-size: 13px;
  user-select: none;
  -webkit-app-region: no-drag;
}

.custom-dialog-extra input[type="checkbox"] {
  width: 16px;
  height: 16px;
}

.custom-dialog-buttons {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.custom-dialog-button {
  -webkit-app-region: no-drag;
  cursor: pointer;
  border: 1px solid var(--border);
  background: rgba(127, 127, 127, 127/255 * 0.08);
  background: rgba(127, 127, 127, 0.08);
  color: var(--fg);
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
  min-width: 100px;
}

.custom-dialog-button:hover {
  background: rgba(127, 127, 127, 0.15);
  border-color: rgba(127, 127, 127, 0.35);
}

.custom-dialog-button:active {
  transform: scale(0.97);
}

.custom-dialog-button.primary {
  background: #2563eb;
  color: white;
  border-color: #2563eb;
}

.custom-dialog-button.primary:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.custom-dialog-button.danger {
  background: #dc2626;
  color: white;
  border-color: #dc2626;
}

.custom-dialog-button.danger:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}

.custom-dialog-button.accent {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.custom-dialog-button.accent:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.custom-dialog-button:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
`

// 注入样式到页面
function injectStyles() {
  const styleId = 'custom-dialog-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = dialogStyles
    document.head.appendChild(style)
  }
}

function createApplyToAllRow(onChange: (checked: boolean) => void): HTMLElement {
  const label = document.createElement('label')
  label.className = 'custom-dialog-extra'

  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.onchange = () => onChange(cb.checked)

  const text = document.createElement('span')
  text.textContent = t('dlg.sync.applyAll')

  label.appendChild(cb)
  label.appendChild(text)
  return label
}

/**
 * 显示三按钮确认对话框
 * @param message 对话框消息
 * @param title 对话框标题（可选，不传则使用多语言默认标题）
 * @returns Promise<DialogResult> - 'save': 保存并退出, 'discard': 直接退出, 'cancel': 取消
 */
export function showThreeButtonDialog(
  message: string,
  title?: string
): Promise<DialogResult> {
  return new Promise((resolve) => {
    injectStyles()

    // 创建对话框 DOM
    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    const finalTitle = (title && title.trim()) || t('dlg.exit.title')
    titleEl.innerHTML = `<span class="custom-dialog-icon">ℹ️</span>${finalTitle}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    messageEl.textContent = message

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    // 创建三个按钮
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'custom-dialog-button'
    cancelBtn.textContent = t('dlg.cancel')

    const discardBtn = document.createElement('button')
    discardBtn.className = 'custom-dialog-button danger'
    discardBtn.textContent = t('dlg.exit.discard')

    const saveBtn = document.createElement('button')
    saveBtn.className = 'custom-dialog-button primary'
    saveBtn.textContent = t('dlg.exit.save')

    function closeDialog(result: DialogResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        resolve(result)
      }, 100)
    }

    cancelBtn.onclick = () => {
      closeDialog('cancel')
    }

    discardBtn.onclick = () => {
      closeDialog('discard')
    }

    saveBtn.onclick = () => {
      closeDialog('save')
    }

    buttonsContainer.appendChild(cancelBtn)
    buttonsContainer.appendChild(discardBtn)
    buttonsContainer.appendChild(saveBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)

    // 添加到页面
    document.body.appendChild(overlay)

    // 聚焦到保存按钮（默认操作）
    setTimeout(() => saveBtn.focus(), 50)

    // 点击遮罩层关闭（视为取消）
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        closeDialog('cancel')
      }
    }

    // ESC 键取消
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog('cancel')
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

/**
 * 库侧栏删除确认对话框（文件/文件夹共用）
 * @param filename 文件或文件夹名
 * @param isDir 是否为文件夹
 * @returns Promise<boolean> - true: 确认删除, false: 取消
 */
export function showLibraryDeleteDialog(
  filename: string,
  isDir: boolean,
): Promise<BoolResult> {
  return new Promise((resolve) => {
    injectStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    const titleKey = isDir ? 'dlg.libDelete.title.dir' : 'dlg.libDelete.title.file'
    titleEl.innerHTML = `<span class="custom-dialog-icon">🗑️</span>${t(titleKey as any)}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    const nameKey = isDir ? 'dlg.libDelete.name.dir' : 'dlg.libDelete.name.file'
    const safeName = filename || t(nameKey as any)
    const msgKey = isDir ? 'dlg.libDelete.msg.dir' : 'dlg.libDelete.msg.file'
    messageEl.textContent = t(msgKey as any, { name: safeName })

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'custom-dialog-button'
    cancelBtn.textContent = t('dlg.cancel')

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'custom-dialog-button danger'
    deleteBtn.textContent = t('dlg.delete')

    function close(result: BoolResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        resolve(result)
      }, 100)
    }

    cancelBtn.onclick = () => close(false)
    deleteBtn.onclick = () => close(true)

    buttonsContainer.appendChild(cancelBtn)
    buttonsContainer.appendChild(deleteBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    setTimeout(() => deleteBtn.focus(), 50)

    overlay.onclick = (e) => {
      if (e.target === overlay) close(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

/**
 * WebDAV 文件冲突对话框（本地和远程都已修改）
 * @param filename 文件名
 * @returns Promise<ConflictResult> - 'local': 保留本地, 'remote': 保留远程, 'cancel': 取消
 */
export function showConflictDialog(filename: string): Promise<ConflictResult>;
export function showConflictDialog(filename: string, opts: { withApplyToAll: true }): Promise<ApplyToAllResult<ConflictResult>>;
export function showConflictDialog(
  filename: string,
  opts?: DialogApplyAllOptions
): Promise<ConflictResult | ApplyToAllResult<ConflictResult>> {
  return new Promise((resolve) => {
    injectStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.innerHTML = `<span class="custom-dialog-icon">⚠️</span>${t('dlg.sync.conflict.title')}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    messageEl.textContent = t('dlg.sync.conflict.msg', { name: filename })

    let applyToAll = false
    const extraRow = opts?.withApplyToAll
      ? createApplyToAllRow((checked) => { applyToAll = checked })
      : null

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'custom-dialog-button'
    cancelBtn.textContent = t('dlg.cancel')

    const remoteBtn = document.createElement('button')
    remoteBtn.className = 'custom-dialog-button'
    remoteBtn.textContent = t('dlg.sync.conflict.remote')

    const localBtn = document.createElement('button')
    localBtn.className = 'custom-dialog-button primary'
    localBtn.textContent = t('dlg.sync.conflict.local')

    function closeDialog(result: ConflictResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        if (opts?.withApplyToAll) resolve({ result, applyToAll })
        else resolve(result)
      }, 100)
    }

    cancelBtn.onclick = () => closeDialog('cancel')
    remoteBtn.onclick = () => closeDialog('remote')
    localBtn.onclick = () => closeDialog('local')

    buttonsContainer.appendChild(cancelBtn)
    buttonsContainer.appendChild(remoteBtn)
    buttonsContainer.appendChild(localBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    if (extraRow) box.appendChild(extraRow)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    setTimeout(() => localBtn.focus(), 50)

    overlay.onclick = (e) => {
      if (e.target === overlay) closeDialog('cancel')
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog('cancel')
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

/**
 * WebDAV 本地文件删除确认对话框
 * @param filename 文件名
 * @returns Promise<TwoChoiceResult> - 'confirm': 同步删除远程, 'cancel': 从远程恢复
 */
export function showLocalDeleteDialog(filename: string): Promise<TwoChoiceResult>;
export function showLocalDeleteDialog(filename: string, opts: { withApplyToAll: true }): Promise<ApplyToAllResult<TwoChoiceResult>>;
export function showLocalDeleteDialog(
  filename: string,
  opts?: DialogApplyAllOptions
): Promise<TwoChoiceResult | ApplyToAllResult<TwoChoiceResult>> {
  return new Promise((resolve) => {
    injectStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.innerHTML = `<span class="custom-dialog-icon">🗑️</span>${t('dlg.sync.localDelete.title')}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    messageEl.textContent = t('dlg.sync.localDelete.msg', { name: filename })

    let applyToAll = false
    const extraRow = opts?.withApplyToAll
      ? createApplyToAllRow((checked) => { applyToAll = checked })
      : null

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    const restoreBtn = document.createElement('button')
    restoreBtn.className = 'custom-dialog-button'
    restoreBtn.textContent = t('dlg.sync.localDelete.restore')

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'custom-dialog-button danger'
    deleteBtn.textContent = t('dlg.sync.localDelete.deleteRemote')

    function closeDialog(result: TwoChoiceResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        if (opts?.withApplyToAll) resolve({ result, applyToAll })
        else resolve(result)
      }, 100)
    }

    restoreBtn.onclick = () => closeDialog('cancel')
    deleteBtn.onclick = () => closeDialog('confirm')

    buttonsContainer.appendChild(restoreBtn)
    buttonsContainer.appendChild(deleteBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    if (extraRow) box.appendChild(extraRow)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    setTimeout(() => deleteBtn.focus(), 50)

    overlay.onclick = (e) => {
      if (e.target === overlay) closeDialog('cancel')
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog('cancel')
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

/**
 * WebDAV 远程文件删除确认对话框
 * @param filename 文件名
 * @returns Promise<TwoChoiceResult> - 'confirm': 同步删除本地, 'cancel': 保留本地
 */
export function showRemoteDeleteDialog(filename: string): Promise<TwoChoiceResult>;
export function showRemoteDeleteDialog(filename: string, opts: { withApplyToAll: true }): Promise<ApplyToAllResult<TwoChoiceResult>>;
export function showRemoteDeleteDialog(
  filename: string,
  opts?: DialogApplyAllOptions
): Promise<TwoChoiceResult | ApplyToAllResult<TwoChoiceResult>> {
  return new Promise((resolve) => {
    injectStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.innerHTML = `<span class="custom-dialog-icon">⚠️</span>${t('dlg.sync.remoteDelete.title')}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    messageEl.textContent = t('dlg.sync.remoteDelete.msg', { name: filename })

    let applyToAll = false
    const extraRow = opts?.withApplyToAll
      ? createApplyToAllRow((checked) => { applyToAll = checked })
      : null

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    const keepBtn = document.createElement('button')
    keepBtn.className = 'custom-dialog-button'
    keepBtn.textContent = t('dlg.sync.remoteDelete.keepLocal')

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'custom-dialog-button danger'
    deleteBtn.textContent = t('dlg.sync.remoteDelete.deleteLocal')

    function closeDialog(result: TwoChoiceResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        if (opts?.withApplyToAll) resolve({ result, applyToAll })
        else resolve(result)
      }, 100)
    }

    keepBtn.onclick = () => closeDialog('cancel')
    deleteBtn.onclick = () => closeDialog('confirm')

    buttonsContainer.appendChild(keepBtn)
    buttonsContainer.appendChild(deleteBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    if (extraRow) box.appendChild(extraRow)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    setTimeout(() => keepBtn.focus(), 50)

    overlay.onclick = (e) => {
      if (e.target === overlay) closeDialog('cancel')
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog('cancel')
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

/**
 * WebDAV safe 模式：本地存在但远端不存在时的上传确认对话框
 * @param filename 文件名
 * @returns Promise<TwoChoiceResult> - 'confirm': 上传本地到远端, 'cancel': 仅保留本地
 */
export function showUploadMissingRemoteDialog(filename: string): Promise<TwoChoiceResult>;
export function showUploadMissingRemoteDialog(filename: string, opts: { withApplyToAll: true }): Promise<ApplyToAllResult<TwoChoiceResult>>;
export function showUploadMissingRemoteDialog(
  filename: string,
  opts?: DialogApplyAllOptions
): Promise<TwoChoiceResult | ApplyToAllResult<TwoChoiceResult>> {
  return new Promise((resolve) => {
    injectStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'

    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.innerHTML = `<span class="custom-dialog-icon">📤</span>${t('dlg.sync.uploadMissing.title')}`

    const messageEl = document.createElement('div')
    messageEl.className = 'custom-dialog-message'
    messageEl.textContent = t('dlg.sync.uploadMissing.msg', { name: filename })

    let applyToAll = false
    const extraRow = opts?.withApplyToAll
      ? createApplyToAllRow((checked) => { applyToAll = checked })
      : null

    const buttonsContainer = document.createElement('div')
    buttonsContainer.className = 'custom-dialog-buttons'

    const keepLocalBtn = document.createElement('button')
    keepLocalBtn.className = 'custom-dialog-button'
    keepLocalBtn.textContent = t('dlg.sync.uploadMissing.keepLocal')

    const uploadBtn = document.createElement('button')
    uploadBtn.className = 'custom-dialog-button primary'
    uploadBtn.textContent = t('dlg.sync.uploadMissing.upload')

    function closeDialog(result: TwoChoiceResult) {
      overlay.style.animation = 'dialogFadeIn 0.1s ease reverse'
      setTimeout(() => {
        overlay.remove()
        if (opts?.withApplyToAll) resolve({ result, applyToAll })
        else resolve(result)
      }, 100)
    }

    keepLocalBtn.onclick = () => closeDialog('cancel')
    uploadBtn.onclick = () => closeDialog('confirm')

    buttonsContainer.appendChild(keepLocalBtn)
    buttonsContainer.appendChild(uploadBtn)

    box.appendChild(titleEl)
    box.appendChild(messageEl)
    if (extraRow) box.appendChild(extraRow)
    box.appendChild(buttonsContainer)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    setTimeout(() => uploadBtn.focus(), 50)

    overlay.onclick = (e) => {
      if (e.target === overlay) closeDialog('cancel')
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog('cancel')
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
  })
}

// ============================================================
// 文件监听 — 偏好设置模态
// ============================================================

export type FileWatchPrefs = {
  enabled: boolean
  autoReloadClean: boolean
  debugLog: boolean
}

/** 仅本模态用到的局部样式(不影响其他对话框) */
const fileWatchPrefsStyles = `
.fwprefs-list { display: grid; gap: 14px; margin: 4px 0 22px 0; }
.fwprefs-row { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
.fwprefs-label { color: var(--fg); font-size: 14px; font-weight: 600; cursor: pointer; }
.fwprefs-hint  { color: var(--fg); font-size: 12px; line-height: 1.5; opacity: 0.7; margin-top: 3px; }
`
function injectFileWatchPrefsStyles(): void {
  injectStyles()
  const styleId = 'file-watch-prefs-dialog-styles'
  if (document.getElementById(styleId)) return
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = fileWatchPrefsStyles
  document.head.appendChild(style)
}

/**
 * 文件监听设置模态(3 开关:总开关 / 干净自动重载 / 调试日志)
 *
 * 行为:
 * - 返回 `null`:用户取消(ESC / 点关闭 / 点遮罩)
 * - 返回 `FileWatchPrefs`:用户点击保存
 * - 默认焦点在"关闭"按钮(防误操作)
 */
export function showFileWatchPrefsDialog(initial: FileWatchPrefs): Promise<FileWatchPrefs | null> {
  return new Promise((resolve) => {
    injectFileWatchPrefsStyles()

    const overlay = document.createElement('div')
    overlay.className = 'custom-dialog-overlay'
    const box = document.createElement('div')
    box.className = 'custom-dialog-box'

    // 标题 + 简介
    const titleEl = document.createElement('div')
    titleEl.className = 'custom-dialog-title'
    titleEl.textContent = t('filewatch.prefs.title') || '文件监听设置'
    const msgEl = document.createElement('div')
    msgEl.className = 'custom-dialog-message'
    msgEl.textContent = t('filewatch.prefs.message')
      || '配置外部文件修改后的提示、重载与调试行为。'

    // 三行 switch
    const list = document.createElement('div')
    list.className = 'fwprefs-list'
    const enabledEl = makeSwitchRow(list, {
      id: 'fwprefs-enabled',
      label: t('filewatch.prefs.enabled') || '启用外部修改监听',
      hint: t('filewatch.prefs.enabled.hint') || '关闭后,外部修改不会触发任何提示或自动重载',
    })
    const autoReloadEl = makeSwitchRow(list, {
      id: 'fwprefs-autoReloadClean',
      label: t('filewatch.prefs.autoReloadClean') || '干净标签自动重载',
      hint: t('filewatch.prefs.autoReloadClean.hint')
        || '当前标签未修改时,自动用磁盘内容覆盖;脏标签仍会弹模态',
    })
    const debugEl = makeSwitchRow(list, {
      id: 'fwprefs-debugLog',
      label: t('filewatch.prefs.debugLog') || '调试日志',
      hint: t('filewatch.prefs.debugLog.hint')
        || '在控制台输出 watcher / integration 的详细日志',
    })

    enabledEl.checked = !!initial.enabled
    autoReloadEl.checked = !!initial.autoReloadClean
    debugEl.checked = !!initial.debugLog

    // 按钮:关闭(neutral,默认焦点)在左,保存(primary)在右
    const btnRow = document.createElement('div')
    btnRow.className = 'custom-dialog-buttons'
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'custom-dialog-button'
    closeBtn.textContent = t('filewatch.prefs.btn.close') || '关闭'
    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'custom-dialog-button primary'
    saveBtn.textContent = t('filewatch.prefs.btn.save') || '保存'
    btnRow.appendChild(closeBtn)
    btnRow.appendChild(saveBtn)

    box.appendChild(titleEl)
    box.appendChild(msgEl)
    box.appendChild(list)
    box.appendChild(btnRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    let closed = false
    function closeDialog(result: FileWatchPrefs | null): void {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', handleKeyDown)
      try { overlay.remove() } catch { /* 已被清理 */ }
      resolve(result)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDialog(null)
      }
    }
    function handleSave(): void {
      closeDialog({
        enabled: enabledEl.checked,
        autoReloadClean: autoReloadEl.checked,
        debugLog: debugEl.checked,
      })
    }
    saveBtn.addEventListener('click', handleSave)
    closeBtn.addEventListener('click', () => closeDialog(null))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(null) })
    document.addEventListener('keydown', handleKeyDown)
    setTimeout(() => closeBtn.focus(), 50)
  })
}

/** 内部工具:构造一行(label + hint 在左,switch 在右),返回 checkbox 元素 */
function makeSwitchRow(
  container: HTMLElement,
  opts: { id: string; label: string; hint: string },
): HTMLInputElement {
  const row = document.createElement('div')
  row.className = 'fwprefs-row'

  const left = document.createElement('div')
  const label = document.createElement('label')
  label.className = 'fwprefs-label'
  label.htmlFor = opts.id
  label.textContent = opts.label
  const hint = document.createElement('div')
  hint.className = 'fwprefs-hint'
  hint.textContent = opts.hint
  left.appendChild(label)
  left.appendChild(hint)

  const switchLabel = document.createElement('label')
  switchLabel.className = 'switch'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.id = opts.id
  const trk = document.createElement('span')
  trk.className = 'trk'
  const kn = document.createElement('span')
  kn.className = 'kn'
  switchLabel.appendChild(input)
  switchLabel.appendChild(trk)
  switchLabel.appendChild(kn)

  row.appendChild(left)
  row.appendChild(switchLabel)
  container.appendChild(row)
  return input
}
