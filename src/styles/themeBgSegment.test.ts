// @vitest-environment jsdom
// 主题面板「背景」区合并行为测试（界面 / 阅读 分段，共用一套控件）
//
// 目的：把「两个背景区合并为一块、但两个取值域各自独立」从视觉约定变成硬约束。
// 本文件锁住五件事：
//   1. 面板里背景相关控件各只有一份（色板 / 自定义色 / 应用按钮 / 羊皮纸开关）；
//   2. 分段控件恰有两个（界面 / 阅读），默认选中「界面」；
//   3. 切换分段时，共用控件的归属（data-target / data-for / 勾选态 / 禁用态）
//      全部跟随目标，不残留上一目标的状态；
//   4. **两条写入路径互不干扰**（最关键）：切段后点色板 / 应用自定义色，
//      必须写到对应字段与对应 CSS 变量，另一个取值域不被污染；
//   5. 网络代理的「应用」按钮不会被背景取色逻辑接管（共用 .theme-apply-btn
//      时的串味回归）。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..')

const PREF_KEY = 'flymd:theme:prefs'

/** 打开主题面板并完成事件绑定（initThemeUI → 点击 #btn-theme → ensureThemePanelReady）。 */
async function openThemePanel(prefs?: Record<string, unknown>): Promise<HTMLElement> {
  // theme.ts 有模块级一次性标志（_themeUiBound / _themePanelReady），
  // 每个用例都要一份全新的模块实例，否则第二个用例拿不到重新绑定的监听。
  vi.resetModules()
  localStorage.clear()
  if (prefs) localStorage.setItem(PREF_KEY, JSON.stringify(prefs))

  document.body.innerHTML = `
    <div class="ribbon"><button id="btn-theme"></button></div>
    <div class="container">
      <div class="preview hidden"></div>
      <div class="editor"><textarea id="editor-textarea"></textarea></div>
    </div>`

  const { initThemeUI } = await import('../theme')
  initThemeUI()
  ;(document.getElementById('btn-theme') as HTMLElement).click()

  const panel = document.getElementById('theme-panel') as HTMLElement | null
  if (!panel) throw new Error('主题面板未创建')
  return panel
}

function segment(panel: HTMLElement, value: 'edit' | 'read'): HTMLInputElement {
  return panel.querySelector(`.theme-bg-segment-input[value="${value}"]`) as HTMLInputElement
}

