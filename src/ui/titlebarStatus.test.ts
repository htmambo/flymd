// @vitest-environment jsdom
// 测试 titlebarStatus:覆盖 8 个状态镜像函数的核心路径 + last*Label 缓存命中
// 关注点:
// 1) refreshTitle: 文件名 + dirty 标记 + tooltip + OS title + 大纲更新
// 2) refreshTitle 缓存: 同一 label 不重复写 textContent
// 3) refreshStatus: 行/列/字数(无 fastInfo 走回退)
// 4) refreshStatus: fastInfo 优先
// 5) syncToggleButton: 模式切换按钮文字
// 6) setUpdateBadge: on/off + tip 写入
// 7) getScrollPercent / setScrollPercent: 三模式分派(edit/preview/wysiwyg)
// 8) save + restore: 缓存读写,restore 重试机制

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTitlebarStatus } from './titlebarStatus'

beforeEach(() => {
  document.body.innerHTML = ''
  document.title = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

function makeDeps(overrides: any = {}) {
  const filenameLabel = overrides.filenameLabel ?? document.createElement('div')
  const status = overrides.status ?? document.createElement('div')
  const editor = overrides.editor ?? (() => {
    const ta = document.createElement('textarea')
    ta.id = 'editor'
    ta.value = ''
    document.body.appendChild(ta)
    return ta
  })()
  const preview = overrides.preview ?? (() => {
    const d = document.createElement('div')
    d.id = 'preview'
    document.body.appendChild(d)
    return d
  })()
  if (!overrides.filenameLabel) document.body.appendChild(filenameLabel)
  if (!overrides.status) document.body.appendChild(status)

  return {
    getCurrentFilePath: overrides.getCurrentFilePath ?? (() => null),
    getDirty: overrides.getDirty ?? (() => false),
    filenameLabel,
    status,
    editor,
    preview,
    getMode: overrides.getMode ?? (() => 'edit' as 'edit' | 'preview'),
    getWysiwyg: overrides.getWysiwyg ?? (() => false),
    getLastScrollPercent: overrides.getLastScrollPercent ?? (() => 0),
    setLastScrollPercent: overrides.setLastScrollPercent ?? (() => {}),
    flymdGetSourceEditorPositionInfo: overrides.flymdGetSourceEditorPositionInfo,
    getCurrentWindow: overrides.getCurrentWindow,
    t: overrides.t ?? ((k: string) => k),
    fmtStatus: overrides.fmtStatus ?? ((row: number, col: number) => `行${row},列${col}`),
    scheduleOutlineUpdate: overrides.scheduleOutlineUpdate,
  }
}

describe('refreshTitle', () => {
  beforeEach(() => { document.title = '' })

  it('renders file name + dirty marker in DOM title and label', () => {
    const deps = makeDeps({ getCurrentFilePath: () => '/path/to/note.md', getDirty: () => true })
    const api = createTitlebarStatus(deps)
    api.refreshTitle()
    expect(deps.filenameLabel.textContent).toBe('note.md *')
    expect(document.title).toBe('note.md *')
    expect(deps.filenameLabel.title).toBe('/path/to/note.md')
  })

  it('falls back to "untitled" when no current file', () => {
    const deps = makeDeps({ t: (k: string) => (k === 'filename.untitled' ? '未命名' : k) })
    const api = createTitlebarStatus(deps)
    api.refreshTitle()
    expect(deps.filenameLabel.textContent).toBe('未命名')
    expect(document.title).toBe('未命名')
  })

  it('uses basename even on windows paths', () => {
    const deps = makeDeps({ getCurrentFilePath: () => 'C:\\Users\\me\\doc.md' })
    const api = createTitlebarStatus(deps)
    api.refreshTitle()
    expect(deps.filenameLabel.textContent).toBe('doc.md')
  })

  it('caches last label and skips re-write when unchanged', () => {
    const deps = makeDeps({ getCurrentFilePath: () => '/a.md' })
    const api = createTitlebarStatus(deps)
    const setSpy = vi.spyOn(deps.filenameLabel, 'textContent', 'set')
    api.refreshTitle()
    api.refreshTitle()
    api.refreshTitle()
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('updates OS window title via getCurrentWindow().setTitle', async () => {
    const setTitle = vi.fn(async () => undefined)
    const deps = makeDeps({ getCurrentFilePath: () => '/x.md', getCurrentWindow: () => ({ setTitle }) })
    const api = createTitlebarStatus(deps)
    api.refreshTitle()
    await Promise.resolve()
    expect(setTitle).toHaveBeenCalledWith('x.md - 飞速MarkDown')
  })

  it('triggers scheduleOutlineUpdate on each call', () => {
    const outline = vi.fn()
    const deps = makeDeps({ scheduleOutlineUpdate: outline })
    const api = createTitlebarStatus(deps)
    api.refreshTitle()
    expect(outline).toHaveBeenCalledTimes(1)
  })
})

describe('refreshStatus', () => {
  it('uses fastInfo when available', () => {
    const ed = document.createElement('textarea')
    ed.value = 'hello'
    document.body.appendChild(ed)
    const deps = makeDeps({
      editor: ed,
      flymdGetSourceEditorPositionInfo: () => ({ row: 3, col: 7, chars: 42 }),
    })
    const api = createTitlebarStatus(deps)
    api.refreshStatus()
    expect(deps.status.textContent).toBe('行3,列7, 字 42')
  })

  it('falls back to textarea.slice walk when no fastInfo', () => {
    const ed = document.createElement('textarea')
    ed.value = 'hello'
    ed.selectionStart = 2 // at 'l' in "hello"
    document.body.appendChild(ed)
    const deps = makeDeps({ editor: ed })
    const api = createTitlebarStatus(deps)
    api.refreshStatus()
    // 'he' is one line, 2 chars; col = length + 1 = 3
    expect(deps.status.textContent).toBe('行1,列3, 字 5')
  })
})

describe('syncToggleButton', () => {
  it('shows preview label in edit mode', () => {
    const btn = document.createElement('button')
    btn.id = 'btn-toggle'
    document.body.appendChild(btn)
    const deps = makeDeps({ getMode: () => 'edit' })
    const api = createTitlebarStatus(deps)
    api.syncToggleButton()
    expect(btn.textContent).toBe('预览')
  })

  it('shows edit label in preview mode', () => {
    const btn = document.createElement('button')
    btn.id = 'btn-toggle'
    document.body.appendChild(btn)
    const deps = makeDeps({ getMode: () => 'preview' })
    const api = createTitlebarStatus(deps)
    api.syncToggleButton()
    expect(btn.textContent).toBe('编辑')
  })

  it('does nothing when button is missing', () => {
    const deps = makeDeps()
    const api = createTitlebarStatus(deps)
    expect(() => api.syncToggleButton()).not.toThrow()
  })
})

describe('setUpdateBadge', () => {
  it('adds has-update class + sets title when on=true', () => {
    const btn = document.createElement('div')
    btn.id = 'btn-update'
    document.body.appendChild(btn)
    const api = createTitlebarStatus(makeDeps())
    api.setUpdateBadge(true, 'v1.2.3')
    expect(btn.classList.contains('has-update')).toBe(true)
    expect(btn.title).toBe('v1.2.3')
  })

  it('removes has-update when on=false', () => {
    const btn = document.createElement('div')
    btn.id = 'btn-update'
    document.body.appendChild(btn)
    const api = createTitlebarStatus(makeDeps())
    api.setUpdateBadge(true)
    expect(btn.classList.contains('has-update')).toBe(true)
    api.setUpdateBadge(false)
    expect(btn.classList.contains('has-update')).toBe(false)
  })
})

describe('getScrollPercent / setScrollPercent', () => {
  it('reads from editor in edit mode', () => {
    const ed = document.createElement('textarea')
    Object.defineProperty(ed, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(ed, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(ed, 'scrollTop', { value: 250, configurable: true, writable: true })
    document.body.appendChild(ed)
    const api = createTitlebarStatus(makeDeps({ editor: ed }))
    expect(api.getScrollPercent()).toBe(0.5)
  })

  it('reads from preview in preview mode', () => {
    const pv = document.createElement('div')
    Object.defineProperty(pv, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(pv, 'clientHeight', { value: 1000, configurable: true })
    Object.defineProperty(pv, 'scrollTop', { value: 250, configurable: true, writable: true })
    document.body.appendChild(pv)
    const api = createTitlebarStatus(makeDeps({ getMode: () => 'preview', preview: pv }))
    expect(api.getScrollPercent()).toBe(0.25)
  })

  it('reads from #md-wysiwyg-root .scrollView in wysiwyg mode', () => {
    const root = document.createElement('div')
    root.id = 'md-wysiwyg-root'
    const sv = document.createElement('div')
    sv.className = 'scrollView'
    Object.defineProperty(sv, 'scrollHeight', { value: 800, configurable: true })
    Object.defineProperty(sv, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(sv, 'scrollTop', { value: 200, configurable: true, writable: true })
    root.appendChild(sv)
    document.body.appendChild(root)
    const api = createTitlebarStatus(makeDeps({ getWysiwyg: () => true }))
    expect(api.getScrollPercent()).toBe(0.5)
  })

  it('writes to editor in edit mode and clamps to [0,1]', () => {
    const ed = document.createElement('textarea')
    Object.defineProperty(ed, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(ed, 'clientHeight', { value: 500, configurable: true })
    let written = 0
    Object.defineProperty(ed, 'scrollTop', { get: () => written, set: (v) => { written = v } })
    document.body.appendChild(ed)
    const api = createTitlebarStatus(makeDeps({ editor: ed }))
    api.setScrollPercent(2)  // over 1 → clamp to 1
    expect(written).toBe(500)
    api.setScrollPercent(-1) // below 0 → clamp to 0
    expect(written).toBe(0)
  })

  it('returns 0 when container is not scrollable', () => {
    const ed = document.createElement('textarea')
    Object.defineProperty(ed, 'scrollHeight', { value: 100, configurable: true })
    Object.defineProperty(ed, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(ed, 'scrollTop', { value: 0, configurable: true, writable: true })
    document.body.appendChild(ed)
    const api = createTitlebarStatus(makeDeps({ editor: ed }))
    expect(api.getScrollPercent()).toBe(0)
  })
})

describe('saveScrollPosition / restoreScrollPosition', () => {
  it('saves current percent via setter', () => {
    const ed = document.createElement('textarea')
    Object.defineProperty(ed, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(ed, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(ed, 'scrollTop', { value: 250, configurable: true, writable: true })
    document.body.appendChild(ed)
    const setLast = vi.fn()
    const api = createTitlebarStatus(makeDeps({ editor: ed, setLastScrollPercent: setLast }))
    api.saveScrollPosition()
    expect(setLast).toHaveBeenCalledWith(0.5)
  })

  it('restores from cached value', () => {
    const ed = document.createElement('textarea')
    Object.defineProperty(ed, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(ed, 'clientHeight', { value: 500, configurable: true })
    let written = 0
    Object.defineProperty(ed, 'scrollTop', { get: () => written, set: (v) => { written = v } })
    document.body.appendChild(ed)
    const api = createTitlebarStatus(makeDeps({ editor: ed, getLastScrollPercent: () => 0.7 }))
    api.restoreScrollPosition(0)
    expect(written).toBe(350) // 0.7 * 500
  })
})
