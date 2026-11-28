// 样式基线完整性审计：确保 scripts/style-parity/baseline.json 覆盖全部主题 × 明暗组合，
// 且每个组合都含全部比对元素的指纹。校验页运行时会读取该文件做回归比对，
// 文件若缺主题/缺元素/结构损坏，回归会静默失效——这里把它变成硬失败。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const baselinePath = join(repoRoot, 'scripts/style-parity/baseline.json')
const parityJsPath = join(repoRoot, 'scripts/style-parity/parity.js')

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
  version: number
  themes: Record<string, Record<string, Record<string, string>>>
}
const parity = readFileSync(parityJsPath, 'utf8')

function captureAll(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re)).map((m) => m[1])
}

describe('style parity baseline', () => {
  it('baseline 版本为 2 且 themes 非空', () => {
    expect(baseline.version).toBe(2)
    expect(Object.keys(baseline.themes).length).toBeGreaterThan(0)
  })

  it('THEMES 列表中每个主题都有 light / dark 两套指纹', () => {
    // parity.js: const THEMES = [ '', 'md-github', ... ] —— 空串映射到 '(default)'
    const block = parity.match(/const THEMES\s*=\s*\[([\s\S]*?)\]/)?.[1] || ''
    const themes = captureAll(block, /'([^']*)'/g).map((t) => t || '(default)')
    expect(themes.length).toBeGreaterThanOrEqual(5)
    for (const theme of themes) {
      expect(baseline.themes[theme], `主题 ${theme} 缺失`).toBeDefined()
      for (const mode of ['light', 'dark']) {
        expect(baseline.themes[theme][mode], `${theme}/${mode} 缺失`).toBeDefined()
      }
    }
  })

  it('每个 theme/mode 的指纹覆盖 parity.js 中的全部 ELEMENTS', () => {
    const block = parity.match(/const ELEMENTS\s*=\s*\[([\s\S]*?)\]/)?.[1] || ''
    const elements = captureAll(block, /'([^']+)'/g)
    expect(elements.length).toBeGreaterThan(0)
    for (const [theme, modes] of Object.entries(baseline.themes)) {
      for (const [mode, digest] of Object.entries(modes)) {
        for (const el of elements) {
          expect(Object.prototype.hasOwnProperty.call(digest, el), `${theme}/${mode} 缺元素 ${el}`).toBe(true)
        }
      }
    }
  })

  it('指纹为 8 位十六进制或 null，不含空串', () => {
    for (const [theme, modes] of Object.entries(baseline.themes)) {
      for (const [mode, digest] of Object.entries(modes)) {
        for (const [el, hash] of Object.entries(digest)) {
          expect(hash, `${theme}/${mode}/${el}`).toMatch(/^(null|[0-9a-f]{8})$/)
        }
      }
    }
  })
})
