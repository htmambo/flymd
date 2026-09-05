// 内置扩展：Word 文档（doc/docx）预览（只查看，不编辑原文件）
// 打开管线：
//  - .docx → Rust docx_to_markdown（优先 pandoc -t gfm；无 pandoc 时返回 fallback 标记）
//            → 前端兜底：mammoth.convertToHtml({arrayBuffer}) → html2md → 写入缓存目录
//            → 用现有 Markdown 打开管线以预览模式开标签页（标签页即正文区，暗色天然适配）
//  - .doc  → 系统装有 LibreOffice 时 soffice 转 PDF（独立 UserInstallation profile 防单实例锁）
//            → 复用现有 PDF 预览；未安装则提示用户用系统程序打开
// 缓存：temp_dir()/flymd-office-preview/<hash(源路径|mtime)>/<原 stem>.md|pdf，源文件变化才重转。

import { invoke } from '@tauri-apps/api/core'
import type { Store } from '@tauri-apps/plugin-store'
import { t } from '../i18n'
import { logInfo, logWarn } from '../core/logger'
// 缓存路径判定本体在 core（纯函数，无副作用），此处再导出保持单文件入口
export {
  isOfficePreviewCachePath,
  normalizeOfficePreviewTabState,
  OFFICE_PREVIEW_CACHE_DIR_NAME,
} from '../core/officePreviewPath'

export const OFFICE_PREVIEW_EXT_ID = 'office-preview'
// ASP 规则归属 / API 命名空间：openFile2 的 plugin 分发按此命名空间解析 open 方法
export const OFFICE_PREVIEW_OWNER_ID = 'builtin-office-preview'

export const OFFICE_EXTS = ['doc', 'docx']
const ENABLED_STORE_KEY = 'officePreview'

export type OfficePreviewDeps = {
  getStore(): Store | null
  pluginNotice(msg: string, level?: 'ok' | 'err', ms?: number): void
  // 懒解析 pluginHost：main.ts 模块顶层解构拿到的是未初始化桩，必须每次调用时现取
  getPluginHost(): any | null
  refreshFileTree(): Promise<void> | void
  // 以 Markdown 预览标签打开临时副本：宿主负责 _suppressRecentPush 抑制 recent 推入
  openMarkdownPreviewTab(path: string): Promise<void>
  // 复用现有 PDF 预览
  showPdfPreview(path: string): Promise<void>
}

type OfficeProbeResult = { pandoc: boolean; soffice: boolean }
type DocxToMarkdownResult = {
  status: string // "ok" | "fallback" | "error"
  cachePath?: string | null
  cached: boolean
  message?: string | null
}
type OfficeToPdfResult = {
  status: string // "ok" | "error"
  pdfPath?: string | null
  cached: boolean
  message?: string | null
}

let _deps: OfficePreviewDeps | null = null
let _initialized = false
let _enabled = false
let _probe: OfficeProbeResult | null = null
const shouldShowTmpCopyNotice = createOnceGate()

