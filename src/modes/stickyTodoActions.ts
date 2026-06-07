// 便签模式 todo 按钮(推送 + 提醒)+ 持久化标记
// 抽离自 main.ts:6175-6346。
// 抽离理由:3 个函数构成完整的"便签待办交互"子系统,共享 main-local 引用
// (preview / currentFilePath / stickyNoteReminders / pluginHost / pluginNotice),
// 全部用 getter/setter 注入;DOM 改造(querySelectorAll li.task-list-item)在
// 工厂内部封装,不挂全局事件。

import type { StickyNoteColor, StickyNoteReminderMap } from './stickyNote'

export type { StickyNoteReminderMap }

export interface StickyTodoActionsDeps {
  /** 预览容器(查询 li.task-list-item) */
  getPreview: () => HTMLElement
  /** 当前文件路径(可能 null) */
  getCurrentFilePath: () => string | null
  /** 提醒状态 getter */
  getReminders: () => StickyNoteReminderMap
  /** 提醒状态 setter */
  setReminders: (m: StickyNoteReminderMap) => void
  /** 持久化(opacity/color/reminders) */
  savePrefs: (prefs: { opacity: number; color: StickyNoteColor; reminders: StickyNoteReminderMap }) => Promise<void>
  /** 透明度(写提醒时用) */
  getOpacity: () => number
  /** 颜色(写提醒时用) */
  getColor: () => StickyNoteColor
  /** 插件宿主:取 xxtui-todo-push API */
  getPluginAPI: (id: string) => any
  /** 插件通知(与 main.ts pluginNotice 签名一致) */
  pluginNotice: (msg: string, level?: 'ok' | 'err', ms?: number) => void
  /** 弹窗告警(原生 alert 包装) */
  alert: (msg: string) => void
}

export interface StickyTodoActionsApi {
  /** 为预览中所有 li.task-list-item 注入 推送/提醒 按钮 + 时间图标 + tooltip */
  addStickyTodoButtons: () => void
  /** 单条 todo 推送到 xxtui */
  handleStickyTodoPush: (todoText: string, index: number) => Promise<void>
  /** 单条 todo 创建提醒(时间从 @YYYY-MM-DD HH:MM 解析) */
  handleStickyTodoReminder: (todoText: string, index: number, btn?: HTMLButtonElement) => Promise<void>
}

const TIME_PATTERN = /@\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?/

