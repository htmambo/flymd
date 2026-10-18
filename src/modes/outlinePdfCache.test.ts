// @vitest-environment jsdom
// 测试 _pdfOutlineCache 的 LRU 上限(20):第 21 条写入淘汰第 1 条(最旧插入项)
// 做法:mock pdfjs-dist 走真实 renderPdfOutline 解析路径,
// 用 getDocument 调用次数区分缓存命中(0 次)与未命中(重新解析,1 次)

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getDocumentMock, fakeDoc } = vi.hoisted(() => {
  const getDocumentMock = vi.fn()
  const fakeDoc = {
    numPages: 1,
    getOutline: async () => [{ title: 'Chapter', dest: null, items: [] }],
    getDestination: async () => null,
    getPageIndex: async () => 0,
    destroy: async () => {},
  }
  return { getDocumentMock, fakeDoc }
})

vi.mock('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
}))

import { createOutline } from './outline'

function makePdfOutlineDeps(getPath: () => string) {
  return {
    getCurrentFilePath: getPath,
    getEditor: () => document.createElement('textarea'),
    getWysiwyg: () => false,
    getMode: () => 'edit' as const,
    getPdfIframe: () => null,
    getPdfSrcUrl: () => null,
    getOutlineLayout: () => ({}),
    getOutlineLastSignature: () => '',
    setOutlineLastSignature: () => {},
    shouldUpdateOutlinePanel: () => true,
    syncDetachedOutlineVisibility: () => false,
    notifyWorkspaceLayoutChanged: () => {},
    applyOutlineDockUi: () => {},
    setOutlineHasContent: () => {},
    getOutlineDocked: () => true,
    clearOutlineHeadsCache: () => {},
    ensureOutlineHeadsCacheFromCtx: () => ({ ids: [], tops: [], scrollEl: null, bodyEl: null }),
    cssEscapeCompat: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_'),
    makePreviewHeadingId: (t: string, i: number) => `h-${i}-${t}`,
    readFile: async () => new Uint8Array([1, 2, 3]),
    stat: async () => ({ mtimeMs: 1000 }),
    logDebug: () => {},
    logWarn: () => {},
  }
}

async function renderAndWaitParsed(api: ReturnType<typeof createOutline>, callsBefore: number): Promise<void> {
  api.renderOutlinePanel()
  await vi.waitFor(() => {
    if (getDocumentMock.mock.calls.length <= callsBefore) throw new Error('PDF still parsing')
  })
}

describe('_pdfOutlineCache LRU (max 20)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    getDocumentMock.mockReset()
    getDocumentMock.mockImplementation(() => ({ promise: Promise.resolve(fakeDoc), destroy: async () => {} }))
  })

  it('evicts the oldest entry when the 21st distinct PDF is cached', async () => {
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    let currentPath = ''
    const api = createOutline(makePdfOutlineDeps(() => currentPath))

    const paths = Array.from({ length: 21 }, (_, i) => `/doc-${i}.pdf`)
    for (const p of paths) {
      currentPath = p
      await renderAndWaitParsed(api, getDocumentMock.mock.calls.length)
    }
    // 21 个不同 PDF 各解析一次
    expect(getDocumentMock).toHaveBeenCalledTimes(21)

    // 第 1 条(/doc-0.pdf)已被第 21 条淘汰:再次渲染触发重新解析
    currentPath = paths[0]
    await renderAndWaitParsed(api, getDocumentMock.mock.calls.length)
    expect(getDocumentMock).toHaveBeenCalledTimes(22)

    // 第 21 条(/doc-20.pdf)仍在缓存中:再次渲染命中缓存,不再解析
    currentPath = paths[20]
    const before = getDocumentMock.mock.calls.length
    api.renderOutlinePanel()
    await new Promise(r => setTimeout(r, 100))
    expect(getDocumentMock.mock.calls.length).toBe(before)
    expect(outline.querySelectorAll('.ol-item').length).toBe(1)
  }, 10000)

  it('reuses cached entries without re-parsing (mtime match)', async () => {
    const outline = document.createElement('div')
    outline.id = 'lib-outline'
    document.body.appendChild(outline)
    let currentPath = '/only.pdf'
    const api = createOutline(makePdfOutlineDeps(() => currentPath))

    await renderAndWaitParsed(api, 0)
    expect(getDocumentMock).toHaveBeenCalledTimes(1)

    currentPath = '/other.pdf'
    await renderAndWaitParsed(api, 1)
    expect(getDocumentMock).toHaveBeenCalledTimes(2)

    // 回到第一个文件:缓存命中,不新增解析
    currentPath = '/only.pdf'
    api.renderOutlinePanel()
    await new Promise(r => setTimeout(r, 100))
    expect(getDocumentMock).toHaveBeenCalledTimes(2)
    expect(outline.querySelectorAll('.ol-item').length).toBe(1)
  }, 10000)
})
