// Markdown Front Matter 解析
// 抽离自 main.ts:2167-2206(splitYamlFrontMatter) + 2220-2232(parseFrontMatterMeta)。
// 之所以独立成 core 模块:这俩是纯文本解析,无 main.ts 闭包依赖;
// 插件运行时已暴露 splitYamlFrontMatter(见 main.ts:11285),所以本文件对外可被 main 直接 re-export,
// 保持 plugin API 表面不变。

import { load as yamlLoad } from 'js-yaml'

/**
 * 把 Markdown 文档开头的 YAML front matter(`--- ... ---`)剥出来。
 * - 只识别以 `﻿?---\n` 开头、且在文档更靠后的行又出现 `---` 的块
 * - 至少有一行像 `key: value` 才认定为 YAML,否则整体视为正文
 * - 头块前保留 BOM 给正文,头块后空行自动剥除
 */
export function splitYamlFrontMatter(raw: string): { frontMatter: string | null; body: string } {
  try {
    if (!raw) return { frontMatter: null, body: '' }
    let text = String(raw)
    let bom = ''
    if (text.charCodeAt(0) === 0xfeff) {
      bom = '﻿'
      text = text.slice(1)
    }
    const lines = text.split('\n')
    if (lines.length < 3) return { frontMatter: null, body: raw }
    if (lines[0].trim() !== '---') return { frontMatter: null, body: raw }
    let end = -1
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { end = i; break }
    }
    if (end < 0) return { frontMatter: null, body: raw }
    let looksYaml = false
    for (let i = 1; i < end; i++) {
      const s = lines[i].trim()
      if (!s || s.startsWith('#')) continue
      if (/^[A-Za-z0-9_.-]+\s*:/.test(s)) { looksYaml = true; break }
    }
    if (!looksYaml) return { frontMatter: null, body: raw }
    const fmLines = lines.slice(0, end + 1)
    const bodyLines = lines.slice(end + 1)
    let fmText = fmLines.join('\n')
    let bodyText = bodyLines.join('\n')
    bodyText = bodyText.replace(/^\r?\n/, '')
    if (bom) bodyText = bom + bodyText
    if (!fmText.endsWith('\n')) fmText += '\n'
    return { frontMatter: fmText, body: bodyText }
  } catch {
    return { frontMatter: null, body: raw }
  }
}

/**
 * 把 splitYamlFrontMatter 拿到的 fmText 进一步解析为对象。
 * 失败/非对象返回 null,而不是抛错——调用方多为预览元数据注入,失败应静默降级。
 */
export function parseFrontMatterMeta(fm: string | null): any | null {
  if (!fm) return null
  try {
    let s = String(fm)
    s = s.replace(/^﻿?---\s*\r?\n?/, '')
    s = s.replace(/\r?\n---\s*$/, '')
    const doc = yamlLoad(s)
    if (!doc || typeof doc !== 'object') return null
    return doc
  } catch {
    return null
  }
}
