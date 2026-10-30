// 预览 DOM 增强段测试（perf 批次 G）
//
// 覆盖：
// - enhancePreviewLinks：页内锚点 / 本地文档链接去 target/rel；外链补 _blank + noopener noreferrer
// - enhancePreviewImages：非打印补 loading=lazy；本地图片 → data-abs-path/data-raw-src →
//   convertFileSrc 资产 URL；错误两级回退（同目录 images/ 重映射 → data: URL）
// - mimeFromImagePath 扩展名映射
//
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tauri 运行时 API 打桩：convertFileSrc 可控、fs 走模块默认（测试内以依赖形态不可注入，
// 与原 main.ts 实现一致——回退链的 exists/readFile 直连 plugin-fs，这里 mock 模块）
const tauriStubs = vi.hoisted(() => ({
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
  exists: vi.fn(async (p: string) => false),
  readFile: vi.fn(async (p: string) => new Uint8Array([1, 2, 3])),
}))

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const orig: any = await importOriginal()
  return { ...orig, convertFileSrc: tauriStubs.convertFileSrc }
})
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: tauriStubs.exists,
  readFile: tauriStubs.readFile,
  readTextFile: vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => undefined),
  stat: vi.fn(async () => { throw new Error('no') }),
}))

import { enhancePreviewLinks, enhancePreviewImages, mimeFromImagePath } from './previewDomEnhance'

function el(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

beforeEach(() => {
  tauriStubs.convertFileSrc.mockClear()
  tauriStubs.exists.mockClear()
  tauriStubs.readFile.mockClear()
})

describe('enhancePreviewLinks', () => {
  it('页内锚点与本地文档链接：去 target/rel；外链补 _blank + noopener noreferrer', () => {
    const root = el(`
      <a id="hash" href="#section" target="_blank" rel="noopener">锚点</a>
      <a id="local" href="./sub/other.md" target="_blank" rel="noopener">本地文档</a>
      <a id="ext" href="https://example.com/page">外链</a>
    `)
    enhancePreviewLinks(root, { currentFilePath: '/lib/doc.md' })
    const hash = root.querySelector('#hash') as HTMLAnchorElement
    const local = root.querySelector('#local') as HTMLAnchorElement
    const ext = root.querySelector('#ext') as HTMLAnchorElement
    expect(hash.hasAttribute('target')).toBe(false)
    expect(hash.hasAttribute('rel')).toBe(false)
    expect(local.hasAttribute('target')).toBe(false)
    expect(local.hasAttribute('rel')).toBe(false)
    expect(ext.target).toBe('_blank')
    expect(ext.rel).toBe('noopener noreferrer')
  })

  it('无 target/rel 的外链同样补齐', () => {
    const root = el(`<a href="https://example.com/x">外链</a>`)
    enhancePreviewLinks(root, {})
    const a = root.querySelector('a') as HTMLAnchorElement
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener noreferrer')
  })
})

describe('mimeFromImagePath', () => {
  it('常见扩展名映射与未知扩展回落', () => {
    expect(mimeFromImagePath('/a/b.PNG')).toBe('image/png')
    expect(mimeFromImagePath('/a/b.JPG')).toBe('image/jpeg')
    expect(mimeFromImagePath('/a/b.jpeg')).toBe('image/jpeg')
    expect(mimeFromImagePath('/a/b.svg')).toBe('image/svg+xml')
    expect(mimeFromImagePath('/a/b.ico')).toBe('image/x-icon')
    expect(mimeFromImagePath('/a/b.tiff')).toBe('application/octet-stream')
    expect(mimeFromImagePath('')).toBe('application/octet-stream')
  })
})

describe('enhancePreviewImages', () => {
  it('本地图片：懒加载属性 + data-abs-path/data-raw-src + 资产 URL', () => {
    const root = el(`<img src="images/pic.png">`)
    enhancePreviewImages(root, { currentFilePath: '/lib/doc.md' })
    const img = root.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.hasAttribute('data-abs-path')).toBe(true)
    expect(img.getAttribute('data-raw-src')).toBe('images/pic.png')
    expect(img.src).toContain('asset://')
  })

  it('forPrint 不补懒加载；已有 loading 属性不动', () => {
    const root = el(`<img src="images/a.png"><img id="b" src="images/b.png" loading="eager">`)
    enhancePreviewImages(root, { currentFilePath: '/lib/doc.md', forPrint: true })
    expect(root.querySelector('img')!.hasAttribute('loading')).toBe(false)
    const b = root.querySelector('#b') as HTMLImageElement
    expect(b.getAttribute('loading')).toBe('eager')
  })

  it('非本地图片（如远程 URL）不写 data-* 也不转换', () => {
    const root = el(`<img src="https://example.com/remote.png">`)
    enhancePreviewImages(root, { currentFilePath: '/lib/doc.md' })
    const img = root.querySelector('img') as HTMLImageElement
    expect(img.hasAttribute('data-abs-path')).toBe(false)
    expect(img.getAttribute('loading')).toBe('lazy') // 懒加载仍适用
    expect(img.src).toBe('https://example.com/remote.png')
  })

  it('加载失败 → 同目录 images/ 重映射成功 → 二次失败 → data: URL 兜底', async () => {
    const root = el(`<img src="images/pic.png">`)
    const img = root.querySelector('img') as HTMLImageElement
    enhancePreviewImages(root, { currentFilePath: '/lib/docs/doc.md' })
    expect(img.src).toContain('asset://')
    // 触发第一次加载失败：guessSyncedDocImageAbsPath（真实模块）把路径映射到
    // /lib/docs/images/pic.png，exists 桩返回 true → 换新资产 URL
    tauriStubs.exists.mockResolvedValue(true)
    img.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(img.src).not.toBe('')) // 等异步 onError 推进
    await vi.waitFor(() => expect(img.getAttribute('data-abs-path')).toContain('images'))
    const remappedSrc = img.src
    expect(remappedSrc).toContain('asset://')
    // 第二次失败：exists 桩对同一映射不再放行（triedRemap 已置位直接跳过）→ data: URL
    img.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(img.src.startsWith('data:')).toBe(true))
    expect(tauriStubs.readFile).toHaveBeenCalled()
  })

  it('onImageRendered 回调：load 事件触发一次（jsdom 下 complete 恒 false，走监听路径）', async () => {
    const root = el(`<img src="images/x.png">`)
    const onImageRendered = vi.fn()
    const img = root.querySelector('img') as HTMLImageElement
    enhancePreviewImages(root, { currentFilePath: '/lib/doc.md', onImageRendered })
    img.dispatchEvent(new Event('load'))
    await new Promise((r) => setTimeout(r, 10))
    expect(onImageRendered).toHaveBeenCalledTimes(1)
    // once 语义：二次 load 不再触发
    img.dispatchEvent(new Event('load'))
    await new Promise((r) => setTimeout(r, 10))
    expect(onImageRendered).toHaveBeenCalledTimes(1)
  })
})