function switchTo(panel: HTMLElement, value: 'edit' | 'read'): void {
  const input = segment(panel, value)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function prefs(): Record<string, any> {
  return JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
}

function swatchOf(panel: HTMLElement, color: string): HTMLElement {
  const found = Array.from(panel.querySelectorAll('.theme-swatch'))
    .find(s => s.getAttribute('data-color') === color) as HTMLElement | undefined
  if (!found) throw new Error(`色板里没有 ${color}`)
  return found
}

describe('主题面板：背景区合并为一块', () => {
  beforeEach(() => {
    document.body.classList.remove('dark-mode', 'light-mode')
  })

  it('背景控件各只有一份，旧的拆分 id 不再存在', async () => {
    const panel = await openThemePanel()

    expect(panel.querySelectorAll('.theme-bg-section')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-swatches')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-bg-color-input')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-bg-apply')).toHaveLength(1)
    expect(panel.querySelectorAll('#parchment-bg-toggle')).toHaveLength(1)

    // 合并前的三套 id 不得残留
    for (const oldId of [
      'parchment-edit-toggle', 'parchment-read-toggle',
      'custom-color-edit', 'custom-color-read',
    ]) {
      expect(panel.querySelector(`#${oldId}`), `${oldId} 应已消失`).toBeNull()
    }
  })

  it('分段控件恰有两个，默认选中「界面」', async () => {
    const panel = await openThemePanel()

    const segs = Array.from(panel.querySelectorAll('.theme-bg-segment-input')) as HTMLInputElement[]
    expect(segs).toHaveLength(2)
    expect(segs.map(s => s.value)).toEqual(['edit', 'read'])
    expect(segs[0].checked).toBe(true)
    expect(segs[1].checked).toBe(false)

    // 两个分段共用同一个 radio name（原生分组 → 键盘方向键可切换）
    expect(segs[0].name).toBe(segs[1].name)

    expect((panel.querySelector('.theme-swatches') as HTMLElement).dataset.target).toBe('edit')
  })

  it('切到「阅读」后：控件归属与勾选态全部跟随目标', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6',
      parchmentEdit: true, parchmentRead: false, mdStyle: 'standard',
    })

    const swatches = panel.querySelector('.theme-swatches') as HTMLElement
    const colorInput = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    const applyBtn = panel.querySelector('.theme-bg-apply') as HTMLButtonElement
    const parchment = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement
    const grid = panel.querySelector('#grid-bg-toggle') as HTMLInputElement

    // 初始（界面段）
    expect(swatches.dataset.target).toBe('edit')
    expect(colorInput.dataset.target).toBe('edit')
    expect(applyBtn.dataset.target).toBe('edit')
    expect(parchment.checked).toBe(true)
    expect(grid.disabled).toBe(false)

    switchTo(panel, 'read')

    expect(swatches.dataset.target).toBe('read')
    expect(colorInput.dataset.target).toBe('read')
    expect(applyBtn.dataset.target).toBe('read')
    // 色板重绘后 data-for 也换成 read
    expect(swatches.querySelector('.theme-swatch')!.getAttribute('data-for')).toBe('read')
    // 输入框显示「阅读」目标当前生效色，不残留界面的值
    expect(colorInput.value).toBe('#fbf5e6')
    // 羊皮纸勾选态取 parchmentRead
    expect(parchment.checked).toBe(false)
    // 网格背景只对源码模式生效 → 阅读段禁用
    expect(grid.disabled).toBe(true)

    // 切回界面段：全部复原
    switchTo(panel, 'edit')
    expect(swatches.dataset.target).toBe('edit')
    expect(colorInput.dataset.target).toBe('edit')
    expect(colorInput.value).toBe('#ffffff')
    expect(parchment.checked).toBe(true)
    expect(grid.disabled).toBe(false)
  })

  it('色板高亮随目标切换（按目标各自的当前值计算）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const swatches = panel.querySelector('.theme-swatches') as HTMLElement

    expect(swatches.querySelector('.theme-swatch.active')!.getAttribute('data-color')).toBe('#ffffff')

    switchTo(panel, 'read')
    expect(swatches.querySelector('.theme-swatch.active')!.getAttribute('data-color')).toBe('#fbf5e6')
  })

  it('切到「阅读」段点色板 → 写 --preview-bg / readBg，且不污染 editBg / --bg', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const container = document.querySelector('.container') as HTMLElement

    switchTo(panel, 'read')
    swatchOf(panel, '#f5f5dc').dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const saved = prefs()
    expect(saved.readBg).toBe('#f5f5dc')
    expect(saved.editBg).toBe('#ffffff')

    expect(container.style.getPropertyValue('--preview-bg')).toBe('#f5f5dc')
    expect(container.style.getPropertyValue('--bg')).toBe('#ffffff')
  })

  it('在「阅读」段应用自定义色 → 写 readBg；界面段同理写 editBg', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })

    switchTo(panel, 'read')
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    input.value = '#123456'
    ;(panel.querySelector('.theme-bg-apply') as HTMLButtonElement).click()

    expect(prefs().readBg).toBe('#123456')
    expect(prefs().editBg).toBe('#ffffff')

    // 切回界面段再应用 → 写 editBg，不动 readBg
    switchTo(panel, 'edit')
    const input2 = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    expect(input2.value).toBe('#ffffff')
    input2.value = '#654321'
    ;(panel.querySelector('.theme-bg-apply') as HTMLButtonElement).click()

    expect(prefs().editBg).toBe('#654321')
    expect(prefs().readBg).toBe('#123456')
  })

  it('羊皮风格开关按当前分段写入对应字段', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6',
      parchmentEdit: false, parchmentRead: false, mdStyle: 'standard',
    })
    const parchment = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement

    // 界面段勾上 → parchmentEdit
    parchment.checked = true
    parchment.dispatchEvent(new Event('change', { bubbles: true }))
    expect(prefs().parchmentEdit).toBe(true)
    expect(prefs().parchmentRead).toBe(false)

    // 切到阅读段 → 勾选态取 parchmentRead
    switchTo(panel, 'read')
    expect(parchment.checked).toBe(false)

    parchment.checked = true
    parchment.dispatchEvent(new Event('change', { bubbles: true }))
    const saved = prefs()
    expect(saved.parchmentRead).toBe(true)
    expect(saved.parchmentEdit).toBe(true)
  })

  it('羊皮纸偏好能被读回（否则勾选态每次复位、.parchment-* 类从未生效）', async () => {
    await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6',
      parchmentEdit: true, parchmentRead: false, mdStyle: 'standard',
    })
    const { loadThemePrefs } = await import('../theme')
    const loaded = loadThemePrefs()
    expect(loaded.parchmentEdit).toBe(true)
    expect(loaded.parchmentRead).toBe(false)
  })

  it('网络代理的「应用」按钮不会被背景取色逻辑接管', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const netBtn = panel.querySelector('#net-proxy-apply') as HTMLButtonElement
    expect(netBtn).toBeTruthy()

    // 背景输入框里有值时，点网络代理的「应用」也不该动背景色
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    input.value = '#abcdef'
    netBtn.click()

    const saved = prefs()
    expect(saved.editBg).toBe('#ffffff')
    expect(saved.readBg).toBe('#fbf5e6')
  })
})

