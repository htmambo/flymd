// @vitest-environment jsdom
// 测试 stickyTodoActions:覆盖 addStickyTodoButtons 的 DOM 改造 + push/reminder 行为
// 关注点:
// 1) addStickyTodoButtons: querySelectorAll li.task-list-item,跳过已装饰的
// 2) DOM 改造: 保留 checkbox + 加 task-content span + 时间图标 + actions 容器
// 3) 时间解析: @YYYY-MM-DD HH:MM 提取并显示
// 4) 提醒按钮: 已有 reminders 标记 → 显示🔔+class,否则显示⏰
// 5) handleStickyTodoPush: 缺插件 → alert;成功 → notice
// 6) handleStickyTodoReminder: 缺插件 → alert;成功 → 更新 reminders + savePrefs
// 7) handleStickyTodoReminder: 无 @时间 → alert 提示加 @时间

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStickyTodoActions } from './stickyTodoActions'

function makePreview(liCount: number, texts: string[]) {
  const preview = document.createElement('div')
  for (let i = 0; i < liCount; i++) {
    const li = document.createElement('li')
    li.className = 'task-list-item'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'task-list-item-checkbox'
    li.appendChild(cb)
    li.appendChild(document.createTextNode(texts[i] || `todo ${i}`))
    preview.appendChild(li)
  }
  document.body.appendChild(preview)
  return preview
}

function makeDeps(overrides: any = {}) {
  return {
    getPreview: overrides.getPreview ?? (() => document.createElement('div')),
    getCurrentFilePath: overrides.getCurrentFilePath ?? (() => '/a.md'),
    getReminders: overrides.getReminders ?? (() => ({})),
    setReminders: overrides.setReminders ?? (() => {}),
    savePrefs: overrides.savePrefs ?? (async () => {}),
    getOpacity: overrides.getOpacity ?? (() => 0.9),
    getColor: overrides.getColor ?? (() => '#fff'),
    getPluginAPI: overrides.getPluginAPI ?? (() => null),
    pluginNotice: overrides.pluginNotice ?? (() => {}),
    alert: overrides.alert ?? (() => {}),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('addStickyTodoButtons', () => {
  it('does nothing when no task items', () => {
    const preview = document.createElement('div')
    document.body.appendChild(preview)
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    expect(() => api.addStickyTodoButtons()).not.toThrow()
  })

  it('injects actions div into each task item', () => {
    const preview = makePreview(2, ['buy milk', 'write report'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    const items = preview.querySelectorAll('li.task-list-item')
    expect(items.length).toBe(2)
    expect(items[0].querySelector('.sticky-todo-actions')).toBeTruthy()
    expect(items[1].querySelector('.sticky-todo-actions')).toBeTruthy()
  })

  it('preserves checkbox and creates task-content span', () => {
    const preview = makePreview(1, ['hello'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    const li = preview.querySelector('li.task-list-item')!
    expect(li.querySelector('input.task-list-item-checkbox')).toBeTruthy()
    expect(li.querySelector('span.task-content')?.textContent).toBe('hello')
  })

  it('extracts @datetime and adds time icon', () => {
    const preview = makePreview(1, ['meeting @2025-12-01 14:30 details'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    const li = preview.querySelector('li.task-list-item')!
    expect(li.querySelector('span.task-time-icon')?.textContent).toBe('🕐')
    expect(li.querySelector('span.task-content')?.textContent).toBe('meeting  details')
  })

  it('omits time icon when no @datetime present', () => {
    const preview = makePreview(1, ['no time here'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    expect(preview.querySelector('.task-time-icon')).toBeNull()
  })

  it('shows reminder as created when already in reminders map', () => {
    const preview = makePreview(1, ['saved item'])
    const reminders = { '/a.md': { 'saved item': true } }
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview, getReminders: () => reminders }))
    api.addStickyTodoButtons()
    const btn = preview.querySelector('.sticky-todo-reminder-btn') as HTMLButtonElement
    expect(btn.innerHTML).toBe('🔔')
    expect(btn.classList.contains('sticky-todo-reminder-created')).toBe(true)
    expect(btn.title).toBe('已创建提醒')
  })

  it('shows empty alarm when not yet reminded', () => {
    const preview = makePreview(1, ['fresh item'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    const btn = preview.querySelector('.sticky-todo-reminder-btn') as HTMLButtonElement
    expect(btn.innerHTML).toBe('⏰')
    expect(btn.classList.contains('sticky-todo-reminder-created')).toBe(false)
  })

  it('is idempotent — skips items that already have actions', () => {
    const preview = makePreview(1, ['once'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    api.addStickyTodoButtons()
    api.addStickyTodoButtons()
    expect(preview.querySelectorAll('.sticky-todo-actions').length).toBe(1)
  })

  it('adds tooltip with full text including time', () => {
    const preview = makePreview(1, ['task @2025-11-21 09:00'])
    const api = createStickyTodoActions(makeDeps({ getPreview: () => preview }))
    api.addStickyTodoButtons()
    const tooltip = preview.querySelector('.task-tooltip')
    expect(tooltip?.textContent).toBe('task @2025-11-21 09:00')
  })
})

describe('handleStickyTodoPush', () => {
  it('alerts when plugin not installed', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({ getPluginAPI: () => null, alert }))
    await api.handleStickyTodoPush('text', 0)
    expect(alert).toHaveBeenCalledWith('xxtui 插件未安装或未启用\n\n请在"插件"菜单中启用 xxtui 插件')
  })

  it('alerts when plugin API missing pushToXxtui', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({ getPluginAPI: () => ({}), alert }))
    await api.handleStickyTodoPush('text', 0)
    expect(alert).toHaveBeenCalledWith('xxtui 插件未安装或未启用\n\n请在"插件"菜单中启用 xxtui 插件')
  })

  it('notices success on pushToXxtui=true', async () => {
    const notice = vi.fn()
    const pushToXxtui = vi.fn(async () => true)
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ pushToXxtui }),
      pluginNotice: notice,
    }))
    await api.handleStickyTodoPush('do thing', 0)
    expect(pushToXxtui).toHaveBeenCalledWith('[TODO]', 'do thing')
    expect(notice).toHaveBeenCalledWith('推送成功', 'ok', 2000)
  })

  it('alerts when pushToXxtui returns false', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ pushToXxtui: async () => false }),
      alert,
    }))
    await api.handleStickyTodoPush('text', 0)
    expect(alert).toHaveBeenCalledWith('推送失败，请检查 xxtui 配置\n\n请在"插件"菜单 → "待办" → "设置"中配置 API Key')
  })

  it('alerts with full-width punctuation when pushToXxtui throws', async () => {
    const alert = vi.fn()
    const pushToXxtui = vi.fn(async () => { throw new Error('boom') })
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ pushToXxtui }),
      alert,
    }))
    await api.handleStickyTodoPush('text', 0)
    expect(alert).toHaveBeenCalledWith('推送失败：boom')
  })
})

