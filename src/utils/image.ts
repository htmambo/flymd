// 图片处理工具（前端转码为 WebP，带动图/APNG 检测）
// 仅依赖浏览器/Tauri WebView API

export type TranscodeResult = {
  blob: Blob
  type: string
  fileName: string
  changed: boolean
}

function getExtLower(name: string): string {
  try {
    const s = String(name || '').trim().toLowerCase()
    const m = s.match(/\.([a-z0-9]+)$/i)
    return m ? m[1].toLowerCase() : ''
  } catch { return '' }
}

// 将文件名后缀替换为 .webp
function toWebpName(name: string): string {
  try {
    const idx = name.lastIndexOf('.')
    if (idx > 0) return name.slice(0, idx) + '.webp'
    return name + '.webp'
  } catch { return (name || 'image') + '.webp' }
}

// 读取 Blob 为 ArrayBuffer，可只取前 limit 字节。
// 用 Blob.slice 而非「先 arrayBuffer 再 subarray」：后者会把整个文件读进
// 内存再截断，limit 参数形同虚设（大图的 APNG 检测会白读整份文件）。
async function readBlobBytes(b: Blob, limit?: number): Promise<Uint8Array> {
  const src = limit != null && limit > 0 ? b.slice(0, limit) : b
  return new Uint8Array(await src.arrayBuffer())
}

// 校验 GIF 文件头："GIF87a" / "GIF89a"
function isGifSignature(bytes: Uint8Array): boolean {
  try {
    if (bytes.length < 6) return false
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
      bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  } catch { return false }
}

// 检测 GIF 是否为动图：NETSCAPE2.0/ANIMEXTS1.0 循环扩展，或存在多个图像描述符(0x2C)
function isAnimatedGifBytes(bytes: Uint8Array): boolean {
  try {
    const str = new TextDecoder('latin1', { fatal: false }).decode(bytes)
    if (str.includes('NETSCAPE2.0') || str.includes('ANIMEXTS1.0')) return true
  } catch {}
  // 简易扫描 0x2C（图像描述符）计数
  let count = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x2c) { count++; if (count >= 2) return true }
  }
  return false
}

// 检测 PNG 是否为 APNG：存在 acTL 块
function isApngBytes(bytes: Uint8Array): boolean {
  try {
    // PNG 头部签名 8 字节：89 50 4E 47 0D 0A 1A 0A
    if (bytes.length < 16) return false
    const sig = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]
    for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
    // 简易查找 "acTL"
    const str = new TextDecoder('latin1', { fatal: false }).decode(bytes)
    return str.includes('acTL')
  } catch { return false }
}

// 通用：基于 Canvas 转为 WebP
async function rasterizeToWebp(input: Blob, quality: number): Promise<Blob | null> {
  const url = URL.createObjectURL(input)
  try {
    const img = new Image()
    const blob: Blob | null = await new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          const w = (img.naturalWidth || (img as any).width || 1) >>> 0
          const h = (img.naturalHeight || (img as any).height || 1) >>> 0
          const canvas = document.createElement('canvas')
          canvas.width = w > 0 ? w : 1
          canvas.height = h > 0 ? h : 1
          const ctx = canvas.getContext('2d')!
          // 默认白底，避免某些格式带 alpha 叠加差异；保留透明由 WebP 处理
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0)
          canvas.toBlob((b) => resolve(b), 'image/webp', Number.isFinite(quality) ? Math.max(0.01, Math.min(0.99, quality || 0.85)) : 0.85)
        } catch (e) { reject(e) }
      }
      img.onerror = () => reject(new Error('image decode failed'))
      img.src = url
    })
    return blob
  } finally {
    try { URL.revokeObjectURL(url) } catch {}
  }
}

export async function transcodeToWebpIfNeeded(input: Blob, origName: string, quality = 0.85, opts?: { skipAnimated?: boolean }): Promise<TranscodeResult> {
  try {
    const type = (input.type || '').toLowerCase()
    const skipAnimated = !!opts?.skipAnimated
    const ext = getExtLower(origName)
    // 已是 WebP：直接返回
    if (type.includes('image/webp')) {
      return { blob: input, type: 'image/webp', fileName: origName, changed: false }
    }
    // GIF：按 UI 语义“Gif 直接跳过”（不要转 WebP）。
    // 不能只靠 Blob.type：某些环境/来源会是 application/octet-stream 或空字符串。
    if (skipAnimated && (type.includes('image/gif') || (ext === 'gif' && !type.includes('image/')))) {
      return { blob: input, type: 'image/gif', fileName: origName, changed: false }
    }
    // APNG：跳过
    if (skipAnimated && type.includes('image/png')) {
      try { const head = await readBlobBytes(input, 512 * 1024); if (isApngBytes(head)) return { blob: input, type: 'image/png', fileName: origName, changed: false } } catch {}
    }
    // 动图 GIF 的兜底：上面按 type/ext 的判断仍会漏掉一批情况 ——
    // 来源给了错误 MIME（如 xxx.png 却是 image/gif）或两者都不可靠时，动图会被
    // 转成静态 WebP，动画就此丢失。这里在「即将转码」这一步补一次字节级检测。
    // 只读前 64KB（Blob.slice 是惰性的，不整文件 arrayBuffer），先验签名再判多帧。
    if (skipAnimated) {
      try {
        const head = await readBlobBytes(input, 64 * 1024)
        if (isGifSignature(head) && isAnimatedGifBytes(head)) {
          return { blob: input, type: 'image/gif', fileName: origName, changed: false }
        }
      } catch {}
    }
    // 其他位图或 SVG：尝试转码
    const webp = await rasterizeToWebp(input, quality)
    if (webp && webp.size > 0) {
      return { blob: webp, type: 'image/webp', fileName: toWebpName(origName || 'image'), changed: true }
    }
    // 转码失败：回退
    return { blob: input, type, fileName: origName, changed: false }
  } catch {
    return { blob: input, type: (input.type || 'application/octet-stream'), fileName: origName, changed: false }
  }
}