describe('主题面板：背景区的边界行为', () => {
  beforeEach(() => {
    document.body.classList.remove('dark-mode', 'light-mode')
  })

  it('切段前自动把未应用的自定义色草稿落到它原本所在的目标', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement

    // 界面段敲了一个还没点「应用」的颜色
    input.value = '#0abcde'
    switchTo(panel, 'read')

    // 草稿被自动应用到「界面」目标，没有丢、也没有误落到「阅读」
    // （normalizeHexColor 会把 hex 统一转大写，与「应用」按钮行为一致）
    const saved = prefs()
    expect(saved.editBg).toBe('#0ABCDE')
    expect(saved.readBg).toBe('#fbf5e6')

    // 切回界面段看到的是已保存的新值
    switchTo(panel, 'edit')
    expect((panel.querySelector('.theme-bg-color-input') as HTMLInputElement).value).toBe('#0ABCDE')
  })

  it('非法草稿在切段时被丢弃（本就无从应用）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    input.value = 'zzz' // 非法 hex：无从应用
    switchTo(panel, 'read')

    const saved = prefs()
    expect(saved.editBg).toBe('#ffffff')
    expect(saved.readBg).toBe('#fbf5e6')
  })

  it('非法自定义色点「应用」不写入任何字段', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    try {
      const panel = await openThemePanel({
        editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
      })
      const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
      input.value = 'not-a-color'
      ;(panel.querySelector('.theme-bg-apply') as HTMLButtonElement).click()

      const saved = prefs()
      expect(saved.editBg).toBe('#ffffff')
      expect(saved.readBg).toBe('#fbf5e6')
      expect(alertSpy).toHaveBeenCalled()
    } finally {
      alertSpy.mockRestore()
    }
  })

  it('悬停预览色在切段时被还原（不残留到新目标）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const container = document.querySelector('.container') as HTMLElement

    // 悬停某个色板 → 预览色写进 --bg
    const sw = swatchOf(panel, '#f5f5dc')
    sw.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(container.style.getPropertyValue('--bg')).toBe('#f5f5dc')

    // 切段 → 预览还原
    switchTo(panel, 'read')
    expect(container.style.getPropertyValue('--bg')).toBe('#ffffff')
    expect(container.style.getPropertyValue('--preview-bg')).toBe('#fbf5e6')
  })

  it('点色板后面板不会被误判成「点击外部」而关闭', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    expect(panel.classList.contains('hidden')).toBe(false)

    swatchOf(panel, '#f5f5dc').dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // 回归：色板点击后 fillSwatches 若重建 DOM，被点中的节点会脱离文档树，
    // document 的「点击外部关闭」处理器就找不到 #theme-panel 祖先 → 面板被误关。
    expect(panel.classList.contains('hidden')).toBe(false)
    expect(prefs().editBg).toBe('#f5f5dc')
  })

  it('自定义色输入框始终显示当前生效色（不残留旧值）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    expect(input.value).toBe('#ffffff')

    // 点色板 → 输入框跟着变
    swatchOf(panel, '#f5f5dc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(input.value).toBe('#f5f5dc')

    // 切段 → 输入框显示另一段的色
    switchTo(panel, 'read')
    expect(input.value).toBe('#fbf5e6')

    // 切回 → 又是界面的色
    switchTo(panel, 'edit')
    expect(input.value).toBe('#f5f5dc')
  })

  it('夜间模式下输入框显示暗色变体（切夜间/切日间都跟随）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6',
      editBgDark: '#0b0c0e', readBgDark: '#12100d', mdStyle: 'standard',
    })
    const input = panel.querySelector('.theme-bg-color-input') as HTMLInputElement
    const darkToggle = panel.querySelector('#dark-mode-toggle') as HTMLInputElement

    expect(input.value).toBe('#ffffff')

    // 打开夜间模式 → 输入框改显暗色变体
    darkToggle.checked = true
    darkToggle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(input.value).toBe('#0b0c0e')

    // 关掉夜间 → 回到亮色变体
    darkToggle.checked = false
    darkToggle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(input.value).toBe('#ffffff')
  })

  it('分段 radio 与共用控件的 data-target 始终一致（单一事实源不变量）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const check = () => {
      const checked = panel.querySelector('.theme-bg-segment-input:checked') as HTMLInputElement
      const target = checked.value
      // 事实源：容器上的 data-bg-target
      expect((panel.querySelector('.theme-bg-section') as HTMLElement).dataset.bgTarget).toBe(target)
      // 派生：各控件的 data-target 必须与事实源一致
      expect((panel.querySelector('.theme-swatches') as HTMLElement).dataset.target).toBe(target)
      expect((panel.querySelector('.theme-bg-color-input') as HTMLElement).dataset.target).toBe(target)
      expect((panel.querySelector('.theme-bg-apply') as HTMLElement).dataset.target).toBe(target)
      // 控件内部渲染出的色板归属也一致
      expect(panel.querySelector('.theme-swatch')!.getAttribute('data-for')).toBe(target)
    }
    check()
    switchTo(panel, 'read')
    check()
    switchTo(panel, 'edit')
    check()
  })

  it('改色后预览还原到新值（lastSaved 随写路径同步）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    const container = document.querySelector('.container') as HTMLElement

    // 点色板改「界面」目标色
    swatchOf(panel, '#f5f5dc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(container.style.getPropertyValue('--bg')).toBe('#f5f5dc')

    // 悬停另一个色 → 预览；移开 → 必须还原到**刚存下的新值**，而不是旧值
    swatchOf(panel, '#f7f9fc').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(container.style.getPropertyValue('--bg')).toBe('#f7f9fc')
    ;(panel.querySelector('.theme-swatches') as HTMLElement)
      .dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    expect(container.style.getPropertyValue('--bg')).toBe('#f5f5dc')
  })

  it('二次打开面板不重建、不重复绑定', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard',
    })
    // 再点一次主题按钮 → 面板应复用而非重建
    ;(document.getElementById('btn-theme') as HTMLElement).click()
    expect(document.querySelectorAll('#theme-panel')).toHaveLength(1)
    expect(panel.querySelectorAll('.theme-bg-segment-input')).toHaveLength(2)
    expect(panel.querySelectorAll('.theme-swatches')).toHaveLength(1)

    // 功能仍正常（没有因重复绑定而错乱）
    switchTo(panel, 'read')
    expect((panel.querySelector('.theme-swatches') as HTMLElement).dataset.target).toBe('read')
  })

  it('隐藏的 radio 仍可聚焦（不能用 display:none 把它踢出 Tab 序）', async () => {
    const css = readFileSync(join(srcDir, 'styles/theme-panel.css'), 'utf8')
    const rule = css.slice(css.indexOf('.theme-bg-segment-input {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).not.toContain('display: none')
    expect(body).not.toContain('display:none')

    const panel = await openThemePanel()
    const segs = Array.from(panel.querySelectorAll('.theme-bg-segment-input')) as HTMLInputElement[]
    for (const seg of segs) {
      expect(seg.tabIndex).toBeGreaterThanOrEqual(0)
    }
  })

  it('羊皮纸与背景色是叠加关系（纹理叠在底色上，不互相覆盖）', async () => {
    const panel = await openThemePanel({
      editBg: '#ffffff', readBg: '#fbf5e6',
      parchmentEdit: false, parchmentRead: false, mdStyle: 'standard',
    })
    const container = document.querySelector('.container') as HTMLElement

    const parchment = panel.querySelector('#parchment-bg-toggle') as HTMLInputElement
    parchment.checked = true
    parchment.dispatchEvent(new Event('change', { bubbles: true }))

    // 容器拿到羊皮纸类
    expect(container.classList.contains('parchment-edit')).toBe(true)
    // 背景色没被清掉
    expect(container.style.getPropertyValue('--bg')).toBe('#ffffff')

    // CSS 事实：羊皮纸规则只设 background-image（叠加层），不动 background-color
    const css = readFileSync(join(srcDir, 'styles/theme-panel.css'), 'utf8')
    const rule = css.slice(css.indexOf('.container.parchment-edit .editor'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('background-image')
    expect(body).not.toContain('background-color')
  })

  it('羊皮纸字段缺失时默认关闭（不因读回修复而误开启）', async () => {
    await openThemePanel({ editBg: '#ffffff', readBg: '#fbf5e6', mdStyle: 'standard' })
    const { loadThemePrefs } = await import('../theme')
    const loaded = loadThemePrefs()
    expect(loaded.parchmentEdit).toBeUndefined()
    expect(loaded.parchmentRead).toBeUndefined()
    expect(!!loaded.parchmentEdit).toBe(false)
    expect(!!loaded.parchmentRead).toBe(false)
  })
})

describe('i18n：背景区文案正名', () => {
  const i18nSource = readFileSync(join(srcDir, 'i18n.ts'), 'utf8')
  const themeSource = readFileSync(join(srcDir, 'theme.ts'), 'utf8')

  it('旧的两个标题 key 已移除，新 key 中英双语齐备', () => {
    expect(i18nSource).not.toContain("'theme.editBg'")
    expect(i18nSource).not.toContain("'theme.readBg'")
    expect(themeSource).not.toContain("t('theme.editBg')")
    expect(themeSource).not.toContain("t('theme.readBg')")

    for (const key of ['theme.bgSection', 'theme.bg.ui', 'theme.bg.read']) {
      expect(i18nSource, `缺少 ${key}`).toContain(`'${key}'`)
    }
    // 中英文各一份
    expect(i18nSource.match(/'theme\.bgSection'/g)).toHaveLength(2)
    expect(i18nSource.match(/'theme\.bg\.ui'/g)).toHaveLength(2)
    expect(i18nSource.match(/'theme\.bg\.read'/g)).toHaveLength(2)
  })

  it('分段控件的 CSS 不依赖 :has() 选择器', () => {
    const css = readFileSync(join(srcDir, 'styles/theme-panel.css'), 'utf8')
    // 去掉注释再检查：注释里提到 :has() 是说明文字，不是选择器
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const segmentBlock = withoutComments.slice(withoutComments.indexOf('.theme-bg-segmented'))
    expect(segmentBlock).not.toContain(':has(')
  })
})