describe('handleStickyTodoReminder', () => {
  it('alerts when plugin missing', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({ getPluginAPI: () => null, alert }))
    await api.handleStickyTodoReminder('text', 0)
    expect(alert).toHaveBeenCalledWith('xxtui 插件未安装或未启用\n\n请在"插件"菜单中启用 xxtui 插件')
  })

  it('updates reminder state + saves prefs on success', async () => {
    const setReminders = vi.fn()
    const savePrefs = vi.fn(async () => {})
    const btn = document.createElement('button')
    const parseAndCreateReminders = vi.fn(async (md: string) => ({ success: 1 }))
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ parseAndCreateReminders }),
      setReminders,
      savePrefs,
    }))
    await api.handleStickyTodoReminder('task @2025-12-01 14:30', 0, btn)
    expect(parseAndCreateReminders).toHaveBeenCalledWith('- [ ] task @2025-12-01 14:30')
    expect(setReminders).toHaveBeenCalled()
    const next = setReminders.mock.calls[0][0]
    expect(next['/a.md']['task @2025-12-01 14:30']).toBe(true)
    expect(savePrefs).toHaveBeenCalledWith(expect.objectContaining({ reminders: next }))
    expect(btn.innerHTML).toBe('🔔')
    expect(btn.title).toBe('已创建提醒')
    expect(btn.classList.contains('sticky-todo-reminder-created')).toBe(true)
  })

  it('alerts to add @time when result=0 and no @ in text', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ parseAndCreateReminders: async () => ({ success: 0 }) }),
      alert,
    }))
    await api.handleStickyTodoReminder('plain task', 0)
    expect(alert).toHaveBeenCalledWith('请在待办内容中添加 @时间 格式，例如：\n\n• 开会 @明天 下午3点\n• 写周报 @2025-11-21 09:00\n• 打电话 @2小时后')
  })

  it('alerts about bad format when @ present but parseAndCreateReminders returns 0', async () => {
    const alert = vi.fn()
    const api = createStickyTodoActions(makeDeps({
      getPluginAPI: () => ({ parseAndCreateReminders: async () => ({ success: 0 }) }),
      alert,
    }))
    await api.handleStickyTodoReminder('task @badformat', 0)
    expect(alert).toHaveBeenCalledWith('创建提醒失败，请检查时间格式')
  })

  it('skips persistence when no current file path', async () => {
    const setReminders = vi.fn()
    const savePrefs = vi.fn(async () => {})
    const api = createStickyTodoActions(makeDeps({
      getCurrentFilePath: () => null,
      getPluginAPI: () => ({ parseAndCreateReminders: async () => ({ success: 1 }) }),
      setReminders,
      savePrefs,
    }))
    await api.handleStickyTodoReminder('task @2025-12-01 14:30', 0)
    expect(setReminders).not.toHaveBeenCalled()
    expect(savePrefs).not.toHaveBeenCalled()
  })
})
