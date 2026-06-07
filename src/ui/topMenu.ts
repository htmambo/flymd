// 顶级菜单下拉(参考库右键菜单的样式,纯 JS 内联样式,避免全局 CSS 入侵)
// 抽离自 main.ts:7315-7416。
// 抽离理由:本块是纯 DOM 驱动的下拉菜单 UI,无 main-local 闭包依赖;
// 内部状态(_topMenuDocHandler)走模块级闭包,符合"单例 UI 控件"语义;
// 通过 registerMenuCloser 注册到全局菜单管理器,作为模块级副作用保留。

import { registerMenuCloser, closeAllMenus } from './menuManager'

export type TopMenuItemSpec = { label: string; accel?: string; action: () => void; disabled?: boolean }

// 顶部下拉菜单:全局文档级点击处理器引用,避免重复绑定与交叉干扰
let _topMenuDocHandler: ((ev: MouseEvent) => void) | null = null

// 顶部菜单关闭函数(供全局菜单管理器调用)
function closeTopMenu(): void {
  const menu = document.getElementById('top-ctx') as HTMLDivElement | null
  if (menu) menu.style.display = 'none'
  if (_topMenuDocHandler) {
    try { document.removeEventListener('click', _topMenuDocHandler) } catch {}
    _topMenuDocHandler = null
  }
}
// 注册到全局菜单管理器
registerMenuCloser('topMenu', closeTopMenu)

/**
 * 在 anchor 元素附近弹出下拉菜单。
 * - 自动关闭其他顶级菜单
 * - 自动定位(右侧优先,空间不足时左侧)
 * - 文档级点击自动关闭
 * - 单例 menu DOM(每次清空内容后填充)
 */
export function showTopMenu(anchor: HTMLElement, items: TopMenuItemSpec[]): void {
  try {
    // 关闭所有其他菜单,确保同时只有一个菜单显示
    closeAllMenus('topMenu')

    let menu = document.getElementById('top-ctx') as HTMLDivElement | null
    if (!menu) {
      menu = document.createElement('div') as HTMLDivElement
      menu.id = 'top-ctx'
      menu.style.position = 'absolute'
      menu.style.zIndex = '9999'
      menu.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fff'
      menu.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#111'
      menu.style.border = '1px solid ' + (getComputedStyle(document.documentElement).getPropertyValue('--border') || '#e5e7eb')
      menu.style.borderRadius = '8px'
      menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)'
      menu.style.minWidth = '200px'
      menu.style.padding = '6px 0'
      menu.addEventListener('click', (e) => e.stopPropagation())
      document.body.appendChild(menu)
    }
    // 切换菜单前移除上一次绑定的文档级点击处理器,防止"打开新菜单时被上一次处理器立刻关闭"
    if (_topMenuDocHandler) {
      try { document.removeEventListener('click', _topMenuDocHandler) } catch {}
      _topMenuDocHandler = null
    }

    const hide = () => {
      if (menu) menu.style.display = 'none'
      if (_topMenuDocHandler) {
        try { document.removeEventListener('click', _topMenuDocHandler) } catch {}
        _topMenuDocHandler = null
      }
    }
    const onDoc = () => hide()
    _topMenuDocHandler = onDoc
    menu.innerHTML = ''
    const mkRow = (spec: TopMenuItemSpec) => {
      const row = document.createElement('div') as HTMLDivElement
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.justifyContent = 'space-between'
      row.style.gap = '16px'
      row.style.padding = '6px 12px'
      row.style.cursor = spec.disabled ? 'not-allowed' : 'pointer'
      const l = document.createElement('span')
      l.textContent = spec.label
      const r = document.createElement('span')
      r.textContent = spec.accel || ''
      r.style.opacity = '0.7'
      row.appendChild(l)
      row.appendChild(r)
      if (!spec.disabled) {
        row.addEventListener('mouseenter', () => row.style.background = 'rgba(127,127,127,0.12)')
        row.addEventListener('mouseleave', () => row.style.background = 'transparent')
        row.addEventListener('click', () => { try { spec.action() } finally { hide() } })
      } else {
        row.style.opacity = '0.5'
      }
      return row
    }
    for (const it of items) menu.appendChild(mkRow(it))

    // 定位:Ribbon 按钮右侧弹出
    const rc = anchor.getBoundingClientRect()
    const menuWidth = menu.offsetWidth || 220
    const menuHeight = menu.offsetHeight || 200
    // 优先右侧弹出,空间不足时左侧弹出
    let left = rc.right + 4
    if (left + menuWidth > window.innerWidth) {
      left = rc.left - menuWidth - 4
    }
    left = Math.max(0, left)
    // 垂直方向与按钮顶部对齐,超出屏幕时上移
    let top = rc.top
    if (top + menuHeight > window.innerHeight - 10) {
      top = window.innerHeight - menuHeight - 10
    }
    top = Math.max(0, top)
    menu.style.left = left + 'px'
    menu.style.top = top + 'px'
    menu.style.display = 'block'
    // 推迟到当前点击事件冒泡结束后再绑定,以避免本次点击导致立刻关闭
    setTimeout(() => { if (_topMenuDocHandler) document.addEventListener('click', _topMenuDocHandler) }, 0)
  } catch {}
}
