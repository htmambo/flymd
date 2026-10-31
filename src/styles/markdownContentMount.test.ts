// 共享内容根挂载不变量测试（所见/阅读模式样式统一任务 · T7）
//
// 背景
//   两模式共用同一套排版规则，锚点是中性语义类 md-content：
//     - 阅读模式：#preview > .preview-body.md-content
//     - 所见模式：#md-wysiwyg-root > .milkdown > .ProseMirror.md-content
//   一旦某个入口忘了挂这个类，该入口就会静默退回浏览器默认样式——
//   而且 styles/styleScopeAudit.test.ts 仍然全绿（CSS 作用域没错，只是没人命中）。
//
// 本文件锁两件事：
//   1. 所见模式的 ProseMirror 插件真的提供 class=md-content（行为级断言）；
//   2. 阅读 / 虚拟化预览 / 导出 三个入口的正文根类名都带 md-content（源码级断言）。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentRootClassPlugin } from '../wysiwyg/v2/plugins/contentRootClass'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8')
}

describe('共享内容根 md-content 的挂载不变量', () => {
  it('所见模式插件给 ProseMirror 根注入 class=md-content', () => {
    const attrs = contentRootClassPlugin.props.attributes as Record<string, string>
    expect(attrs.class).toBe('md-content')
  })

  it('所见模式把插件注册进 prose 插件列表', () => {
    const src = read('src/wysiwyg/v2/index.ts')
    expect(src).toContain('contentRootClassPlugin')
    // 注册必须落在 prosePluginsCtx 上（编辑器视图选项会被 editLock 整体覆写）
    expect(src).toMatch(/prosePluginsCtx[\s\S]{0,200}contentRootClassPlugin/)
  })

  it('阅读模式正文根带 md-content', () => {
    const src = read('src/main.ts')
    expect(src).toMatch(/className\s*=\s*['"][^'"]*\bmd-content\b[^'"]*['"]/)
  })

  it('虚拟化预览正文根带 md-content', () => {
    const src = read('src/core/virtualPreview.ts')
    expect(src).toMatch(/className\s*=\s*['"][^'"]*\bmd-content\b[^'"]*['"]/)
  })

  it('导出（PDF 上下文）正文根带 md-content', () => {
    const src = read('src/exporters/pdfContextExport.ts')
    expect(src).toMatch(/className\s*=\s*['"][^'"]*\bmd-content\b[^'"]*['"]/)
  })

  it('共享排版层只以 .md-content 为作用域（不混用模式专属类）', () => {
    // 注释里会提到 .preview 作为历史说明，断言只看声明部分
    const css = read('src/styles/markdown-content.css').replace(/\/\*[\s\S]*?\*\//g, '')
    // 共享层里不应出现 .preview / .ProseMirror：出现即意味着又写了一份模式专属规则
    expect(css).not.toMatch(/\.preview(?![\w-])/)
    expect(css).not.toMatch(/\.ProseMirror/)
    // 也不应出现裸元素级规则（会污染共享层之外的 DOM）
    expect(css).not.toMatch(/^\s*(h[1-6]|p|ul|ol|li|a|img|hr|pre|code|table|th|td|blockquote)\s*\{/m)
  })
})
