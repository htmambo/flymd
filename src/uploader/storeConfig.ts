// 从 store.get('uploader') 的原始对象解析出可用配置
// 原则：默认 provider=s3，旧字段保持不变；仅在启用时做严格校验
//
// PR-4: 读优先走 libraryPrivate.uploader（新通道,库内 local.json,含凭据）,
// fallback 到旧 Store key（v1.4.4 及之前的 `uploader:<libId>`）。
// 写只走 libraryPrivate —— 迁移完成后不再写旧 Store key。

import type { Store } from '@tauri-apps/plugin-store'
import type { AnyUploaderConfig, ImgLaUploaderConfig, S3UploaderConfig, UploaderProvider } from './types'
import { libraryScopedKey, getLibraryScope } from '../core/libraryConfig'
import { readLibraryPrivate, writeLibraryPrivate } from '../core/libraryPrivate'

// 图床配置按库隔离：持久化库激活时优先读 libraryPrivate.uploader（含凭据，
// 随库目录走,PR-1 已默认排除 WebDAV 同步）；fallback 到 Store 的 `uploader:<libId>`
// （旧通道,v1.4.4 及之前数据）。库级 key 不存在时回落全局 'uploader'。
// 临时库/无库走全局 key（保持旧行为）。
export async function getUploaderRaw(store: Store | null): Promise<any> {
  // PR-4: 优先新通道
  try {
    const priv = await readLibraryPrivate()
    if (priv?.uploader !== undefined) return priv.uploader
  } catch {}

  // Fallback: 旧 Store key
  if (!store) return null
  try {
    const key = libraryScopedKey('uploader')
    const v = await store.get(key)
    if (v != null) return v
    if (key !== 'uploader') return await store.get('uploader')
    return v ?? null
  } catch {
    return null
  }
}

export async function setUploaderRaw(store: Store | null, raw: any): Promise<void> {
  // PR-4: 写只走新通道 libraryPrivate
  // 但要尊重临时库/无库场景:此时 libraryPrivate 不生效,fallback 旧 Store
  const scope = getLibraryScope()
  if (scope.persisted && scope.root) {
    try {
      await writeLibraryPrivate({ uploader: raw ?? null }, { immediate: true })
      return
    } catch {}
  }
  // Fallback: 旧 Store（保持旧行为,无库 / 临时库场景）
  if (!store) return
  try {
    await store.set(libraryScopedKey('uploader'), raw)
    await store.save()
  } catch {}
}

const IMGLA_BASE_URL = 'https://www.imgla.net'

function normStr(v: unknown): string {
  return String(v ?? '').trim()
}

function normUrl(v: unknown): string {
  const s = normStr(v)
  return s.replace(/\/+$/, '')
}

function normNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = normStr(v)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function getUploaderProviderFromRaw(raw: any): UploaderProvider {
  const p = normStr(raw?.provider).toLowerCase()
  if (p === 'imgla') return 'imgla'
  return 's3'
}

export function parseUploaderConfigEnabledOnly(raw: any): AnyUploaderConfig | null {
  if (!raw || typeof raw !== 'object') return null
  if (!raw.enabled) return null
  return parseUploaderConfigForManagement(raw, { enabledOnly: true })
}

export function parseUploaderConfigForManagement(
  raw: any,
  opts?: { enabledOnly?: boolean },
): AnyUploaderConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const enabled = !!raw.enabled
  if (opts?.enabledOnly && !enabled) return null

  const provider = getUploaderProviderFromRaw(raw)
  const convertToWebp = !!raw.convertToWebp
  const webpQuality = (typeof raw.webpQuality === 'number' && Number.isFinite(raw.webpQuality)) ? raw.webpQuality : 0.85
  const saveLocalAsWebp = !!raw.saveLocalAsWebp

  if (provider === 'imgla') {
    // Lsky Pro+ 兼容：允许用户覆写 baseUrl（默认 ImgLa）
    const baseUrl = normUrl(raw.imglaBaseUrl ?? raw.baseUrl) || IMGLA_BASE_URL
    const token = normStr(raw.imglaToken ?? raw.token)
    const strategyId = normNum(raw.imglaStrategyId ?? raw.strategyId) ?? 1
    const albumId = normNum(raw.imglaAlbumId ?? raw.albumId) ?? undefined

    if (!token) return null

    const cfg: ImgLaUploaderConfig = {
      enabled,
      provider,
      baseUrl,
      token,
      strategyId,
      albumId,
      convertToWebp,
      webpQuality,
      saveLocalAsWebp,
    }
    return cfg
  }

  // 默认：S3/R2
  const accessKeyId = normStr(raw.accessKeyId)
  const secretAccessKey = normStr(raw.secretAccessKey)
  const bucket = normStr(raw.bucket)
  if (!accessKeyId || !secretAccessKey || !bucket) return null

  const cfg: S3UploaderConfig = {
    enabled,
    provider: 's3',
    accessKeyId,
    secretAccessKey,
    bucket,
    region: typeof raw.region === 'string' ? raw.region : undefined,
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : undefined,
    customDomain: typeof raw.customDomain === 'string' ? raw.customDomain : undefined,
    keyTemplate: typeof raw.keyTemplate === 'string' ? raw.keyTemplate : '{year}/{month}{fileName}{md5}.{extName}',
    aclPublicRead: raw.aclPublicRead !== false,
    forcePathStyle: raw.forcePathStyle !== false,
    convertToWebp,
    webpQuality,
    saveLocalAsWebp,
  }
  return cfg
}
