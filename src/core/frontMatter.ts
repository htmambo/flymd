// Markdown Front Matter 剥离(纯字符串,无 js-yaml 依赖)
// splitYamlFrontMatter 抽离自 main.ts:2167-2206。
// 解析元数据的 parseFrontMatterMeta 已迁至 frontMatterMeta.ts(静态依赖 js-yaml),
// 入口 chunk 不得经本文件触达 js-yaml(见 NFR-2)。

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

