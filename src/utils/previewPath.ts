// 预览里的本地文档链接路径解析
// 抽离自 main.ts:1484-1564 + 1631-1662。
// 抽离边界:
//   - 抽走:decodePreviewHrefPath / stripPreviewHrefSuffix / normalizePreviewFsPath(参数化)
//           / fileUrlToPreviewPath / resolvePreviewLocalDocPath(参数化) + PREVIEW_LOCAL_DOC_EXT_RE
//   - 留 main:makePreviewHeadingId / ensurePreviewHeadingIds / isPreviewHashLink
//           / findPreviewAnchorTarget / scrollPreviewAnchorIntoView / openPreviewLocalDoc
// 原因:前 5 个只依赖 currentFilePath(用于回斜杠探测 + 相对路径 baseDir),
// 后 6 个强耦合 DOM/preview state 或调用 openFile2,本批不动。

const PREVIEW_LOCAL_DOC_EXT_RE = /\.(md|markdown|txt|pdf)$/i

export function decodePreviewHrefPath(input: string): string {
  try { return decodeURIComponent(input) } catch {}
  try { return decodeURI(input) } catch {}
  return input
}

export function stripPreviewHrefSuffix(input: string): string {
  const q = input.indexOf('?')
  const h = input.indexOf('#')
  let end = input.length
  if (q >= 0) end = Math.min(end, q)
  if (h >= 0) end = Math.min(end, h)
  return input.slice(0, end)
}

/**
 * 把"用户写下的路径"标准化为文件系统可用的形式。
 * - 支持 Windows 盘符前缀(C:/)、UNC(//host/share)、绝对 / 和相对路径
 * - 处理 `.` `..`
 * - 当 currentFilePath 用反斜杠时,Windows 路径结果同步还原成反斜杠
 */
export function normalizePreviewFsPath(input: string, currentFilePath?: string | null): string {
  const preferBackslash = !!(currentFilePath && currentFilePath.includes('\\'))
  let raw = String(input || '').trim()
  if (!raw) return ''
  raw = raw.replace(/\\/g, '/')

  let prefix = ''
  if (/^[A-Za-z]:\//.test(raw)) {
    prefix = raw.slice(0, 2)
    raw = raw.slice(2)
  } else if (raw.startsWith('//')) {
    const parts = raw.slice(2).split('/').filter(Boolean)
    if (parts.length >= 2) {
      prefix = `//${parts[0]}/${parts[1]}`
      raw = parts.slice(2).join('/')
    } else {
      prefix = '//'
      raw = parts.join('/')
    }
  } else if (raw.startsWith('/')) {
    prefix = '/'
    raw = raw.slice(1)
  }

  const out: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!prefix) out.push('..')
      continue
    }
    out.push(part)
  }

  let result = ''
  if (prefix === '/') {
    result = '/' + out.join('/')
  } else if (prefix === '//') {
    result = '//' + out.join('/')
  } else if (prefix.startsWith('//')) {
    result = out.length > 0 ? `${prefix}/${out.join('/')}` : prefix
  } else if (prefix) {
    result = out.length > 0 ? `${prefix}/${out.join('/')}` : `${prefix}/`
  } else {
    result = out.join('/')
  }

  if (preferBackslash && (/^[A-Za-z]:/.test(result) || result.startsWith('//'))) {
    return result.replace(/\//g, '\\')
  }
  return result
}

export function fileUrlToPreviewPath(input: string, currentFilePath?: string | null): string | null {
  try {
    const url = new URL(input)
    if (url.protocol !== 'file:') return null
    let pathname = decodePreviewHrefPath(url.pathname || '')
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1)
    if (url.host) pathname = `//${url.host}${pathname}`
    return normalizePreviewFsPath(pathname, currentFilePath)
  } catch {
    return null
  }
}

/**
 * 把预览里出现的链接 href 解析成可打开的本地文件路径。
 * 返回 null 表示不是本地文档链接(锚点、外部协议、相对路径无 currentFilePath 等)。
 */
export function resolvePreviewLocalDocPath(href: string, currentFilePath?: string | null): string | null {
  const rawHref = String(href || '').trim()
  if (!rawHref || rawHref.startsWith('#')) return null

  const bareHref = stripPreviewHrefSuffix(rawHref)
  if (!bareHref) return null

  const decodedHref = decodePreviewHrefPath(bareHref)
  if (!PREVIEW_LOCAL_DOC_EXT_RE.test(decodedHref)) return null

  if (/^file:/i.test(decodedHref)) {
    return fileUrlToPreviewPath(decodedHref, currentFilePath)
  }
  if (/^[A-Za-z]:[\\/]/.test(decodedHref) || /^\\\\/.test(decodedHref)) {
    return normalizePreviewFsPath(decodedHref, currentFilePath)
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(decodedHref)) {
    return null
  }
  if (decodedHref.startsWith('//')) {
    return null
  }
  if (decodedHref.startsWith('/')) {
    if (currentFilePath && currentFilePath.includes('\\')) return null
    return normalizePreviewFsPath(decodedHref, currentFilePath)
  }
  if (!currentFilePath) return null

  const baseDir = currentFilePath.replace(/[\\/][^\\/]*$/, '')
  const sep = baseDir.includes('\\') ? '\\' : '/'
  return normalizePreviewFsPath(`${baseDir}${sep}${decodedHref}`, currentFilePath)
}
