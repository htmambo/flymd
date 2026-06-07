/**
 * 标签栏 UI 组件
 *
 * 功能：
 * - 显示所有打开的标签
 * - 点击切换标签
 * - 中键/关闭按钮关闭标签
 * - 拖拽排序
 * - 新建标签按钮
 */

import { TabManager } from './TabManager'
import { TabDocument, getTabDisplayName } from './types'
import { moveTabToWindowLabel } from './tabTransferSender'
import { createEditorWebviewWindow, destroyWebviewWindowByLabel, findWebviewWindowLabelAtScreenPoint, getCurrentWebviewWindowLabel } from '../windows/editorWindows'
import { cleanupDragGhostWindows, createDragGhostWindow, type DragGhostWindow } from '../windows/dragGhostWindow'

export interface TabBarOptions {
  container: HTMLElement
  tabManager: TabManager
  onBeforeClose?: (tab: TabDocument) => Promise<boolean> // 关闭前确认
}

export class TabBar {
  private container: HTMLElement
  private tabManager: TabManager
  private onBeforeClose?: (tab: TabDocument) => Promise<boolean>
  private tabsContainer: HTMLElement | null = null
  private unsubscribe: (() => void) | null = null
  private suppressNextClick = false
  // 标签宽度压缩：用 ResizeObserver + rAF 合并更新，避免频繁读写布局
  private resizeObserver: ResizeObserver | null = null
  private layoutRaf = 0

  // 拖拽状态
  private draggedTabId: string | null = null
  private dragOverTabId: string | null = null
  private contextMenuEl: HTMLDivElement | null = null
  private contextMenuTargetTabId: string | null = null
  private contextMenuVisible = false