// 纯函数：从路径提取 Word 后缀（doc/docx），其他返回 ''
export function getOfficeExt(pathRaw: unknown): string {
  try {
    const s = String(pathRaw || '').toLowerCase()
    const m = s.match(/\.(docx|doc)$/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

// 纯函数：一次性门（同一会话只放一次提示）
export function createOnceGate(): () => boolean {
  let done = false
  return () => {
    if (done) return false
    done = true
    return true
  }
}

async function getOfficePreviewEnabledFromStore(): Promise<boolean> {
  try {
    const store = _deps?.getStore?.() || null
    if (!store) return true
    const raw = (await store.get(ENABLED_STORE_KEY)) as any
    // 首次使用默认启用，用户可在扩展面板停用
    if (raw && typeof raw === 'object' && typeof raw.enabled === 'boolean') return !!raw.enabled
    return true
  } catch {
    return true
  }
}

export function isOfficePreviewEnabled(): boolean {
  return _initialized ? _enabled : true
}

export async function setOfficePreviewEnabled(enabled: boolean): Promise<void> {
  _enabled = !!enabled
  try {
    const store = _deps?.getStore?.() || null
    if (store) {
      await store.set(ENABLED_STORE_KEY, { enabled: !!enabled })
      await store.save()
    }
  } catch (e) {
    logWarn('Word 预览启用状态保存失败', e)
  }
  if (enabled) registerSuffixRules()
  else unregisterSuffixRules()
  try { await _deps?.refreshFileTree?.() } catch {}
  try { _deps?.pluginNotice?.(t(enabled ? 'officePreview.enableOk' : 'officePreview.disableOk'), 'ok', 1800) } catch {}
  logInfo('Word 预览扩展状态切换', { enabled: !!enabled })
}

function buildSuffixSpec(): any {
  return {
    extensions: OFFICE_EXTS.slice(),
    displayName: t('officePreview.dialogName'),
    fileTree: { show: true, icon: 'word' },
    openWith: { mode: 'plugin', pluginId: OFFICE_PREVIEW_OWNER_ID, method: 'open' },
  }
}

function registerSuffixRules(): void {
  try {
    const host = _deps?.getPluginHost?.()
    if (!host || typeof host.registerBuiltinSuffixRules !== 'function') return
    host.registerBuiltinSuffixRules(OFFICE_PREVIEW_OWNER_ID, buildSuffixSpec())
  } catch (e) {
    logWarn('Word 预览 ASP 注册失败', e)
  }
}

function unregisterSuffixRules(): void {
  try {
    const host = _deps?.getPluginHost?.()
    if (!host || typeof host.unregisterBuiltinSuffixRules !== 'function') return
    host.unregisterBuiltinSuffixRules(OFFICE_PREVIEW_OWNER_ID)
  } catch (e) {
    logWarn('Word 预览 ASP 注销失败', e)
  }
}

function registerApi(): void {
  try {
    const host = _deps?.getPluginHost?.()
    if (!host || typeof host.registerBuiltinAPI !== 'function') return
    host.registerBuiltinAPI(OFFICE_PREVIEW_OWNER_ID, OFFICE_PREVIEW_OWNER_ID, {
      open: (path: string) => openOfficeDocument(path),
    })
  } catch (e) {
    logWarn('Word 预览 API 注册失败', e)
  }
}

async function getProbe(): Promise<OfficeProbeResult> {
  if (_probe) return _probe
  try {
    _probe = (await invoke('office_probe')) as OfficeProbeResult
  } catch (e) {
    logWarn('office_probe 调用失败', e)
    _probe = { pandoc: false, soffice: false }
  }
  return _probe
}

function showTmpCopyNoticeOnce(): void {
  try {
    if (!shouldShowTmpCopyNotice()) return
    _deps?.pluginNotice?.(t('officePreview.tmpCopyNotice'), 'ok', 4200)
  } catch {}
}

// ASP plugin 分发入口（openFile2 → getPluginAPI('builtin-office-preview').open）
async function openOfficeDocument(path: string): Promise<void> {
  const deps = _deps
  if (!deps) return
  const ext = getOfficeExt(path)
  try {
    if (ext === 'docx') await openDocxAsMarkdown(path)
    else if (ext === 'doc') await openDocAsPdf(path)
    else throw new Error(`不支持的扩展名: .${ext || '?'}`)
  } catch (e) {
    const msg = String((e as any)?.message || e || '')
    logWarn('Word 预览打开失败', { path, err: msg })
    try { deps.pluginNotice(t('officePreview.convertFail', { msg }), 'err', 3600) } catch {}
  }
}

// 同一 docx/doc 反复打开去重：预览标签的身份是转换产物路径（临时 md/pdf 缓存），
// 与打开入参（docx/doc）路径不同——外层包装器按入参 findTabByPath(docx) 永远命中不了
// 已有预览标签，导致每开一次多一个标签。转换拿到产物路径后先按产物路径去重：
// 已打开则仅激活该标签（动态 import 避免与 tabs/integration 的静态循环依赖）。
async function activateExistingPreviewTab(cachePath: string): Promise<boolean> {
  try {
    const m = await import('../tabs/integration')
    return await m.activateTabByPathIfOpen(cachePath)
  } catch {
    return false
  }
}

// 打开前去重：仅向 Rust 查询缓存产物路径（不执行转换，缓存存在才返回）。
// 标签系统挂钩据此在 createNewTab 之前命中已有预览标签，直接切换，
// 避免"先开新标签 → 关闭 → 再激活旧预览标签"的闪烁（Web 端无 Tauri 时静默返回 null）
export async function findExistingPreviewCachePath(path: string): Promise<string | null> {
  if (!getOfficeExt(path)) return null
  try {
    return (await invoke('office_preview_cache_path', { path })) as string | null
  } catch {
    return null
  }
}

async function openDocxAsMarkdown(path: string): Promise<void> {
  const deps = _deps!
  try { deps.pluginNotice(t('officePreview.converting'), 'ok', 1800) } catch {}
  const res = (await invoke('docx_to_markdown', { path })) as DocxToMarkdownResult

  if (res.status === 'ok' && res.cachePath) {
    logInfo(res.cached ? 'Word 预览命中缓存' : 'Word 预览 pandoc 转换完成', {
      src: path,
      cache: res.cachePath,
    })
    // 同一 docx 反复打开：预览标签已存在则仅激活，零新增标签
    if (await activateExistingPreviewTab(res.cachePath)) return
    await deps.openMarkdownPreviewTab(res.cachePath)
    try { deps.pluginNotice(t('officePreview.converted'), 'ok', 1600) } catch {}
    showTmpCopyNoticeOnce()
    return
  }

  if (res.status === 'fallback' && res.cachePath) {
    logInfo('Word 预览走前端 mammoth 兜底', { src: path, reason: res.message || 'no pandoc' })
    await mammothToMarkdownCache(path, res.cachePath)
    // 同一 docx 反复打开：预览标签已存在则仅激活，零新增标签
    if (await activateExistingPreviewTab(res.cachePath)) return
    await deps.openMarkdownPreviewTab(res.cachePath)
    try { deps.pluginNotice(t('officePreview.converted'), 'ok', 1600) } catch {}
    showTmpCopyNoticeOnce()
    return
  }

  throw new Error(res.message || 'docx_to_markdown 未知失败')
}

// mammoth 浏览器入口：convertToHtml({arrayBuffer})（convertToMarkdown 已被官方弃用）
async function mammothToMarkdownCache(src: string, cachePath: string): Promise<void> {
  const bytes = await invoke('read_file_bytes_any', { path: src })
  // Tauri IPC 对 Vec<u8> 可能给 ArrayBuffer / Uint8Array / number[]，统一转成 ArrayBuffer
  let buf: ArrayBuffer | null = null
  if (bytes instanceof ArrayBuffer) {
    buf = bytes
  } else if (ArrayBuffer.isView(bytes)) {
    const u8 = bytes as Uint8Array
    buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  } else if (Array.isArray(bytes)) {
    buf = new Uint8Array(bytes).buffer
  }
  if (!buf || !buf.byteLength) throw new Error('读取 docx 字节失败')

  const mammoth: any = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: buf })
  const { htmlToMarkdown } = await import('../html2md')
  const md = htmlToMarkdown(String(result?.value || ''), { baseUrl: '' })

  await invoke('write_text_file_any', { path: cachePath, content: md })
  logInfo('Word 预览 mammoth 兜底转换完成', { src, cache: cachePath, size: md.length })
}

async function openDocAsPdf(path: string): Promise<void> {
  const deps = _deps!
  const probe = await getProbe()
  if (!probe.soffice) {
    logWarn('未检测到 LibreOffice，.doc 预览不可用', { path })
    try { deps.pluginNotice(t('officePreview.noSoffice'), 'err', 4200) } catch {}
    return
  }
  try { deps.pluginNotice(t('officePreview.converting'), 'ok', 1800) } catch {}
  const res = (await invoke('office_to_pdf', { path })) as OfficeToPdfResult
  if (res.status === 'ok' && res.pdfPath) {
    logInfo(res.cached ? '.doc→PDF 命中缓存' : '.doc→PDF 转换完成', {
      src: path,
      pdf: res.pdfPath,
    })
    // 同一 doc 反复打开：PDF 预览标签已存在则仅激活，零新增标签
    if (await activateExistingPreviewTab(res.pdfPath)) return
    await deps.showPdfPreview(res.pdfPath)
    return
  }
  throw new Error(res.message || 'soffice 转换失败')
}

export async function initOfficePreviewFeature(deps: OfficePreviewDeps): Promise<void> {
  if (_initialized) return
  _initialized = true
  _deps = deps
  // API 命名空间一次注册即可；ASP 后缀规则随启用状态注册/注销
  registerApi()
  _enabled = await getOfficePreviewEnabledFromStore()
  if (_enabled) registerSuffixRules()
  try { await deps.refreshFileTree() } catch {}
  logInfo('Word 预览扩展初始化完成', { enabled: _enabled })
}
