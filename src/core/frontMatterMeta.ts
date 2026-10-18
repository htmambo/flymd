// Markdown Front Matter 元数据解析
// 抽离自 frontMatter.ts(原 parseFrontMatterMeta):本模块静态依赖 js-yaml,
// 因此独立于纯字符串的 splitYamlFrontMatter 单独成文件——入口 chunk 不得静态触达本模块,
// 需要解析元数据的调用方应在使用点动态 import(见 NFR-2)。

import { load as yamlLoad } from 'js-yaml'

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