export function createStickyTodoActions(deps: StickyTodoActionsDeps): StickyTodoActionsApi {
  function addStickyTodoButtons(): void {
    try {
      const preview = deps.getPreview()
      const taskItems = preview.querySelectorAll('li.task-list-item') as NodeListOf<HTMLLIElement>
      if (!taskItems || taskItems.length === 0) return
      const fileKey = deps.getCurrentFilePath() || ''

      taskItems.forEach((item, index) => {
        // 避免重复添加按钮
        if (item.querySelector('.sticky-todo-actions')) return

        // 获取复选框
        const checkbox = item.querySelector('input.task-list-item-checkbox') as HTMLInputElement | null

        // 获取原始完整文本(包含时间)
        const fullText = item.textContent?.trim() || ''

        // 提取时间信息
        const timeMatch = fullText.match(TIME_PATTERN)
        const datetimeText = timeMatch ? timeMatch[0] : ''
        const textWithoutTime = datetimeText ? fullText.replace(TIME_PATTERN, '').trim() : fullText

        // 重构 DOM 结构
        try {
          const childNodes = Array.from(item.childNodes)
          childNodes.forEach(node => {
            if (node !== checkbox) node.remove()
          })
          const contentDiv = document.createElement('span')
          contentDiv.className = 'task-content'
          contentDiv.textContent = textWithoutTime
          item.appendChild(contentDiv)
          if (datetimeText) {
            const timeIcon = document.createElement('span')
            timeIcon.className = 'task-time-icon'
            timeIcon.textContent = '🕐'
            item.appendChild(timeIcon)
          }
        } catch (e) {
          console.error('[便签模式] 重构DOM失败:', e)
        }

        // 按钮容器
        const actionsDiv = document.createElement('span')
        actionsDiv.className = 'sticky-todo-actions'

        // 推送按钮
        const pushBtn = document.createElement('button')
        pushBtn.className = 'sticky-todo-btn sticky-todo-push-btn'
        pushBtn.title = '推送到 xxtui'
        pushBtn.innerHTML = '📤'
        pushBtn.addEventListener('click', async (e) => {
          e.stopPropagation()
          await handleStickyTodoPush(fullText, index)
        })

        // 提醒按钮(若有持久化标记,显示"已创建")
        const reminderBtn = document.createElement('button')
        reminderBtn.className = 'sticky-todo-btn sticky-todo-reminder-btn'
        const hasReminder = !!(fileKey && deps.getReminders()[fileKey] && deps.getReminders()[fileKey][fullText])
        if (hasReminder) {
          reminderBtn.title = '已创建提醒'
          reminderBtn.innerHTML = '🔔'
          reminderBtn.classList.add('sticky-todo-reminder-created')
        } else {
          reminderBtn.title = '创建提醒 (@时间)'
          reminderBtn.innerHTML = '⏰'
        }
        reminderBtn.addEventListener('click', async (e) => {
          e.stopPropagation()
          await handleStickyTodoReminder(fullText, index, reminderBtn)
        })

        actionsDiv.appendChild(pushBtn)
        actionsDiv.appendChild(reminderBtn)
        item.appendChild(actionsDiv)

        // tooltip 显示完整内容
        try {
          const tooltip = document.createElement('div')
          tooltip.className = 'task-tooltip'
          tooltip.textContent = datetimeText ? `${textWithoutTime} ${datetimeText}` : textWithoutTime
          item.appendChild(tooltip)
        } catch (e) {
          console.error('[便签模式] 创建tooltip失败:', e)
        }
      })
    } catch (e) {
      console.error('[便签模式] 添加待办按钮失败:', e)
    }
  }

  async function handleStickyTodoPush(todoText: string, _index: number): Promise<void> {
    try {
      const api = deps.getPluginAPI('xxtui-todo-push')
      if (!api || !api.pushToXxtui) {
        deps.alert('xxtui 插件未安装或未启用\n\n请在"插件"菜单中启用 xxtui 插件')
        return
      }
      const success = await api.pushToXxtui('[TODO]', todoText)
      if (success) {
        deps.pluginNotice('推送成功', 'ok', 2000)
      } else {
        deps.alert('推送失败，请检查 xxtui 配置\n\n请在"插件"菜单 → "待办" → "设置"中配置 API Key')
      }
    } catch (e) {
      console.error('[便签模式] 推送失败:', e)
      deps.alert('推送失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleStickyTodoReminder(todoText: string, _index: number, btn?: HTMLButtonElement): Promise<void> {
    try {
      const api = deps.getPluginAPI('xxtui-todo-push')
      if (!api || !api.parseAndCreateReminders) {
        deps.alert('xxtui 插件未安装或未启用\n\n请在"插件"菜单中启用 xxtui 插件')
        return
      }
      const todoMarkdown = `- [ ] ${todoText}`
      const result = await api.parseAndCreateReminders(todoMarkdown)
      if (result.success > 0) {
        deps.pluginNotice(`创建提醒成功：${result.success} 条`, 'ok', 2000)
        try {
          if (btn) {
            btn.innerHTML = '🔔'
            btn.title = '已创建提醒'
            btn.classList.add('sticky-todo-reminder-created')
          }
          const fileKey = deps.getCurrentFilePath() || ''
          if (fileKey) {
            const next = { ...deps.getReminders() }
            if (!next[fileKey]) next[fileKey] = {}
            next[fileKey][todoText] = true
            deps.setReminders(next)
            await deps.savePrefs({ opacity: deps.getOpacity(), color: deps.getColor(), reminders: next })
          }
        } catch {}
      } else if (!todoText.includes('@')) {
        deps.alert('请在待办内容中添加 @时间 格式，例如：\n\n• 开会 @明天 下午3点\n• 写周报 @2025-11-21 09:00\n• 打电话 @2小时后')
      } else {
        deps.alert('创建提醒失败，请检查时间格式')
      }
    } catch (e) {
      console.error('[便签模式] 创建提醒失败:', e)
      deps.alert('创建提醒失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return {
    addStickyTodoButtons,
    handleStickyTodoPush,
    handleStickyTodoReminder,
  }
}
