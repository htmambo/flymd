// 内容区底部常驻状态栏控制器
// 布局：左侧文件路径 | 中槽瞬态消息 | 右侧四项常驻状态
// 右侧四项：行/列、字数、未保存标记、缩放%
//
// 设计要点：
// - `#status` 这个 DOM id 被保留为「中槽消息元素」。现有 10+ 个写入方
//   （保存成功/导出/打印/同步/更新/插件提示/错误）直接写 `#status` 的 textContent，
//   全部无需改动；本模块用 MutationObserver 兜底统一它们的清除时机。
// - 常驻统计独立成 4 个子槽，与消息互不覆盖；本模块是这些槽位的唯一写入方，
//   数据来源由调用方注入（行/列与字数来自 titlebarStatus，缩放来自 uiZoom）。
// - 消息槽自带统一自动清除定时器（单一 timer 句柄，避免竞态）。

/** 消息槽默认自动清除时长（ms）。写消息后静默这么久再清空。 */
export const STATUS_MESSAGE_TTL = 4000

export interface StatusBarApi {
  /** 写瞬态消息（自动定时清除） */
  setMessage(text: string): void
  /** 清空瞬态消息并取消待清除定时器 */
  clearMessage(): void
  /** 更新行/列（传入 null 表示当前模式下无光标，隐藏该项） */
  setPosition(text: string | null): void
  /** 更新字数 */
  setChars(text: string | null): void
  /** 更新未保存标记（tip 为 tooltip 文案） */
  setDirty(dirty: boolean, tip?: string): void
  /** 更新缩放百分比 */
  setZoom(text: string | null): void
  /** 释放定时器与观察器 */
  dispose(): void
}

function el(id: string): HTMLElement | null {
  try {
    return document.getElementById(id)
  } catch {
    return null
  }
}

/**
 * 创建状态栏控制器。
 *
 * 只做 DOM 读写与定时管理，不关心数据来源；数据由调用方注入。
 * 必须在状态栏 DOM 注入之后调用。
 */
export function createStatusBar(): StatusBarApi {
  const messageEl = el('status')
  const posEl = el('statusbar-pos')
  const charsEl = el('statusbar-chars')
  const dirtyEl = el('statusbar-dirty')
  const zoomEl = el('statusbar-zoom')

  // 单一 timer 句柄：任何新的写入都会取消上一个待清除定时器，
  // 避免「后写的消息被前一个定时器提前清掉」的竞态。
  let clearTimer: number | null = null
  let observer: MutationObserver | null = null
  // 本模块最后一次写入的文本：用于区分「自己写的」与「外部写入」，
  // 避免内部写入触发 MutationObserver 后把刚设的定时器取消再重设。
  let lastWritten = ''

  function cancelClear(): void {
    if (clearTimer === null) return
    try {
      window.clearTimeout(clearTimer)
    } catch {
      /* noop */
    }
    clearTimer = null
  }

  function writeMessage(text: string): void {
    if (!messageEl) return
    lastWritten = text
    try {
      messageEl.textContent = text
    } catch {
      /* noop */
    }
  }

  /**
   * 装填清除定时器：到点时只有内容仍是 expected 才清空，
   * 避免误清后写的消息。
   */
  function armTimer(expected: string): void {
    cancelClear()
    try {
      clearTimer = window.setTimeout(() => {
        clearTimer = null
        const cur = messageEl?.textContent || ''
        if (cur === expected) writeMessage('')
      }, STATUS_MESSAGE_TTL)
    } catch {
      /* noop */
    }
  }

  function setMessage(text: string): void {
    cancelClear()
    writeMessage(text)
    if (!text) return
    armTimer(text)
  }

  /**
   * 观察消息槽的外部写入。
   *
   * 现有 10+ 个写入方直接 `document.getElementById('status').textContent = ...`，
   * 绕过 setMessage。这里用 MutationObserver 兜底：任何外部写入都会重置
   * 单一清除定时器，保证消息不会永久滞留(showError / upMsg 原本永不恢复)。
   */
  function observeMessageWrites(): void {
    if (!messageEl) return
    // 重复调用时先断开旧观察器，避免遗留实例
    try { observer?.disconnect() } catch { /* noop */ }
    observer = null
    try {
      observer = new MutationObserver(() => {
        const cur = messageEl?.textContent || ''
        if (!cur) return
        // 本模块自己刚写的文本：setMessage 已经装填过定时器,无需重设
        if (cur === lastWritten) return
        // 外部写入:统一按 TTL 自动清除
        // (设计上「永不恢复」的历史写入方也走这条路径,见文件头注释)
        armTimer(cur)
      })
      observer.observe(messageEl, { childList: true, characterData: true, subtree: true })
    } catch {
      /* noop */
    }
  }

  function clearMessage(): void {
    cancelClear()
    writeMessage('')
  }

  function setText(target: HTMLElement | null, text: string | null): void {
    if (!target) return
    try {
      target.textContent = text == null ? '' : text
    } catch {
      /* noop */
    }
  }

  function setPosition(text: string | null): void {
    setText(posEl, text)
  }

  function setChars(text: string | null): void {
    setText(charsEl, text)
  }

  function setDirty(dirtyFlag: boolean, tip?: string): void {
    if (!dirtyEl) return
    try {
      dirtyEl.textContent = dirtyFlag ? '●' : ''
      dirtyEl.setAttribute('data-dirty', dirtyFlag ? '1' : '0')
      dirtyEl.title = dirtyFlag ? (tip || '') : ''
    } catch {
      /* noop */
    }
  }

  function setZoom(text: string | null): void {
    setText(zoomEl, text)
  }

  observeMessageWrites()

  function dispose(): void {
    cancelClear()
    try { observer?.disconnect() } catch { /* noop */ }
    observer = null
  }

  return { setMessage, clearMessage, setPosition, setChars, setDirty, setZoom, dispose }
}
