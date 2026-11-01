// @vitest-environment jsdom
// 主题面板「背景」统一为单一设置的行为测试
//
// 目的：把「编辑背景 / 阅读背景合并为一套设置」从视觉约定变成硬约束。
// 本文件锁住：
//   1. 面板里**不再有**「界面 / 阅读」分段控件，只有一份色板 / 自定义色 / 应用按钮 / 羊皮开关；
//   2. 锚点唯一化：readBg / readBgDark 是唯一事实源，--bg 与 --preview-bg 恒等；
//   3. 镜像不变量：改一次色，editBg 与 readBg（含暗色对）同时更新；
//   4. 存量分歧归一：锚点取 readBg（纸面色），分歧值备份进 preUnifyBg 且幂等；
//   5. 羊皮风格合并为一个开关：同时挂 parchment-edit / parchment-read，legacy 按并集归一；
//   6. 纯白 → preview-plain；暗色锚点取 readBgDark；
//   7. 悬停预览同时作用于两个变量，离开还原；
//   8. 回归：点色板不误关面板、网络代理「应用」不串味、非法色守卫。

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 本文件的第一个用例会完整构建主题面板，实测就要 1.5s 左右，贴着 vitest 默认
// 的 5s 超时线。整套 82 个测试文件并行跑时（本机实测整套件从 64s 涨到 183s），
// 它就随机报 "Test timed out in 5000ms"，让发版门禁随机失败——与代码改动无关。
// 这里按文件放宽到 30s，只影响超时判定，不放宽任何断言。
// 同类问题见 src/modes/perfBatchH.test.ts。
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..')

const PREF_KEY = 'flymd:theme:prefs'

/** 打开主题面板并完成事件绑定（initThemeUI → 点击 #btn-theme → ensureThemePanelReady）。 */
async function openThemePanel(
  prefs?: Record<string, unknown>,
  opts?: { dark?: boolean },
): Promise<HTMLElement> {
  // theme.ts 有模块级一次性标志（_themeUiBound / _themePanelReady），
  // 每个用例都要一份全新的模块实例，否则第二个用例拿不到重新绑定的监听。
  vi.resetModules()
  localStorage.clear()
  if (prefs) localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  // 面板初始化时会按 flymd:darkmode 同步 body.dark-mode，
  // 所以夜间模式必须通过这个键设置，直接加 class 会被面板回写覆盖。
  if (opts?.dark) localStorage.setItem('flymd:darkmode', 'true')

  document.body.innerHTML = `
    <div class="ribbon"><button id="btn-theme"></button></div>
    <div class="container">
      <div class="preview hidden"></div>
      <div class="editor"><textarea id="editor-textarea"></textarea></div>
    </div>`

  const { initThemeUI, applyThemePrefs, loadThemePrefs } = await import('../theme')
  initThemeUI()
  ;(document.getElementById('btn-theme') as HTMLElement).click()
  // 模拟应用启动时的 applySavedTheme：把当前偏好真正落到 DOM 上
  // （放在面板创建之后 —— 面板初始化会按 flymd:darkmode 同步 body.dark-mode）
  applyThemePrefs(loadThemePrefs())

  const panel = document.getElementById('theme-panel') as HTMLElement | null
  if (!panel) throw new Error('主题面板未创建')
  return panel
}

function savedPrefs(): Record<string, any> {
  return JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
}

function container(): HTMLElement {
  return document.querySelector('.container') as HTMLElement
}

function swatchOf(panel: HTMLElement, color: string): HTMLElement {
  const found = Array.from(panel.querySelectorAll('.theme-swatch'))
    .find(s => s.getAttribute('data-color') === color) as HTMLElement | undefined
  if (!found) throw new Error(`色板里没有 ${color}`)
  return found
}

/** 面板里当前生效的两个 CSS 变量。 */
function cssVars(): { bg: string; previewBg: string } {
  const c = container()
  return {
    bg: c.style.getPropertyValue('--bg'),
    previewBg: c.style.getPropertyValue('--preview-bg'),
  }
}

