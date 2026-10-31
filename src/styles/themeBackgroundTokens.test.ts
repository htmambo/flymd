// @vitest-environment jsdom
// 主题背景令牌审计测试（主题背景收敛任务 · T9）
//
// 目的：把「背景只有两套令牌」从约定变成硬约束，并锁住本次修复的根因。
// 本文件锁四件事：
//   1. `--wysiwyg-bg` 已退役：样式与源码里不得再定义/消费它
//      （唯一允许的是 theme.ts 里那一处 removeProperty 清理语句——清理旧版本残留内联值）；
//   2. 主题面板不再有独立的「所见背景」设置项（data-target="wysiwyg" / i18n key）；
//   3. applyThemePrefs 的日间/夜间分支写入的内联变量键集合完全一致
//      —— 这正是本次 bug 的根因：夜间分支少写/不清，导致日间浅色值残留到夜间；
//   4. 旧配置（含 wysiwygBg 字段）能正常读取并原样回写，不丢用户数据、也不复活变量。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..')
const repoRoot = resolve(srcDir, '..')

/** 已退役的 CSS 变量名。 */
const RETIRED_VAR = '--wysiwyg-bg'
/** 允许出现的唯一清理语句。 */
const RETIRED_CLEANUP = `removeProperty('${RETIRED_VAR}')`

/** 递归收集 src/ 下的所有源码文件（.ts / .tsx / .css）。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const SELF = fileURLToPath(import.meta.url)
/** 本文件自身包含令牌字面量（作为断言目标），扫描时排除。 */
const sourceFiles = collectSourceFiles(srcDir).filter((f) => f !== SELF)

function readIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const themeSource = readIfExists(join(srcDir, 'theme.ts'))
const i18nSource = readIfExists(join(srcDir, 'i18n.ts'))

describe('主题背景令牌：--wysiwyg-bg 已退役', () => {
  it('样式与源码里不再定义或消费该变量', () => {
    const violations: string[] = []
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8')
      const rel = relative(repoRoot, file)
      // 唯一允许：theme.ts 里那一处 removeProperty 清理语句
      if (rel === 'src/theme.ts') {
        const occurrences = src.split(RETIRED_CLEANUP).length - 1
        if (occurrences !== 1) {
          violations.push(`${rel}: removeProperty('${RETIRED_VAR}') 出现 ${occurrences} 次（应为 1 次）`)
        }
        // 清理语句之外不允许再出现令牌字面量（防止注释里藏新的消费点）
        const withoutCleanup = src.split(RETIRED_CLEANUP).join('')
        if (withoutCleanup.includes(RETIRED_VAR)) {
          violations.push(`${rel}: 除清理语句外仍出现 '${RETIRED_VAR}'`)
        }
        continue
      }
      if (src.includes(RETIRED_VAR)) {
        violations.push(`${rel}: 仍引用 '${RETIRED_VAR}'`)
      }
    }
    expect(
      violations,
      '已退役的 --wysiwyg-bg 不应再被定义或消费：\n' + violations.join('\n'),
    ).toEqual([])
  })

  it('主题面板不再提供独立的「所见背景」设置项', () => {
    expect(themeSource).not.toContain('data-target="wysiwyg"')
    expect(themeSource).not.toContain('setProperty(\'--wysiwyg-bg\'')
    expect(themeSource).not.toContain('parchment-wysiwyg-toggle')
    expect(i18nSource).not.toContain('theme.wysiwygBg')
  })

  it('所见模式底色走阅读纸面色 --preview-bg，CM6 源码编辑器走 --bg', () => {
    const editorCss = readIfExists(join(srcDir, 'styles/editor.css'))
    const cm6Css = readIfExists(join(srcDir, 'modes/cm6Editor.css'))
    // 所见容器 = 阅读纸面色
    expect(editorCss).toMatch(/\.container\.wysiwyg-v2\s*\{[^}]*background:\s*var\(--preview-bg\)/)
    // CM6 宿主 / 编辑区 / 行号栏 = 源码底色
    expect(cm6Css).toMatch(/\.cm6-editor-host\s*\{[^}]*background:\s*var\(--bg\)/)
    expect(cm6Css).toMatch(/\.cm6-editor-host \.cm-gutters\s*\{[^}]*background:\s*var\(--bg\)/)
    // 源码行号列必须显式不透明，避免透出祖先底色变成亮色带
    expect(editorCss).toMatch(/\.editor-gutter\s*\{[^}]*background:\s*var\(--bg\)/)
  })
})

