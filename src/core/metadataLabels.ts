export type MetadataLabelMap = Record<string, string>

export const DEFAULT_METADATA_LABELS: MetadataLabelMap = {
  title: '标题',
  category: '分类',
  categories: '分类',
  tags: '标签',
  status: '状态',
  draft: '草稿',
  slug: 'Slug',
  typechoSlug: 'Typecho Slug',
  typechoId: 'Typecho ID',
  id: 'ID',
  cid: 'CID',
  date: '时间',
  dateCreated: '创建时间',
  created: '创建时间',
  updated: '更新时间',
  modified: '更新时间',
  typechoUpdatedAt: 'Typecho 更新时间',
  source: '来源',
  author: '作者',
  authors: '作者',
  description: '描述',
  summary: '摘要',
  excerpt: '摘要',
  cover: '封面',
  image: '图片',
  aliases: '别名',
  url: '链接',
  link: '链接',
}

export function normalizeMetadataLabelMap(input: any): MetadataLabelMap {
  const out: MetadataLabelMap = {}
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out
    for (const [rawKey, rawValue] of Object.entries(input)) {
      const key = String(rawKey || '').trim()
      const value = String(rawValue || '').trim()
      if (!key || !value) continue
      out[key] = value
    }
  } catch {}
  return out
}

export function parseMetadataLabelMapText(text: string): MetadataLabelMap {
  const out: MetadataLabelMap = {}
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) continue
    const eqIdx = raw.indexOf('=')
    const colonIdx = raw.indexOf(':')
    const idx = eqIdx >= 0 ? eqIdx : colonIdx
    if (idx <= 0) continue
    const key = raw.slice(0, idx).trim()
    const value = raw.slice(idx + 1).trim()
    if (!key || !value) continue
    out[key] = value
  }
  return out
}

export function stringifyMetadataLabelMap(map: MetadataLabelMap): string {
  const safe = normalizeMetadataLabelMap(map)
  return Object.keys(safe)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key} = ${safe[key]}`)
    .join('\n')
}

export function resolveMetadataLabel(key: string, custom?: MetadataLabelMap | null): string {
  const k = String(key || '').trim()
  if (!k) return ''
  const user = normalizeMetadataLabelMap(custom)
  return user[k] || DEFAULT_METADATA_LABELS[k] || k
}
