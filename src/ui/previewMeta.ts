// 阅读模式预览顶部的 Front Matter 元数据条
// 抽离自 main.ts:1965-2121。
// 抽离理由:本块是"渲染产物 DOM 注入 + 折叠开关"的纯 UI 逻辑,
// 状态量小(visible 布尔 + localStorage 持久化),用模块级状态封装即可消除闭包。
// currentFilePath 来自闭包(用于回退标题),已通过 opts.currentFilePath 参数化。
// 复用 src/core/metadataLabels.ts 的 MetadataLabelMap 与 resolveMetadataLabel(已是权威源)。

import { resolveMetadataLabel, type MetadataLabelMap } from '../core/metadataLabels'

const STORAGE_KEY = 'flymd:preview:showMeta'

let previewMetaVisible = true
try {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === '0' || (v && v.toLowerCase() === 'false')) previewMetaVisible = false
} catch {}

export function setPreviewMetaVisible(v: boolean): void {
  previewMetaVisible = v
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0') } catch {}
}

export function isPreviewMetaVisible(): boolean {
  return previewMetaVisible
}

export interface InjectPreviewMetaOpts {
  metadataLabels?: MetadataLabelMap | null
  currentFilePath?: string | null
}

const isMetaEmpty = (value: any): boolean => {
  if (value == null) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.every((item) => isMetaEmpty(item))
  if (value instanceof Date) return Number.isNaN(value.getTime())
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

const formatMetaValue = (value: any): string => {
  if (value == null) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) || '' } catch {}
  return String(value || '').trim()
}

/**
 * 把 Front Matter 元数据条注入到预览容器顶部。
 * 折叠状态走模块级 previewMetaVisible,跨调用共享。
 */
export function injectPreviewMeta(
  container: HTMLDivElement,
  meta: any | null,
  opts: InjectPreviewMetaOpts = {},
): void {
  if (!meta || typeof meta !== 'object') return
  const m: any = meta
  const { metadataLabels = null, currentFilePath = null } = opts

  const title = (typeof m.title === 'string' && m.title.trim())
    || (currentFilePath ? (currentFilePath.split(/[\\/]+/).pop() || '') : '')
  const cats = Array.isArray(m.categories)
    ? m.categories.map((x: any) => String(x || '').trim()).filter(Boolean)
    : (m.category ? [String(m.category || '').trim()] : [])
  const catsKey = Array.isArray(m.categories) ? 'categories' : (m.category ? 'category' : 'categories')
  const tags = Array.isArray(m.tags)
    ? m.tags.map((x: any) => String(x || '').trim()).filter(Boolean)
    : []
  const statusKey = typeof m.status === 'string' ? 'status' : (m.draft === true ? 'draft' : 'status')
  const status = typeof m.status === 'string' ? m.status : (m.draft === true ? 'draft' : '')
  const slugKey = m.slug ? 'slug' : (m.typechoSlug ? 'typechoSlug' : 'slug')
  const slug = (m.slug || m.typechoSlug) ? String(m.slug || m.typechoSlug || '') : ''
  const idKey = m.typechoId ? 'typechoId' : (m.id ? 'id' : (m.cid ? 'cid' : 'id'))
  const id = (m.typechoId || m.id || m.cid) ? String(m.typechoId || m.id || m.cid || '') : ''
  const dateKey = m.date ? 'date' : (m.dateCreated ? 'dateCreated' : (m.created ? 'created' : (m.typechoUpdatedAt ? 'typechoUpdatedAt' : 'date')))
  const dateRaw = m.date || m.dateCreated || m.created || m.typechoUpdatedAt || ''
  const source = typeof m.source === 'string' ? m.source : ''

  const metaRoot = document.createElement('div')
  metaRoot.className = 'preview-meta'
  if (!previewMetaVisible) metaRoot.classList.add('collapsed')

  const header = document.createElement('div')
  header.className = 'preview-meta-header'

  const titleEl = document.createElement('div')
  titleEl.className = 'preview-meta-title'
  if (title) titleEl.textContent = title

  const toggleBtn = document.createElement('button')
  toggleBtn.type = 'button'
  toggleBtn.className = 'preview-meta-toggle'
  const syncToggleText = () => {
    toggleBtn.textContent = previewMetaVisible ? '隐藏元数据' : '显示元数据'
  }
  syncToggleText()
  toggleBtn.addEventListener('click', () => {
    const now = !previewMetaVisible
    setPreviewMetaVisible(now)
    if (now) metaRoot.classList.remove('collapsed')
    else metaRoot.classList.add('collapsed')
    syncToggleText()
  })

  header.appendChild(titleEl)
  header.appendChild(toggleBtn)
  metaRoot.appendChild(header)

  const body = document.createElement('div')
  body.className = 'preview-meta-body'

  const addRow = (label: string, value: any) => {
    if (isMetaEmpty(value)) return
    const row = document.createElement('div')
    row.className = 'preview-meta-row'
    const lab = document.createElement('span')
    lab.className = 'preview-meta-label'
    lab.textContent = label
    row.appendChild(lab)
    const val = document.createElement('span')
    val.className = 'preview-meta-value'
    if (Array.isArray(value)) {
      for (const it of value) {
        const chipText = formatMetaValue(it)
        if (!chipText) continue
        const chip = document.createElement('span')
        chip.className = 'preview-meta-chip'
        chip.textContent = chipText
        val.appendChild(chip)
      }
      if (val.children.length === 0) return
    } else {
      const text = formatMetaValue(value)
      if (!text) return
      val.textContent = text
    }
    row.appendChild(val)
    body.appendChild(row)
  }
  const addRowForKey = (key: string, value: any) => addRow(resolveMetadataLabel(key, metadataLabels), value)

  if (cats.length) addRowForKey(catsKey, cats)
  if (tags.length) addRowForKey('tags', tags)
  if (status) addRowForKey(statusKey, status)
  if (slug) addRowForKey(slugKey, slug)
  if (id) addRowForKey(idKey, id)
  if (dateRaw) addRowForKey(dateKey, String(dateRaw))
  if (source) addRowForKey('source', source)

  const handledKeys = new Set([
    'title',
    'categories',
    'category',
    'tags',
    'status',
    'draft',
    'slug',
    'typechoSlug',
    'typechoId',
    'id',
    'cid',
    'date',
    'dateCreated',
    'created',
    'typechoUpdatedAt',
    'source',
  ])
  for (const [key, value] of Object.entries(m)) {
    if (!key || handledKeys.has(key)) continue
    addRowForKey(key, value)
  }

  if (body.children.length > 0) {
    metaRoot.appendChild(body)
  }

  container.insertBefore(metaRoot, container.firstChild)
}