  // 拖拽跨出窗口时的“幽灵窗口”（用于在窗口外显示拖拽提示）
  private dragGhostWin: DragGhostWindow | null = null
  private dragGhostLastMoveAt = 0
  private dragGhostCreating = false
  private dragGhostGen = 0
  private dragGhostVisible = false
  private dragGhostMoveInFlight = false
  private dragGhostPending: { text: string; x: number; y: number } | null = null
  private dragGhostToken = 0
  private dragGhostLastText = ''
  private handleContextMenuOutside = (event: Event) => {
    if (!this.contextMenuVisible) return
    const target = event.target as Node | null
    if (target && this.contextMenuEl && this.contextMenuEl.contains(target)) return
    this.hideContextMenu()
  }
  private handleContextMenuKeydown = (event: KeyboardEvent) => {
    if (!this.contextMenuVisible) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.hideContextMenu()
    }
  }

  constructor(options: TabBarOptions) {
    this.container = options.container
    this.tabManager = options.tabManager
    this.onBeforeClose = options.onBeforeClose
  }

  /**
   * 初始化标签栏
   */
  init(): void {
    this.render()
    this.bindEvents()
    this.bindLayoutObservers()
    // 兜底清理：把旧版本遗留的 drag-ghost 窗口干掉（避免用户看到一屏“拖拽标签”残影）
    try { setTimeout(() => { void cleanupDragGhostWindows() }, 0) } catch {}
  }

  /**
   * 渲染标签栏
   */
  private render(): void {
    this.container.innerHTML = ''
    this.container.className = 'tabbar'

    // 标签容器（可滚动）
    this.tabsContainer = document.createElement('div')
    this.tabsContainer.className = 'tabbar-tabs'
    this.container.appendChild(this.tabsContainer)

    // 渲染所有标签
    this.renderTabs()
  }

  /**
   * 渲染标签列表
   */
  private renderTabs(): void {
    if (!this.tabsContainer) return

    this.tabsContainer.innerHTML = ''
    const tabs = this.tabManager.getTabs()
    const activeTabId = this.tabManager.getActiveTabId()

    for (const tab of tabs) {
      const tabEl = this.createTabElement(tab, tab.id === activeTabId)
      this.tabsContainer.appendChild(tabEl)
    }

    // 新建按钮作为最后一个“标签”
    const newTabBtn = document.createElement('div')
    newTabBtn.className = 'tabbar-new-btn'
    newTabBtn.title = '新建标签 (Ctrl+T)'
    newTabBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
    newTabBtn.addEventListener('click', () => {
      // 优先走全局的 newFile 钩子，这样行为与 Ctrl+T 保持一致：
      // - 触发原始 newFile 逻辑（预览刷新等）
      // - 经过 tabs/integration 中的 hookNewFile，创建并激活新标签
      const flymd = (window as any)
      const newFileFn = flymd?.flymdNewFile as (() => Promise<void>) | undefined
      if (typeof newFileFn === 'function') {
        void newFileFn()
      } else {
        // 退化路径：在极端情况下（未初始化标签系统）仍然保证能新建标签
        this.tabManager.createNewTab()
      }
    })
    this.tabsContainer.appendChild(newTabBtn)

    // 渲染完再做一次布局判定：超过可见范围就压缩所有标签宽度，确保新标签可见（Obsidian 风格）
    this.scheduleLayoutUpdate()
  }

  /**
   * 绑定标签栏布局监听（容器尺寸变化时动态切换“压缩模式”）
   */
  private bindLayoutObservers(): void {
    if (!this.tabsContainer) return
    // 重复 init / 热更新时避免泄漏
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver = new ResizeObserver(() => this.scheduleLayoutUpdate())
    this.resizeObserver.observe(this.tabsContainer)
    // 初始化时也跑一次
    this.scheduleLayoutUpdate()
  }

  private scheduleLayoutUpdate(): void {
    if (this.layoutRaf) return
    this.layoutRaf = window.requestAnimationFrame(() => {
      this.layoutRaf = 0
      this.updateCompressionState()
    })
  }

  /**
   * 当标签超出可显示范围时，启用“压缩模式”把所有标签挤进可见区域。
   * 设计点：只在溢出时改布局，避免影响少量标签时的现有观感/交互。
   */
  private updateCompressionState(): void {
    const el = this.tabsContainer
    if (!el) return

    const cls = 'tabbar-tabs--compressed'

    // 如果当前是压缩模式，先临时关闭再测一次，确保“关闭标签后能自动恢复”
    const had = el.classList.contains(cls)
    if (had) el.classList.remove(cls)

    // scrollWidth/clientWidth 是最稳的“有没有溢出”判断
    const overflow = el.scrollWidth > el.clientWidth + 1
    if (overflow) {
      el.classList.add(cls)
      // 进入压缩模式后不应该再“停留在某个滚动位置”，直接回到起点确保全部可见
      el.scrollLeft = 0
    }
    else el.classList.remove(cls)
  }

  /**
   * 创建单个标签元素
   */
  private createTabElement(tab: TabDocument, isActive: boolean): HTMLElement {
    const tabEl = document.createElement('div')
    tabEl.className = 'tabbar-tab' + (isActive ? ' active' : '') + (tab.dirty ? ' dirty' : '')
    tabEl.dataset.tabId = tab.id
    tabEl.draggable = false

    // 文件图标
    const icon = document.createElement('span')
    icon.className = 'tabbar-tab-icon'
    icon.innerHTML = this.getFileIcon(tab.filePath)
    tabEl.appendChild(icon)

    // 标签名称
    const name = document.createElement('span')
    name.className = 'tabbar-tab-name'
    name.textContent = getTabDisplayName(tab)
    name.title = tab.filePath || getTabDisplayName(tab)
    tabEl.appendChild(name)

    // 修改指示器
    if (tab.dirty) {
      const dirtyDot = document.createElement('span')
      dirtyDot.className = 'tabbar-tab-dirty'
      dirtyDot.textContent = '●'
      tabEl.appendChild(dirtyDot)
    }

    // 关闭按钮
    const closeBtn = document.createElement('span')
    closeBtn.className = 'tabbar-tab-close'
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
    closeBtn.title = '关闭'
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      void this.closeTab(tab.id)
    })
    tabEl.appendChild(closeBtn)

    // 点击切换
    tabEl.addEventListener('click', () => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false
        return
      }
      this.tabManager.switchToTab(tab.id)
    })

    // 中键关闭
    tabEl.addEventListener('mousedown', (e) => {
      if (e.button === 1) { // 中键
        e.preventDefault()
        void this.closeTab(tab.id)
      }
    })

    // 右键菜单
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.showContextMenu(e.clientX, e.clientY, tab.id)
    })

    // 拖拽排序（使用鼠标事件实现，绕开 WebView2 原生 DnD 的🚫问题）
    let dragState:
      | {
          startX: number
          startY: number
          pointerId: number
          isDragging: boolean
          targetEl: HTMLElement | null
          insertAfter: boolean
          ghostEl: HTMLElement | null
          offsetX: number
          offsetY: number
        }
      | null = null

    const isOutsideWindowClient = (x: number, y: number, margin: number) => {
      return x < -margin || y < -margin || x > window.innerWidth + margin || y > window.innerHeight + margin
    }

    const isOutsideWindowScreen = (x: number, y: number, margin: number) => {
      try {
        const left = (window as any).screenX
        const top = (window as any).screenY
        const w = (window as any).outerWidth
        const h = (window as any).outerHeight
        if (![left, top, w, h, x, y].every((n) => Number.isFinite(n))) return false
        const right = left + w
        const bottom = top + h
        return x < left - margin || y < top - margin || x > right + margin || y > bottom + margin
      } catch {}
      return false
    }

    const isOutsideWindow = (e: PointerEvent, margin: number) => {
      // 只用 client 坐标判定：在 Tauri 下 window.screenX/outerWidth 的一致性不可靠，容易误判导致幽灵窗口不消失
      return isOutsideWindowClient(e.clientX, e.clientY, margin)
    }

    const elementFromClientPoint = (x: number, y: number): HTMLElement | null => {
      if (isOutsideWindowClient(x, y, 0)) return null
      try { return document.elementFromPoint(x, y) as HTMLElement | null } catch {}
      return null
    }

    const clearDragIndicators = () => {
      if (!dragState?.targetEl) return
      dragState.targetEl.classList.remove('drag-over-left', 'drag-over-right')
      dragState.targetEl = null
    }

    const cleanupDrag = () => {
      // 先隐藏“窗口外幽灵”，避免残留挡手（窗口保留用于复用，减少下次拖出延迟）
      void this.hideDragGhostWindow()
      tabEl.removeEventListener('pointermove', handlePointerMove)
      tabEl.removeEventListener('pointerup', handlePointerUp, true)
      tabEl.removeEventListener('pointercancel', handlePointerCancel, true)
      try {
        if (dragState) tabEl.releasePointerCapture(dragState.pointerId)
      } catch {}
      // 销毁幽灵元素
      try {
        if (dragState?.ghostEl) {
          dragState.ghostEl.remove()
        }
      } catch {}
      tabEl.classList.remove('dragging')
      clearDragIndicators()
      this.draggedTabId = null
      this.dragOverTabId = null
      try { document.body.style.userSelect = '' } catch {}
      try { document.body.style.cursor = '' } catch {}
      dragState = null
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragState || !this.draggedTabId) return

      if (!dragState.isDragging) {
        const dx = e.clientX - dragState.startX
        const dy = e.clientY - dragState.startY
        if (Math.hypot(dx, dy) <= 5) return
        dragState.isDragging = true
        tabEl.classList.add('dragging')
        try { document.body.style.userSelect = 'none' } catch {}
        try { document.body.style.cursor = 'grabbing' } catch {}

        // 预热“窗口外幽灵窗口”：尽量在鼠标真正跨出窗口之前就把窗口建好
        void this.ensureDragGhostWindow((tab.dirty ? '● ' : '') + getTabDisplayName(tab))

        // 创建幽灵元素
        try {
          const rect = tabEl.getBoundingClientRect()
          const ghost = tabEl.cloneNode(true) as HTMLElement
          ghost.classList.add('tabbar-tab-ghost')
          ghost.classList.remove('dragging', 'active')
          ghost.style.width = rect.width + 'px'
          ghost.style.height = rect.height + 'px'
          // 计算鼠标相对于标签的偏移
          dragState.offsetX = dragState.startX - rect.left
          dragState.offsetY = dragState.startY - rect.top
          ghost.style.left = (e.clientX - dragState.offsetX) + 'px'
          ghost.style.top = (e.clientY - dragState.offsetY) + 'px'
          document.body.appendChild(ghost)
          dragState.ghostEl = ghost
        } catch {}
      }

      // 更新幽灵元素位置
      if (dragState.ghostEl) {
        dragState.ghostEl.style.left = (e.clientX - dragState.offsetX) + 'px'
        dragState.ghostEl.style.top = (e.clientY - dragState.offsetY) + 'px'
      }

      // 鼠标跨出窗口：DOM 幽灵会跑到视口外看不见，用一个透明置顶小窗口跟随鼠标作为提示
      const outside = isOutsideWindow(e, 8)
      void this.updateDragGhostWindow(outside, tab, e.screenX, e.screenY)

      // 指针捕获后，event.target 永远是 tabEl；必须用 elementFromPoint 找到“鼠标下的元素”。
      const under = elementFromClientPoint(e.clientX, e.clientY)

      // 允许拖到“新建标签按钮”上，作为“移动到最后”
      const overNewBtn = under?.closest?.('.tabbar-new-btn') as HTMLElement | null
      if (overNewBtn) {
        const list = Array.from(this.tabsContainer?.querySelectorAll('.tabbar-tab') || []) as HTMLElement[]
        const last = list.length ? list[list.length - 1] : null
        if (last && last !== tabEl) {
          if (dragState.targetEl && dragState.targetEl !== last) {
            dragState.targetEl.classList.remove('drag-over-left', 'drag-over-right')
          }
          dragState.targetEl = last
          dragState.insertAfter = true
          last.classList.remove('drag-over-left')
          last.classList.add('drag-over-right')
          this.dragOverTabId = last.dataset.tabId || null
          return
        }
      }

      const targetTab = under?.closest?.('.tabbar-tab') as HTMLElement | null
      if (!targetTab || targetTab === tabEl) {
        clearDragIndicators()
        return
      }
      if (this.tabsContainer && !this.tabsContainer.contains(targetTab)) {
        clearDragIndicators()
        return
      }

      const rect = targetTab.getBoundingClientRect()
      const insertAfter = e.clientX > rect.left + rect.width / 2

      if (dragState.targetEl && dragState.targetEl !== targetTab) {
        dragState.targetEl.classList.remove('drag-over-left', 'drag-over-right')
      }
      dragState.targetEl = targetTab
      dragState.insertAfter = insertAfter

      targetTab.classList.toggle('drag-over-left', !insertAfter)
      targetTab.classList.toggle('drag-over-right', insertAfter)
      this.dragOverTabId = targetTab.dataset.tabId || null
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState) { cleanupDrag(); return }

      const wasDragging = dragState.isDragging
      const targetEl = dragState.targetEl
      const insertAfter = dragState.insertAfter
      const draggedId = this.draggedTabId

      // 清理 UI/监听器（放在前面，避免 moveTab 触发重渲染后引用失效）
      cleanupDrag()

      if (!wasDragging) return
      this.suppressNextClick = true

      // 拖出窗口后释放：优先投递到其它窗口；否则新建窗口（ACK 后关闭源标签，避免丢数据）
      if (draggedId && isOutsideWindow(e, 8)) {
        void this.detachTabByDropPoint(draggedId, e)
        return
      }

      const targetId = targetEl?.dataset?.tabId || null
      if (!draggedId || !targetId || draggedId === targetId) return

      const tabs = this.tabManager.getTabs()
      const fromIndex = tabs.findIndex((t) => t.id === draggedId)
      const targetIndex = tabs.findIndex((t) => t.id === targetId)
      if (fromIndex < 0 || targetIndex < 0) return

      const insertIndexOriginal = targetIndex + (insertAfter ? 1 : 0)
      let toIndex = insertIndexOriginal
      if (fromIndex < insertIndexOriginal) toIndex = insertIndexOriginal - 1
      toIndex = Math.max(0, Math.min(toIndex, tabs.length - 1))

      this.tabManager.moveTab(fromIndex, toIndex)
    }

    const handlePointerCancel = () => cleanupDrag()

    tabEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      // 点在关闭按钮上不启动拖拽，避免“想关结果开始拖”的糟糕体验
      const t = e.target as HTMLElement | null
      if (t && t.closest('.tabbar-tab-close')) return

      try { e.preventDefault() } catch {}
      this.draggedTabId = tab.id
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        isDragging: false,
        targetEl: null,
        insertAfter: false,
        ghostEl: null,
        offsetX: 0,
        offsetY: 0,
      }
      try { tabEl.setPointerCapture(e.pointerId) } catch {}
      tabEl.addEventListener('pointermove', handlePointerMove)
      tabEl.addEventListener('pointerup', handlePointerUp, true)
      tabEl.addEventListener('pointercancel', handlePointerCancel, true)
    }, true)

    return tabEl
  }

  /**
   * 获取文件图标
   */
  private getFileIcon(filePath: string | null): string {
    if (!filePath) {
      return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>'
    }

    const ext = filePath.split('.').pop()?.toLowerCase()

    // Markdown 图标
    if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20.56 18H3.44C2.65 18 2 17.37 2 16.59V7.41C2 6.63 2.65 6 3.44 6h17.12c.79 0 1.44.63 1.44 1.41v9.18c0 .78-.65 1.41-1.44 1.41zM6.81 15.19v-3.66l1.92 2.35 1.92-2.35v3.66h1.93V8.81h-1.93l-1.92 2.35-1.92-2.35H4.89v6.38h1.92zM19.69 12h-1.92V8.81h-1.92V12h-1.93l2.89 3.28L19.69 12z"/></svg>'
    }

    // PDF 图标（红色）
    if (ext === 'pdf') {
      return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="#e53935" d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>'
    }

    // 默认文件图标
    return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>'
  }

   /**
    * 关闭标签
    */
  private async closeTab(tabId: string): Promise<boolean> {
    const tab = this.tabManager.findTabById(tabId)
    if (!tab) return false

    // 如果有未保存内容，先确认
    if (tab.dirty && this.onBeforeClose) {
      const confirmed = await this.onBeforeClose(tab)
      if (!confirmed) return false
    }

    return await this.tabManager.closeTab(tabId)
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 监听标签管理器事件
    this.unsubscribe = this.tabManager.addEventListener((event) => {
      switch (event.type) {
        case 'tab-created':
        case 'tab-closed':
        case 'tab-switched':
        case 'tab-updated':
        case 'tabs-reordered':
          this.renderTabs()
          break
      }
    })
  }

  /**
   * 确保上下文菜单已创建
   */
  private ensureContextMenu(): void {
    if (this.contextMenuEl) return
    const menu = document.createElement('div')
    menu.className = 'tabbar-context-menu'
    menu.style.display = 'none'
    const actions: Array<{ label: string; action: 'create-sticky-note' | 'export-pdf' | 'rename' | 'close-right' | 'close-others' | 'close-all' }> = [
      { label: '生成便签', action: 'create-sticky-note' },
      { label: '导出为 PDF', action: 'export-pdf' },
      { label: '重命名文档…', action: 'rename' },
      { label: '关闭右侧所有标签', action: 'close-right' },
      { label: '关闭其他标签', action: 'close-others' },
      { label: '关闭所有标签', action: 'close-all' },
    ]
    actions.forEach(({ label, action }) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'tabbar-context-item'
      btn.textContent = label
      btn.addEventListener('click', () => {
        void this.handleContextMenuAction(action)
      })
      menu.appendChild(btn)
    })
    menu.addEventListener('contextmenu', (e) => e.preventDefault())
    document.body.appendChild(menu)
    this.contextMenuEl = menu
  }

  /**
   * 处理上下文菜单动作
   */
  private async handleContextMenuAction(action: 'create-sticky-note' | 'export-pdf' | 'rename' | 'close-right' | 'close-others' | 'close-all'): Promise<void> {
    const targetId = this.contextMenuTargetTabId
    this.hideContextMenu()
    switch (action) {
      case 'create-sticky-note':
        if (targetId) await this.createStickyNote(targetId)
        break
      case 'export-pdf':
        if (targetId) await this.exportTabToPdf(targetId)
        break
      case 'rename':
        if (targetId) await this.renameTabFile(targetId)
        break
      case 'close-right':
        if (targetId) await this.closeTabsToRight(targetId)
        break
      case 'close-others':
        if (targetId) await this.closeOtherTabs(targetId)
        break
      case 'close-all':
        await this.closeAllTabs()
        break
    }
  }

  private async closeTabsToRight(tabId: string): Promise<void> {
    const tabs = [...this.tabManager.getTabs()]
    const index = tabs.findIndex(t => t.id === tabId)
    if (index === -1) return
    const targets = tabs.slice(index + 1).map(t => t.id)
    await this.closeTabsSequentially(targets)
  }

  private async closeOtherTabs(tabId: string): Promise<void> {
    const tabs = [...this.tabManager.getTabs()]
    const targets = tabs.filter(t => t.id !== tabId).map(t => t.id)
    await this.closeTabsSequentially(targets)
  }

  private async closeAllTabs(): Promise<void> {
    const tabs = [...this.tabManager.getTabs()]
    const targets = tabs.map(t => t.id)
    await this.closeTabsSequentially(targets)
  }

  private async closeTabsSequentially(tabIds: string[]): Promise<void> {
    for (const id of tabIds) {
      const ok = await this.closeTab(id)
      if (!ok) break
    }
  }

  /**
   * 拖拽”跨窗口移动标签”入口
   *
   * 策略：
   * - 优先命中其它窗口：拖到窗口上 → 在目标窗口打开为标签（ACK 后关闭源标签）
   * - 否则创建新窗口：拖到空白区域 → 新窗口打开为标签（ACK 后关闭源标签）
   */
  private async detachTabByDropPoint(tabId: string, e: PointerEvent): Promise<void> {
    // 拖放落地前先隐藏”窗口外幽灵”，避免目标窗口被遮挡
    try { await this.hideDragGhostWindow() } catch {}

    const myLabel = await getCurrentWebviewWindowLabel()
    const targetLabel = await findWebviewWindowLabelAtScreenPoint(e.screenX, e.screenY, {
      excludeLabel: myLabel || undefined,
      margin: 8,
    })

    // 1) 命中其它窗口：直接投递
    if (targetLabel) {
      const r = await moveTabToWindowLabel(this.tabManager, tabId, targetLabel)
      if (!r.ok && r.message) {
        // 不动源标签，避免丢数据
        try { alert('拖拽失败：' + r.message) } catch {}
      }
      return
    }

    // 2) 没命中：创建新窗口再投递
    const created = await createEditorWebviewWindow({
      // 尽量在鼠标释放点附近创建窗口（用户直觉）
      x: Math.round(e.screenX),
      y: Math.round(e.screenY),
    })
    if (!created?.label) {
      alert('无法创建新窗口')
      return
    }

    const r = await moveTabToWindowLabel(this.tabManager, tabId, created.label, {
      // 新窗口首包更容易丢，稍微给它多一点时间
      timeoutMs: 9000,
      retries: 18,
      retryDelayMs: 260,
    })
    if (!r.ok && r.message) {
      try { alert('拖拽失败：' + r.message) } catch {}
      // 自动创建的空窗口：投递失败就销毁，避免留下一个“空实例”
      try { await destroyWebviewWindowByLabel(created.label) } catch {}
    }
  }

  private async destroyDragGhostWindow(): Promise<void> {
    const w = this.dragGhostWin
    this.dragGhostWin = null
    this.dragGhostLastMoveAt = 0
    this.dragGhostCreating = false
    this.dragGhostGen++
    this.dragGhostVisible = false
    this.dragGhostPending = null
    this.dragGhostMoveInFlight = false
    this.dragGhostToken++
    this.dragGhostLastText = ''
    if (!w) return
    try { await w.destroy() } catch {}
  }

  private async hideDragGhostWindow(): Promise<void> {
    this.dragGhostPending = null
    this.dragGhostToken++
    if (!this.dragGhostWin) return
    try { await this.dragGhostWin.hide() } catch {}
    this.dragGhostVisible = false
  }

  private async ensureDragGhostWindow(initialText: string): Promise<void> {
    if (this.dragGhostWin) return
    if (this.dragGhostCreating) return
    this.dragGhostCreating = true
    const gen = this.dragGhostGen
    let created: DragGhostWindow | null = null
    try {
      created = await createDragGhostWindow(initialText)
    } finally {
      this.dragGhostCreating = false
    }
    if (!created) return
    if (this.dragGhostGen !== gen || this.dragGhostWin) {
      try { await created.destroy() } catch {}
      return
    }
    this.dragGhostWin = created
    this.dragGhostVisible = false
    this.dragGhostLastText = ''
  }

  private queueDragGhostUpdate(text: string, x: number, y: number): void {
    this.dragGhostPending = { text, x, y }
    if (this.dragGhostMoveInFlight) return
    this.dragGhostMoveInFlight = true
    const token = this.dragGhostToken
    void this.flushDragGhostUpdates(token)
  }

  private async flushDragGhostUpdates(token: number): Promise<void> {
    try {
      while (this.dragGhostPending && token === this.dragGhostToken) {
        const p = this.dragGhostPending
        this.dragGhostPending = null
        await this.ensureDragGhostWindow(p.text)
        if (!this.dragGhostWin || token !== this.dragGhostToken) break

        if (token !== this.dragGhostToken) break
        if (this.dragGhostLastText !== p.text) {
          try { this.dragGhostWin.setText(p.text) } catch {}
          this.dragGhostLastText = p.text
        }
        if (token !== this.dragGhostToken) break
        if (!this.dragGhostVisible) {
          try { await this.dragGhostWin.show() } catch {}
          // show/hide 是异步 IPC：若在 show 过程中被取消（token 变更），必须立刻补一刀 hide，避免幽灵窗口“亮出来就没人管”
          if (token !== this.dragGhostToken) {
            try { await this.dragGhostWin.hide() } catch {}
            break
          }
          this.dragGhostVisible = true
        }
        if (token !== this.dragGhostToken) break
        await this.dragGhostWin.setPosition(p.x, p.y)
      }
    } finally {
      this.dragGhostMoveInFlight = false
      // 若在本次 flush 结束后又来了新的位置更新，由 queueDragGhostUpdate 再次启动
    }
  }

  private updateDragGhostWindow(outside: boolean, tab: TabDocument, screenX: number, screenY: number): void {
    // 只在 Tauri 桌面端生效，失败静默降级
    if (!outside) {
      void this.hideDragGhostWindow()
      return
    }

    // 节流：窗口移动是 IPC，别每个 pointermove 都打
    const now = Date.now()
    if (now - this.dragGhostLastMoveAt < 28) return
    this.dragGhostLastMoveAt = now

    const name = getTabDisplayName(tab)
    const dirtyMark = tab.dirty ? '● ' : ''
    const text = dirtyMark + name

    // 让幽灵稍微避开鼠标指针，别正好盖在指针下
    const x = (Number.isFinite(screenX) ? screenX : 0) + 14
    const y = (Number.isFinite(screenY) ? screenY : 0) + 18
    this.queueDragGhostUpdate(text, x, y)
  }

  /**
   * 生成便签：在新实例中以便签模式打开当前文档
   */
  private async createStickyNote(tabId: string): Promise<void> {
    const tab = this.tabManager.findTabById(tabId)
    if (!tab) return
    if (!tab.filePath) {
      alert('当前标签尚未保存为文件，无法生成便签。\n请先保存到磁盘后再尝试。')
      return
    }
    // 如果有未保存的更改，自动保存
    if (tab.dirty) {
      const saveFn = (window as any)?.flymdSaveFile as (() => Promise<void>) | undefined
      if (typeof saveFn === 'function') {
        try {
          await saveFn()
        } catch (e) {
          console.error('[TabBar] 自动保存失败:', e)
          alert('自动保存失败，无法生成便签。')
          return
        }
      }
    }
    const flymd = (window as any)
    const createFn = flymd?.flymdCreateStickyNote as ((path: string) => Promise<void>) | undefined
    if (typeof createFn !== 'function') {
      alert('当前环境不支持便签功能。')
      return
    }
    try {
      await createFn(tab.filePath)
    } catch (e) {
      console.error('[TabBar] 生成便签失败:', e)
    }
  }

  /**
   * 导出标签内容为 PDF
   */
  private async exportTabToPdf(tabId: string): Promise<void> {
    const tab = this.tabManager.findTabById(tabId)
    if (!tab) return

    try {
      const { exportFileToPdf } = await import('../exporters/pdfContextExport')

      // 从文件路径提取文件名
      let fileName = 'document.md'
      if (tab.filePath) {
        const parts = tab.filePath.replace(/\\/g, '/').split('/')
        fileName = parts[parts.length - 1] || 'document.md'
      }
      const suggestedName = fileName.replace(/\.m(arkdown|d)$/i, '.pdf')

      await exportFileToPdf({
        filePath: tab.filePath || '',
        content: tab.content,
        suggestedName
      })
    } catch (e) {
      console.error('[TabBar] PDF导出失败:', e)
      alert('PDF导出失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  private async renameTabFile(tabId: string): Promise<void> {
    const tab = this.tabManager.findTabById(tabId)
    if (!tab) return
    if (!tab.filePath) {
      alert('当前标签尚未保存为文件，无法重命名。\n请先保存到磁盘后再重命名。')
      return
    }
    const flymd = (window as any)
    const renameFn = flymd?.flymdRenamePathWithDialog as ((path: string) => Promise<string | null>) | undefined
    if (typeof renameFn !== 'function') {
      alert('当前环境不支持从标签栏重命名，请在左侧文件树中重命名。')
      return
    }
    try {
      const dst = await renameFn(tab.filePath)
      if (!dst) return
      this.tabManager.updateTabPath(tabId, dst)
    } catch (e) {
      console.error('[TabBar] 重命名文档失败:', e)
    }
  }

  private showContextMenu(x: number, y: number, tabId: string): void {
    this.ensureContextMenu()
    if (!this.contextMenuEl) return
    this.contextMenuTargetTabId = tabId
    const menu = this.contextMenuEl
    menu.style.visibility = 'hidden'
    menu.style.display = 'flex'
    menu.style.left = '0px'
    menu.style.top = '0px'
    const rect = menu.getBoundingClientRect()
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8)
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.visibility = 'visible'
    this.contextMenuVisible = true
    document.addEventListener('mousedown', this.handleContextMenuOutside, true)
    document.addEventListener('wheel', this.handleContextMenuOutside, true)
    document.addEventListener('scroll', this.handleContextMenuOutside, true)
    window.addEventListener('resize', this.handleContextMenuOutside)
    document.addEventListener('keydown', this.handleContextMenuKeydown, true)
  }

  private hideContextMenu(): void {
    if (!this.contextMenuEl || !this.contextMenuVisible) return
    this.contextMenuEl.style.display = 'none'
    this.contextMenuEl.style.visibility = 'visible'
    this.contextMenuTargetTabId = null
    this.contextMenuVisible = false
    document.removeEventListener('mousedown', this.handleContextMenuOutside, true)
    document.removeEventListener('wheel', this.handleContextMenuOutside, true)
    document.removeEventListener('scroll', this.handleContextMenuOutside, true)
    window.removeEventListener('resize', this.handleContextMenuOutside)
    document.removeEventListener('keydown', this.handleContextMenuKeydown, true)
  }

  /**
   * 更新单个标签（不重新渲染整个列表）
   */
  updateTab(tabId: string): void {
    const tab = this.tabManager.findTabById(tabId)
    if (!tab || !this.tabsContainer) return

    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`)
    if (!tabEl) return

    // 更新 dirty 状态
    tabEl.classList.toggle('dirty', tab.dirty)

    // 更新 dirty 指示器
    let dirtyDot = tabEl.querySelector('.tabbar-tab-dirty')
    if (tab.dirty && !dirtyDot) {
      dirtyDot = document.createElement('span')
      dirtyDot.className = 'tabbar-tab-dirty'
      dirtyDot.textContent = '●'
      tabEl.querySelector('.tabbar-tab-close')?.before(dirtyDot)
    } else if (!tab.dirty && dirtyDot) {
      dirtyDot.remove()
    }

    // 更新名称
    const nameEl = tabEl.querySelector('.tabbar-tab-name')
    if (nameEl) {
      nameEl.textContent = getTabDisplayName(tab)
      ;(nameEl as HTMLElement).title = tab.filePath || getTabDisplayName(tab)
    }
  }

  /**
   * 滚动到当前活跃标签
   */
  scrollToActiveTab(): void {
    if (!this.tabsContainer) return

    const activeTabId = this.tabManager.getActiveTabId()
    if (!activeTabId) return

    const activeEl = this.tabsContainer.querySelector(`[data-tab-id="${activeTabId}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.layoutRaf) {
      window.cancelAnimationFrame(this.layoutRaf)
      this.layoutRaf = 0
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.hideContextMenu()
    // 组件销毁时确保幽灵窗口也销毁（避免 dev 热更新残留）
    void this.destroyDragGhostWindow()
    if (this.contextMenuEl && this.contextMenuEl.parentElement) {
      this.contextMenuEl.parentElement.removeChild(this.contextMenuEl)
    }
    this.contextMenuEl = null
    this.contextMenuTargetTabId = null
    this.contextMenuVisible = false
    this.container.innerHTML = ''
  }
}