describe('主题面板：背景统一为单一设置', () => {
  beforeEach(() => {
    document.body.classList.remove('dark-mode', 'light-mode')
    vi.restoreAllMocks()
  })

  it('面板里不再有「界面 / 阅读」分段控件，且无遗留的 target 归属标记', async () => {
    const panel = await openThemePanel()

    // 分段控件整体消失
    expect(panel.querySelectorAll('.theme-bg-segmented')).toHaveLength(0)
    expect(panel.querySelectorAll('.theme-bg-segment-input')).toHaveLength(0)
    expect(panel.querySelectorAll('.theme-bg-segment')).toHaveLength(0)
    expect(panel.querySelectorAll('input[name="theme-bg-target"]')).toHaveLength(0)

    // 三层事实源机制（radio → data-bg-target → data-target）整体移除
    expect((panel.querySelector('.theme-bg-section') as HTMLElement).dataset.bgTarget).toBeUndefined()
    expect((panel.querySelector('.theme-swatches') as HTMLElement).dataset.target).toBeUndefined()
    expect((panel.querySelector('.theme-bg-color-input') as HTMLElement).dataset.target).toBeUndefined()
    expect((panel.querySelector('.theme-bg-apply') as HTMLElement).dataset.target).toBeUndefined()
    // 色板不再带 data-for 归属标记
    expect(panel.querySelector('.theme-swatch')?.getAttribute('data-for')).toBeNull()
  })

  it('背景控件各只有一份', async () => {
    const panel = await openThemePanel()

    expect(panel.querySelectorAll('.theme-bg-section')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-swatches')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-bg-color-input')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-bg-apply')).toHaveLength(1)
    expect(panel.querySelectorAll('#parchment-bg-toggle')).toHaveLength(1)
    expect(panel.querySelectorAll('#grid-bg-toggle')).toHaveLength(1)
  })

  it('网格背景开关不再被禁用（合并后恒可用）', async () => {
    const panel = await openThemePanel()
    const grid = panel.querySelector('#grid-bg-toggle') as HTMLInputElement
    expect(grid.disabled).toBe(false)
    expect((panel.querySelector('.theme-grid-bg-option') as HTMLElement).classList
      .contains('theme-grid-bg-disabled')).toBe(false)
  })

  it('点色板 → editBg 与 readBg 同时更新，两个 CSS 变量同值', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    swatchOf(panel, '#f5f5dc').click()

    const p = savedPrefs()
    expect(p.editBg).toBe('#f5f5dc')
    expect(p.readBg).toBe('#f5f5dc')
    // 镜像不变量：两域恒等
    expect(p.editBg).toBe(p.readBg)

    const vars = cssVars()
    expect(vars.bg).toBe('#f5f5dc')
    expect(vars.previewBg).toBe('#f5f5dc')
  })

  it('暗色模式下点色板 → editBgDark 与 readBgDark 同时更新', async () => {
    // 面板创建时 fillSwatches 就按当时的明暗选色板 → 必须先进入夜间态
    document.body.classList.add('dark-mode')
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fafafa',
      editBgDark: '#0b0c0e', readBgDark: '#12100d',
      mdStyle: 'standard',
    }, { dark: true })
    expect(document.body.classList.contains('dark-mode')).toBe(true)

    swatchOf(panel, '#0e1419').click()

    const p = savedPrefs()
    expect(p.editBgDark).toBe('#0e1419')
    expect(p.readBgDark).toBe('#0e1419')
    // 日间取值不受夜间操作影响
    expect(p.editBg).toBe('#ffffff')
    expect(p.readBg).toBe('#fafafa')

    const vars = cssVars()
    expect(vars.bg).toBe('#0e1419')
    expect(vars.previewBg).toBe('#0e1419')
  })

  it('应用自定义色 → 两域同时更新且颜色被标准化（大写）', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    input.value = '#0abcde'
    ;(panel.querySelector('.theme-bg-apply') as HTMLButtonElement).click()

    const p = savedPrefs()
    expect(p.editBg).toBe('#0ABCDE')
    expect(p.readBg).toBe('#0ABCDE')
    expect(cssVars().bg).toBe('#0ABCDE')
  })

  it('非法自定义色被守卫：不写盘、不生效', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    input.value = 'not-a-color'
    ;(panel.querySelector('.theme-bg-apply') as HTMLButtonElement).click()

    expect(alertSpy).toHaveBeenCalled()
    const p = savedPrefs()
    expect(p.editBg).toBe('#ffffff')
    expect(p.readBg).toBe('#fafafa')
  })

  it('存量分歧（editBg ≠ readBg）→ 锚点取 readBg，--bg 归一到纸面色', async () => {
    await openThemePanel({ editBg: '#101010', readBg: '#fbf5e6', mdStyle: 'standard' })

    const vars = cssVars()
    expect(vars.previewBg).toBe('#fbf5e6')
    // 归一方向：纸面色（readBg）为锚点
    expect(vars.bg).toBe('#fbf5e6')
  })

  it('存量分歧值被备份进 preUnifyBg，且二次保存不覆盖（幂等）', async () => {
    const panel = await openThemePanel({ editBg: '#101010', readBg: '#fbf5e6', mdStyle: 'standard' })

    // 触发一次持久化
    swatchOf(panel, '#f5f5dc').click()

    const first = savedPrefs()
    expect(first.preUnifyBg).toBeTruthy()
    expect(first.preUnifyBg.editBg).toBe('#101010')
    expect(first.preUnifyBg.readBg).toBe('#fbf5e6')

    // 再改一次色：备份不得被覆盖
    swatchOf(panel, '#f7f9fc').click()
    const second = savedPrefs()
    expect(second.preUnifyBg.editBg).toBe('#101010')
    expect(second.preUnifyBg.readBg).toBe('#fbf5e6')
  })

  it('两域本就一致时不产生备份', async () => {
    const panel = await openThemePanel({ editBg: '#fafafa', readBg: '#fafafa', mdStyle: 'standard' })

    swatchOf(panel, '#f5f5dc').click()

    expect(savedPrefs().preUnifyBg).toBeUndefined()
  })

  it('旧版 getCssVar 误捕的暗色默认值被重置回日间默认', async () => {
    // 旧版本在深色系统上把夜间值 #12100d 当成日间默认写进了存储
    await openThemePanel({ editBg: '#12100d', readBg: '#12100d', readBgDark: '#12100d', mdStyle: 'standard' })

    const { loadThemePrefs } = await import('../theme')
    const prefs = loadThemePrefs()
    expect(prefs.readBg).not.toBe('#12100d')
    expect(prefs.readBg).toBe('#fafafa')
  })

  it('备份记录的是归一化**之前**的原始值（恢复语义不被破坏）', async () => {
    // 旧版在深色系统上误捕：readBg 被写成夜间值 #12100d；editBg 仍是旧的日间默认
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#12100d', readBgDark: '#12100d', mdStyle: 'standard',
    })

    // 生效值已按归一规则重置为日间默认
    expect(cssVars().bg).toBe('#fafafa')
    expect(cssVars().previewBg).toBe('#fafafa')

    // 触发一次持久化
    swatchOf(panel, '#f5f5dc').click()

    // 备份里存的是原始值 #12100d，而不是归一后的 #fafafa
    expect(savedPrefs().preUnifyBg?.readBg).toBe('#12100d')
    expect(savedPrefs().preUnifyBg?.editBg).toBe('#ffffff')
  })

  it('持久化数据被污染成非字符串时不抛异常，回退默认值', async () => {
    await openThemePanel()
    const { loadThemePrefs } = await import('../theme')

    localStorage.setItem(PREF_KEY, JSON.stringify({
      editBg: 123, readBg: { nope: true }, editBgDark: [], readBgDark: '   ',
      mdStyle: 'standard',
    }))

    const prefs = loadThemePrefs()
    expect(prefs.editBg).toBe('#fafafa')
    expect(prefs.readBg).toBe('#fafafa')
    expect(prefs.editBgDark).toBe('#12100d')
    expect(prefs.readBgDark).toBe('#12100d')
  })

  it('纯白背景 → 容器挂 preview-plain；换回非纯白则卸载', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#ffffff', mdStyle: 'standard' })
    expect(container().classList.contains('preview-plain')).toBe(true)

    swatchOf(panel, '#f5f5dc').click()
    expect(container().classList.contains('preview-plain')).toBe(false)
  })

  it('羊皮风格：勾选后源码区与阅读区两个类名同时挂载', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#ffffff', mdStyle: 'standard' })

    const toggle = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)

    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(container().classList.contains('parchment-edit')).toBe(true)
    expect(container().classList.contains('parchment-read')).toBe(true)

    const p = savedPrefs()
    expect(p.parchment).toBe(true)
    // 两个旧字段作为镜像输出同步
    expect(p.parchmentEdit).toBe(true)
    expect(p.parchmentRead).toBe(true)

    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(container().classList.contains('parchment-edit')).toBe(false)
    expect(container().classList.contains('parchment-read')).toBe(false)
  })

  it('羊皮风格 legacy 配置按并集归一（任一模式开启过就不算关闭）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#ffffff',
      parchmentEdit: true, parchmentRead: false,
      mdStyle: 'standard',
    })

    const toggle = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    // 并集归一后两个类名都挂上
    expect(container().classList.contains('parchment-edit')).toBe(true)
    expect(container().classList.contains('parchment-read')).toBe(true)
  })

  it('悬停预览同时改两个变量，离开色板区后还原', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    const sw = swatchOf(panel, '#f5f5dc')
    sw.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    let vars = cssVars()
    expect(vars.bg).toBe('#f5f5dc')
    expect(vars.previewBg).toBe('#f5f5dc')

    ;(panel.querySelector('.theme-swatches') as HTMLElement)
      .dispatchEvent(new Event('mouseleave'))

    vars = cssVars()
    expect(vars.bg).toBe('#fafafa')
    expect(vars.previewBg).toBe('#fafafa')
  })

  it('插件路径：只传 editBg 时以锚点（readBg）为准', async () => {
    await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })
    const { applyThemePrefs } = await import('../theme')

    applyThemePrefs({
      editBg: '#123456', readBg: '#fafafa',
      wysiwygBg: '#e9edf5', editBgDark: '#0b0c0e', readBgDark: '#12100d',
      mdStyle: 'standard',
    })

    // 渲染来源是锚点，插件单写 editBg 不改变生效色
    expect(cssVars().bg).toBe('#fafafa')
    expect(cssVars().previewBg).toBe('#fafafa')
  })

  it('回归：点色板不会让面板自己关闭', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    swatchOf(panel, '#f5f5dc').click()

    expect(panel.classList.contains('hidden')).toBe(false)
  })

  it('回归：网络代理的「应用」按钮不会被背景取色逻辑接管', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })

    const proxyBtn = panel.querySelector('#net-proxy-apply') as HTMLButtonElement
    proxyBtn.click()

    // 背景取值未被代理按钮改动
    const p = savedPrefs()
    expect(p.editBg).toBe('#ffffff')
    expect(p.readBg).toBe('#fafafa')
  })

  it('面板打开时自定义色输入框显示当前生效色', async () => {
    const panel = await openThemePanel({ editBg: '#ffffff', readBg: '#fafafa', mdStyle: 'standard' })
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    expect(input.value).toBe('#fafafa')
  })
})