describe('applyThemePrefs：日/夜分支写入对称性', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="container"><div class="preview hidden"></div></div>'
    document.body.classList.remove('dark-mode', 'light-mode')
    localStorage.clear()
  })

  it('日间与夜间写入的内联变量键集合完全一致', async () => {
    const { applyThemePrefs } = await import('../theme')
    const container = document.querySelector('.container') as HTMLElement

    const collect = async (dark: boolean): Promise<string[]> => {
      document.body.classList.toggle('dark-mode', dark)
      const keys: string[] = []
      const spy = vi.spyOn(container.style, 'setProperty')
      try {
        applyThemePrefs({
          editBg: '#ffffff',
          readBg: '#fafafa',
          wysiwygBg: '#e9edf5',
          editBgDark: '#0b0c0e',
          readBgDark: '#12100d',
          mdStyle: 'standard',
        })
        for (const call of spy.mock.calls) {
          const key = String(call[0])
          if (!keys.includes(key)) keys.push(key)
        }
      } finally {
        spy.mockRestore()
      }
      return keys.sort()
    }

    const dayKeys = await collect(false)
    const nightKeys = await collect(true)

    expect(dayKeys).toEqual(['--bg', '--preview-bg'])
    expect(nightKeys).toEqual(dayKeys)
  })

  it('切到夜间后不会残留任何浅色纸面色变量', async () => {
    const { applyThemePrefs } = await import('../theme')
    const container = document.querySelector('.container') as HTMLElement
    const prefs = {
      editBg: '#ffffff',
      readBg: '#fafafa',
      wysiwygBg: '#ffffff',
      editBgDark: '#0b0c0e',
      readBgDark: '#12100d',
      mdStyle: 'standard' as const,
    }

    // 模拟旧版本：日间写入过浅色的所见纸面色
    container.style.setProperty('--wysiwyg-bg', '#ffffff')
    document.body.classList.remove('dark-mode')
    applyThemePrefs(prefs)

    // 切夜间
    document.body.classList.add('dark-mode')
    applyThemePrefs(prefs)

    const inline = container.getAttribute('style') || ''
    expect(inline).not.toContain('--wysiwyg-bg')
    expect(inline).not.toContain('#ffffff')
  })

  it('统一背景：--bg 与 --preview-bg 恒等，且以 readBg（纸面色）为锚点', async () => {
    const { applyThemePrefs } = await import('../theme')
    const container = document.querySelector('.container') as HTMLElement
    document.body.classList.remove('dark-mode')

    // editBg 与 readBg 不一致时，生效值取 readBg（归一方向：纸面色）
    applyThemePrefs({
      editBg: '#ffffff',
      readBg: '#fbf5e6',
      wysiwygBg: '#e9edf5',
      editBgDark: '#0b0c0e',
      readBgDark: '#12100d',
      mdStyle: 'standard',
    })

    expect(container.style.getPropertyValue('--bg')).toBe('#fbf5e6')
    expect(container.style.getPropertyValue('--preview-bg')).toBe('#fbf5e6')
    // 两个变量必须恒等 —— 这是「一套设置」的硬不变量
    expect(container.style.getPropertyValue('--bg'))
      .toBe(container.style.getPropertyValue('--preview-bg'))
  })

  it('夜间模式下统一背景取 readBgDark，两个变量同样恒等', async () => {
    const { applyThemePrefs } = await import('../theme')
    const container = document.querySelector('.container') as HTMLElement
    document.body.classList.add('dark-mode')

    applyThemePrefs({
      editBg: '#ffffff',
      readBg: '#fafafa',
      wysiwygBg: '#e9edf5',
      editBgDark: '#0b0c0e',
      readBgDark: '#12100d',
      mdStyle: 'standard',
    })

    expect(container.style.getPropertyValue('--bg')).toBe('#12100d')
    expect(container.style.getPropertyValue('--preview-bg')).toBe('#12100d')
  })
})

describe('旧配置兼容', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = '<div class="container"></div>'
  })

  it('含 wysiwygBg 的旧配置能读取且原样保留（不丢用户数据）', async () => {
    const { loadThemePrefs, saveThemePrefs } = await import('../theme')
    localStorage.setItem('flymd:theme:prefs', JSON.stringify({
      editBg: '#ffffff',
      readBg: '#fbf5e6',
      wysiwygBg: '#e9edf5',
      mdStyle: 'github',
    }))

    const prefs = loadThemePrefs()
    expect(prefs.readBg).toBe('#fbf5e6')
    expect(prefs.wysiwygBg).toBe('#e9edf5')

    // 回写后旧字段仍在 → git revert 后用户的「所见背景」可恢复
    saveThemePrefs(prefs)
    const raw = JSON.parse(localStorage.getItem('flymd:theme:prefs') || '{}')
    expect(raw.wysiwygBg).toBe('#e9edf5')
  })
})
