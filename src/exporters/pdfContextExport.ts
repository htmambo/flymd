// PDF 上下文导出模块
// 从库文件树或标签右键菜单导出 Markdown 文件为 PDF

import { readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import { save } from '@tauri-apps/plugin-dialog'
import { exportPdf } from './pdf'

export interface PdfExportOptions {
  filePath: string          // 源文件路径
  content?: string          // 内容覆盖（用于标签导出未保存的更改）
  suggestedName?: string    // 建议的保存文件名
}

/**
 * 从文件或内存内容导出 PDF
 * @param options 导出配置
 */
export async function exportFileToPdf(options: PdfExportOptions): Promise<void> {
  let overlay: any = null

  // 1. 获取 Markdown 内容
  // 注意：空字符串是合法的"未保存空文档"覆盖值，必须区分"未提供"与"显式为空"。
  let markdown: string
  if (typeof options.content === 'string') {
    markdown = options.content
  } else if (options.filePath) {
    try {
      markdown = await readTextFile(options.filePath)
    } catch (e) {
      console.error('[PDF导出] 读取文件失败:', e)
      throw new Error(`无法读取文件: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    throw new Error('无可用内容：未提供 content 且 filePath 为空')
  }

  // 2. 获取全局渲染函数（复用主应用渲染管线：md.render + Mermaid/KaTeX 后处理）
  const win = window as any
  const renderToContainer = win?.flymdRenderMarkdownToContainer as ((c: HTMLElement, md: string, currentFilePath?: string | null) => Promise<void>) | undefined
  if (typeof renderToContainer !== 'function') {
    throw new Error('Markdown 渲染器未初始化')
  }

  // 3. 创建临时 DOM 用于 PDF 渲染（立即进入 try-finally 保证清理）
  const container = document.createElement('div')
  try {
    // 4. 创建预览容器结构并先挂载到文档（opacity:0 保留真实布局尺寸）。
    // 真正导出时只传 previewBody 正文节点，避免把容器的隐藏/定位样式克隆进渲染树。
    container.className = 'preview'
    container.style.cssText = 'position:absolute;left:0;top:0;width:210mm;overflow:visible;background:#ffffff;opacity:0;pointer-events:none;z-index:-9999'

    const previewBody = document.createElement('div')
    previewBody.className = 'preview-body'
    container.appendChild(previewBody)
    document.body.appendChild(container)

    // 5. 渲染 Markdown 到正文节点：在已挂载的容器内补全 Mermaid/KaTeX 后处理，
    // 与主菜单导出（走预览 DOM）保持一致；挂载后渲染确保尺寸测量与图片加载基于真实布局。
    // 透传 filePath 使渲染器能注入 data-abs-path/data-raw-src，供 exportPdf 内联图片时使用。
    await renderToContainer(previewBody, markdown, options.filePath || null)

    // 等待一帧，让浏览器完成布局计算
    await new Promise(resolve => requestAnimationFrame(resolve))

    // 6. 显示保存对话框
    const defaultName = (options.suggestedName || 'document.pdf')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // 清理非法文件名字符
      .replace(/^\.+/, '_') // 移除开头的点
      .substring(0, 255) // 限制长度

    const savePath = await save({
      defaultPath: defaultName,
      filters: [{
        name: 'PDF',
        extensions: ['pdf']
      }]
    })

    if (!savePath) {
      // 用户取消，静默返回
      return
    }

    const cancelSource = { cancelled: false }
    try {
      const { openProgressOverlay } = await import('../core/progressOverlay')
      overlay = openProgressOverlay({
        title: '正在导出 PDF',
        sub: '准备中…',
        onCancel: () => { cancelSource.cancelled = true },
      })
      overlay.appendLog('输出：' + String(savePath))
    } catch {}

    // 7. 导出 PDF
    let pdfBytes: Uint8Array
    try {
      try { overlay?.setSub?.('正在生成 PDF…') } catch {}
      const fmt = (v: any) => {
        try { return typeof v === 'string' ? v : JSON.stringify(v) } catch { return String(v) }
      }
      pdfBytes = await exportPdf(previewBody, {
        sourceFilePath: options.filePath,
        cancelSource,
        onLog: (msg: string, data?: any) => {
          try { overlay?.appendLog?.(data != null ? (msg + ' ' + fmt(data)) : msg) } catch {}
        },
        onProgress: (p: any) => {
          try {
            const msg = String(p?.message || '').trim()
            if (msg) overlay?.setSub?.(msg)
            const done = Number(p?.done)
            const total = Number(p?.total)
            if (Number.isFinite(done) && Number.isFinite(total) && total > 0) overlay?.setProgress?.(done, total)
          } catch {}
        },
        margin: 10,
        image: { type: 'jpeg', quality: 0.98 },
        // 不再显式传 backgroundColor：exportPdf 内部固定为白底（resolvedBg = '#ffffff'），
        // 并在 exportRoot 上 inline 浅色 CSS 变量 + 强制 Mermaid 走 light 主题，
        // 保证无论应用主题如何，PDF 始终是白底+深字+深色 Mermaid 文字。
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
    } catch (e) {
      if (e && typeof e === 'object' && (e as any)._flymdCancelled === true) {
        try { overlay?.markCancelled?.() } catch {}
        return
      }
      console.error('[PDF导出] 渲染失败:', e)
      // 直接抛出让外层 catch 统一处理 overlay.fail()，避免与外层双重提示
      throw new Error(`PDF 渲染失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 8. 写入文件
    try {
      try { overlay?.setSub?.('正在写入文件…') } catch {}
      await writeFile(savePath, pdfBytes)
    } catch (e) {
      console.error('[PDF导出] 保存文件失败:', e)
      // 直接抛出让外层 catch 统一处理 overlay.fail()
      throw new Error(`文件保存失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 9. 成功提示：仅用进度遮罩展示（与主菜单导出一致），不再额外弹窗
    console.log('[PDF导出] 成功:', savePath)
    try {
      overlay?.setTitle?.('导出完成')
      overlay?.setSub?.('已写入：' + String(savePath))
      setTimeout(() => { try { overlay?.close?.() } catch {} }, 1200)
    } catch {}
  } catch (error) {
    console.error('[PDF导出] 失败:', error)
    // 用户主动取消：静默返回
    if (error && typeof error === 'object' && (error as any)._flymdCancelled === true) {
      return
    }
    // 清理错误消息中的敏感路径
    const sanitized = error instanceof Error
      ? error.message.replace(/[A-Z]:[^\s]+/g, '[路径]').replace(/\/[^\s]+/g, '[路径]')
      : String(error)
    if (overlay) {
      // 已有进度遮罩：用遮罩展示失败即可，避免与调用方的提示重复
      try { overlay.fail('PDF 导出失败', sanitized) } catch {}
      return
    }
    // 无遮罩（保存对话框之前的早期错误）：交由调用方统一提示
    throw new Error('PDF 导出失败：' + sanitized)
  } finally {
    // 10. 确保清理临时 DOM 元素
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }
}