describe('统一背景的静态约束', () => {
  it('i18n 键已收敛：分段键消失，新提示键中英齐备', () => {
    const i18n = readFileSync(join(srcDir, 'i18n.ts'), 'utf8')
    for (const key of ['theme.bg.ui', 'theme.bg.read', 'theme.bg.uiTip', 'theme.bg.readTip']) {
      expect(i18n, `${key} 应已移除`).not.toContain(`'${key}'`)
    }
    expect(i18n).toContain("'theme.bg.tip'")
    // 中英各出现一次
    expect(i18n.split("'theme.bg.tip'").length - 1).toBe(2)
  })

  it('theme.ts 里不再残留分段控件相关标识', () => {
    const theme = readFileSync(join(srcDir, 'theme.ts'), 'utf8')
    for (const token of ['theme-bg-segment', 'theme-bg-target', 'bgTarget', 'syncBgControls', 'flushColorDraft']) {
      expect(theme, `${token} 应已移除`).not.toContain(token)
    }
  })

  it('主题面板 CSS 不含 :has() 且已删除分段控件样式', () => {
    const css = readFileSync(join(srcDir, 'styles/theme-panel.css'), 'utf8')
    expect(css).not.toContain(':has(')
    expect(css).not.toContain('.theme-bg-segment')
    expect(css).not.toContain('theme-grid-bg-disabled')
  })

  it('默认背景色与 base.css 的 --preview-bg 字面量一致（防止两边漂移）', () => {
    const theme = readFileSync(join(srcDir, 'theme.ts'), 'utf8')
    const baseCss = readFileSync(join(srcDir, 'styles/base.css'), 'utf8')

    const dayMatch = theme.match(/const DAY_BG_DEFAULT = '(#[0-9a-fA-F]{6})'/)
    expect(dayMatch, 'theme.ts 应定义 DAY_BG_DEFAULT').toBeTruthy()
    const nightMatch = theme.match(/const NIGHT_BG_DEFAULT = '(#[0-9a-fA-F]{6})'/)
    expect(nightMatch, 'theme.ts 应定义 NIGHT_BG_DEFAULT').toBeTruthy()

    // base.css 里 --preview-bg 的日间 / 夜间字面量
    const light = baseCss.match(/--preview-bg:\s*(#[0-9a-fA-F]{6});/)?.[1]
    const dark = baseCss.match(/--preview-bg:\s*(#[0-9a-fA-F]{6});/g)?.map(s => s.split(':')[1].trim().replace(';', ''))
    expect(light).toBe(dayMatch![1])
    expect(dark).toContain(nightMatch![1])
  })
})
