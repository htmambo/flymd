// 预览 DOM 增强段（perf 批次 G / P0-7 路线第二步）
//
// 抽离自 main.ts renderPreview 尾部的两段 DOM 遍历：
// - a[href]：页内锚点/本地文档链接去 target/rel，外链补 _blank + noopener noreferrer
// - img[src]：非打印补 loading=lazy；本地图片 → 绝对路径 → convertFileSrc 资产 URL；
//   失败回退链：同步设备路径重映射（WebDAV 场景）→ data: URL 兜底
//
// 路径谓词/锚点处理复用既有模块（utils/previewPath、utils/localImageSrcResolve、
// utils/localImagePath、core/previewAnchor）；wysiwyg 光标 nudging 依赖大量 main.ts
// 状态，经 onImageRendered 回调留在调用方。逻辑与原内联实现逐字对应。

import { convertFileSrc } from '@tauri-apps/api/core'
import { exists, readFile } from '@tauri-apps/plugin-fs'
import { resolvePreviewLocalDocPath } from '../utils/previewPath'
import { isPreviewHashLink } from './previewAnchor'
import { resolveLocalImageAbsPathFromSrc } from '../utils/localImageSrcResolve'
import { guessSyncedDocImageAbsPath } from '../utils/localImagePath'

export interface EnhanceLinksDeps {
  currentFilePath?: string | null
}

/** 外链安全属性（原 renderPreview 尾部 a[href] 遍历，逐字搬移） */
export function enhancePreviewLinks(root: ParentNode, deps: EnhanceLinksDeps): void {
  root.querySelectorAll('a[href]').forEach((a) => {
    const el = a as HTMLAnchorElement
    const href = el.getAttribute('href') || ''
    // 页内锚点链接：保持在当前预览中滚动，不打开新窗口。
    if (isPreviewHashLink(href)) {
      el.removeAttribute('target')
      el.removeAttribute('rel')
      return
    }
    if (resolvePreviewLocalDocPath(href, deps.currentFilePath)) {
      el.removeAttribute('target')
      el.removeAttribute('rel')
      return
    }
    el.target = '_blank'
    el.rel = 'noopener noreferrer'
  })
}

/** 图片扩展名 → MIME（data: URL 兜底用）；未知扩展回落 application/octet-stream */
export function mimeFromImagePath(path: string): string {
  const m = (path || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  switch (m?.[1]) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'avif': return 'image/avif'
    case 'ico': return 'image/x-icon'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

export interface EnhanceImagesDeps {
  currentFilePath?: string | null
  /** 打印/导出预览不启用懒加载 */
  forPrint?: boolean
  /** 图片挂载/加载后的回调（main.ts 的 wysiwyg 光标 nudging 逻辑） */
  onImageRendered?: (el: HTMLImageElement) => void
}

/**
 * 本地图片处理（原 renderPreview 尾部 img[src] 遍历，逐字搬移）：
 * 1. 非打印时补 loading=lazy（已有该属性则不动）
 * 2. src 能解析出本地绝对路径 → data-abs-path/data-raw-src → convertFileSrc 资产 URL
 * 3. 加载失败两级回退：先尝试映射到"当前文档同目录 images/"同名文件（WebDAV 同步后
 *    旧绝对路径失效的常见场景），仍失败读文件字节转 data: URL
 */
export function enhancePreviewImages(root: ParentNode, deps: EnhanceImagesDeps): void {
  const { currentFilePath, forPrint } = deps
  root.querySelectorAll('img[src]').forEach((img) => {
    try {
      const el = img as HTMLImageElement
      // 挂载/加载后回调（wysiwyg caret nudging 等）；保持原实现的 try 嵌套层级——
      // 接线失败时与原行为一致地跳过本 img 的后续处理
      try {
        const maybeNotify = () => { try { deps.onImageRendered?.(el) } catch {} }
        if (el.complete) { setTimeout(maybeNotify, 0) } else { el.addEventListener('load', () => setTimeout(maybeNotify, 0), { once: true }) }
      } catch {}
      try {
        // 非打印/导出预览时，对图片启用懒加载，减少长文档首屏网络请求。
        try {
          if (!forPrint && !el.hasAttribute('loading')) {
            el.setAttribute('loading', 'lazy')
          }
        } catch {}
        const src = el.getAttribute('src') || ''
        const abs0 = resolveLocalImageAbsPathFromSrc(src, currentFilePath)
        if (!abs0) return
        let abs: string = abs0
        // 若图片路径来自其他设备（WebDAV 同步后常见）：旧绝对路径会失效。
        // 这里在加载失败时，尝试把它映射到"当前文档同目录 images/"下的同名文件。
        let triedRemap = false
        let triedDataFallback = false
        const onError = async () => {
          try {
            if (!triedRemap && currentFilePath) {
              const remapped = guessSyncedDocImageAbsPath(currentFilePath, abs)
              triedRemap = true
              if (remapped && remapped !== abs) {
                try {
                  if (typeof exists === 'function' && (await exists(remapped as any))) {
                    abs = remapped
                    const u2 = typeof convertFileSrc === 'function' ? convertFileSrc(remapped) : remapped
                    try { (el as any).setAttribute('data-abs-path', remapped) } catch {}
                    el.addEventListener('error', onError, { once: true })
                    el.src = u2
                    return
                  }
                } catch {}
              }
            }
          } catch {}
          // 仍失败：回退为 data: URL（用于某些环境 asset: 也无法加载的情况）
          if (triedDataFallback) return
          triedDataFallback = true
          try {
            if (typeof readFile !== 'function') return
            const bytes = await readFile(abs as any)
            const mime = mimeFromImagePath(abs)
            const blob = new Blob([bytes], { type: mime })
            const dataUrl = await new Promise<string>((resolve, reject) => {
              try {
                const fr = new FileReader()
                fr.onerror = () => reject(fr.error || new Error('读取图片失败'))
                fr.onload = () => resolve(String(fr.result || ''))
                fr.readAsDataURL(blob)
              } catch (e) { reject(e as any) }
            })
            el.src = dataUrl
          } catch {}
        }
        el.addEventListener('error', onError, { once: true })

        const url = typeof convertFileSrc === 'function' ? convertFileSrc(abs) : abs
        try { (el as any).setAttribute('data-abs-path', abs) } catch {}
        try { if (typeof src === 'string') (el as any).setAttribute('data-raw-src', src) } catch {}
        el.src = url
      } catch {}
    } catch {}
  })
}
