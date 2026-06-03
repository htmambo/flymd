/**
 * 自定义三按钮确认对话框及相关 WebDAV 同步对话框
 * 所有用户可见文案统一接入 i18n
 */

import { t } from './i18n'

// ============================================================
// 文件外部更改监听 — 冲突确认模态(由 main.ts 装配 extWatcher 时调用)
// ============================================================

/** 文件监听冲突模态的返回值 */
export type FileWatchConflictChoice = 'reload' | 'keep' | 'cancel'

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
 * 按钮顺序:取消(neutral,默认焦点) / 保留本地(primary) / 重新加载(danger)
 * - ESC 视为取消
 * - 遮罩点击视为取消
 * - 焦点默认落在"取消",防误操作
 */
export function showFileWatchConflictDialog(filePath: string): Promise<FileWatchConflictChoice> {
  return new Promise((resolve) => {
    injectStyles()

    const name = fileWatchBasename(filePath)
    const title = t('filewatch.conflict.title' as any) || '文件已在外部修改'
    const body = (t('filewatch.conflict.body' as any) || '{name} 已被其它程序修改,且当前文档存在未保存改动。请选择处理方式:')
      .replace('{name}', name)
    const buttons = {
      reload: t('filewatch.conflict.btn.reload' as any) || '重新加载(放弃本地)',
      keep: t('filewatch.conflict.btn.keep' as any) || '保留本地(下次保存覆盖)',
      cancel: t('filewatch.conflict.btn.cancel' as any) || '取消',
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
    titleEl.textContent = t('filewatch.prefs.title' as any) || '文件监听设置'
    const msgEl = document.createElement('div')
    msgEl.className = 'custom-dialog-message'
    msgEl.textContent = t('filewatch.prefs.message' as any)
      || '配置外部文件修改后的提示、重载与调试行为。'

    // 三行 switch
    const list = document.createElement('div')
    list.className = 'fwprefs-list'
    const enabledEl = makeSwitchRow(list, {
      id: 'fwprefs-enabled',
      label: t('filewatch.prefs.enabled' as any) || '启用外部修改监听',
      hint: t('filewatch.prefs.enabled.hint' as any) || '关闭后,外部修改不会触发任何提示或自动重载',
    })
    const autoReloadEl = makeSwitchRow(list, {
      id: 'fwprefs-autoReloadClean',
      label: t('filewatch.prefs.autoReloadClean' as any) || '干净标签自动重载',
      hint: t('filewatch.prefs.autoReloadClean.hint' as any)
        || '当前标签未修改时,自动用磁盘内容覆盖;脏标签仍会弹模态',
    })
    const debugEl = makeSwitchRow(list, {
      id: 'fwprefs-debugLog',
      label: t('filewatch.prefs.debugLog' as any) || '调试日志',
      hint: t('filewatch.prefs.debugLog.hint' as any)
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
    closeBtn.textContent = t('filewatch.prefs.btn.close' as any) || '关闭'
    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'custom-dialog-button primary'
    saveBtn.textContent = t('filewatch.prefs.btn.save' as any) || '保存'
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
