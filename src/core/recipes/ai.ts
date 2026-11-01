// AI 调用层（OpenAI 兼容）。
//
// 不重新发明模型服务：配置复用用户在 AI 助手里已经配好的那一份
// （存在 Tauri store 的 `plugin:ai-assistant` → `ai.config`），
// 免费模式走的也是 AI 助手同一个代理端点。用户在 AI 助手里改一次 key，
// recipes 立刻跟着生效。
//
// 配置优先级：recipe 内 `ai:` 段 > AI 助手配置 > 内置免费模式。

import type { Recipe } from './types'

/** 免费模式下的模型档位（与 AI 助手保持一致） */
const FREE_MODEL_OPTIONS: Record<string, { label: string; id: string }> = {
  qwen: { label: 'Qwen', id: 'Qwen/Qwen3-8B' },
  gemini: { label: 'Gemini Vision', id: 'gemini-2.5-flash' },
  glm: { label: 'GLM', id: 'THUDM/glm-4-9b-chat' },
}

const DEFAULT_FREE_MODEL_KEY = 'qwen'

/** 免费模式代理端点（与 AI 助手一致） */
const FREE_PROXY_URL = 'https://flymd.llingfei.com/ai/ai_proxy.php'

/**
 * 滚动客户端令牌密钥。
 *
 * ⚠️ 必须与 `public/plugins/ai-assistant/main.js` 里的同名常量保持一致——
 * 两处是同一个客户端约定，改一处就要改另一处。
 */
const FLYMD_TOKEN_SECRET = 'flymd-rolling-secret-v1'
const FLYMD_TOKEN_WINDOW_MS = 120000

export interface AiSettings {
  /** 请求端点（完整 URL 或 baseUrl，由 buildApiUrl 归一） */
  baseUrl: string
  apiKey: string
  model: string
  /** free = 走公共代理且不需要 key；custom = 用户自己的服务 */
  provider: 'free' | 'custom'
}

export interface AiCallRequest {
  prompt: string
  system?: string
  /** 覆盖配置里的模型 */
  model?: string
}

export interface AiCallResult {
  text: string
  model: string
}

export interface AiDeps {
  /** 读 Tauri store（用于取 AI 助手配置），可为 null */
  getStore?: () => any | null
  /** HTTP 请求实现（测试注入用），默认走 Tauri http / 原生 fetch */
  fetchImpl?: (url: string, init: any) => Promise<any>
  /** 当前时间（令牌窗口用），测试注入用 */
  now?: () => number
}

/** 解析生效的 AI 配置 */
export async function resolveAiSettings(
  recipe: Recipe | null,
  deps: AiDeps = {},
): Promise<AiSettings> {
  // 1) AI 助手的配置（用户最可能已经配好的那一份）
  let assistantCfg: any = null
  try {
    const store = deps.getStore?.()
    if (store) {
      const all = (await store.get('plugin:ai-assistant')) as any
      const raw = all && typeof all === 'object' ? all['ai.config'] : null
      if (raw && typeof raw === 'object') assistantCfg = raw
    }
  } catch {
    assistantCfg = null
  }

  // 2) 基线：AI 助手配置 or 内置免费模式
  //    没有助手配置时按 AI 助手的默认行为走免费模式（它的 DEFAULT_CFG.provider = 'free'）
  const cfg = assistantCfg || { provider: 'free' }
  const isFree = cfg.provider === 'free'

  let base: AiSettings
  if (isFree) {
    const key = String(cfg.freeModel || DEFAULT_FREE_MODEL_KEY)
    const free = FREE_MODEL_OPTIONS[key] || FREE_MODEL_OPTIONS[DEFAULT_FREE_MODEL_KEY]
    base = {
      baseUrl: FREE_PROXY_URL,
      apiKey: '',
      model: free.id,
      provider: 'free',
    }
  } else {
    base = {
      baseUrl: String(cfg.baseUrl || 'https://api.siliconflow.cn/v1').trim(),
      apiKey: String(cfg.apiKey || ''),
      model: String(cfg.model || 'gpt-4o-mini'),
      provider: 'custom',
    }
  }

  // 3) recipe 内联覆盖
  const over = recipe?.ai || {}
  if (over.baseUrl) base.baseUrl = over.baseUrl
  if (over.apiKey !== undefined) base.apiKey = over.apiKey
  if (over.model) base.model = over.model
  if (over.freeModel) {
    const free = FREE_MODEL_OPTIONS[over.freeModel]
    if (free) {
      base.model = free.id
      base.baseUrl = FREE_PROXY_URL
      base.provider = 'free'
      base.apiKey = ''
    }
  }

  // 4) recipe 顶层的 model 覆盖
  if (recipe?.model) base.model = recipe.model

  return base
}

function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5
  const prime = 0x01000193
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, prime)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 构造滚动客户端令牌（免费代理模式用） */
export function buildRollingClientToken(now: number = Date.now()): string {
  const slice = Math.floor(now / FLYMD_TOKEN_WINDOW_MS)
  const partA = fnv1aHex(`${FLYMD_TOKEN_SECRET}:${slice}:2pai`)
  const partB = fnv1aHex(`${FLYMD_TOKEN_SECRET}:${slice % 97}`)
  return `flymd-${partA}${partB}`
}

/** 归一化请求端点 */
export function buildApiUrl(settings: AiSettings): string {
  const base = String(settings.baseUrl || '').trim()
  if (!base) return FREE_PROXY_URL
  const clean = base.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(clean)) return clean
  return clean + '/chat/completions'
}

/** 构造请求头 */
export function buildApiHeaders(settings: AiSettings, now?: number): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.provider !== 'free' && settings.apiKey) {
    headers.Authorization = 'Bearer ' + settings.apiKey
  }
  if (settings.provider === 'free') {
    headers['X-Flymd-Token'] = buildRollingClientToken(now)
  }
  return headers
}

/** 挑选能绕开 WebView CORS 的 fetch 实现 */
function pickTauriHttpFetch(): any | null {
  try {
    const tauri = (globalThis as any)?.__TAURI__
    if (!tauri) return null
    if (tauri.plugin?.http && typeof tauri.plugin.http.fetch === 'function') return tauri.plugin.http.fetch
    if (tauri.http && typeof tauri.http.fetch === 'function') return tauri.http.fetch
    return null
  } catch {
    return null
  }
}

async function defaultFetch(url: string, init: any): Promise<any> {
  const tauriFetch = pickTauriHttpFetch()
  if (tauriFetch) {
    try {
      const opt = init && typeof init === 'object' ? { ...init } : {}
      // AbortSignal 无法跨 IPC 序列化
      try { if (opt && opt.signal) delete opt.signal } catch {}
      return await tauriFetch(url, opt)
    } catch {
      // 回落到原生 fetch
    }
  }
  return await fetch(url, init)
}

/** 从响应里取文本（兼容标准 JSON 与 SSE 流式返回） */
export function extractAiText(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''

  try {
    const obj = JSON.parse(s)
    const direct = obj?.choices?.[0]?.message?.content
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const delta = obj?.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.trim()) return delta.trim()
  } catch {
    // 不是标准 JSON，尝试 SSE
  }

  // SSE：取最后一个能解析的 payload
  const chunks: string[] = []
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      const piece = obj?.choices?.[0]?.delta?.content ?? obj?.choices?.[0]?.message?.content
      if (typeof piece === 'string') chunks.push(piece)
    } catch {
      // 跳过坏行
    }
  }
  return chunks.join('').trim()
}

/**
 * 调用 AI。
 *
 * 未配置 API Key 且不是免费模式时，抛一个说人话的错——用户需要知道去哪儿配。
 */
export async function callAi(
  req: AiCallRequest,
  settings: AiSettings,
  deps: AiDeps = {},
): Promise<AiCallResult> {
  const prompt = String(req.prompt || '').trim()
  if (!prompt) throw new Error('提示词为空')

  if (settings.provider !== 'free' && !settings.apiKey) {
    throw new Error(
      '未配置 API Key：请在「插件 → AI 助手」里填写 Key，或在 recipe 的 ai.apiKey 段单独配置。',
    )
  }

  const url = buildApiUrl(settings)
  const headers = buildApiHeaders(settings, deps.now?.())
  const model = String(req.model || settings.model || '').trim()
  if (!model) throw new Error('未指定模型')

  const messages = [
    { role: 'system', content: String(req.system || '你是一个专业助手') },
    { role: 'user', content: prompt },
  ]

  const fetchImpl = deps.fetchImpl || defaultFetch
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, stream: false }),
  })

  const ok = response?.ok ?? (Number(response?.status) >= 200 && Number(response?.status) < 300)
  if (!ok) {
    const status = Number(response?.status || 0)
    let detail = ''
    try {
      detail = String(await response.text())
    } catch {
      detail = ''
    }
    const hint =
      settings.provider === 'free'
        ? '免费额度可能已用尽或触发限流，稍后再试。'
        : '检查 baseUrl / apiKey / model 是否正确。'
    throw new Error(`AI 调用失败（HTTP ${status}）${detail ? '：' + detail.slice(0, 400) : ''}。${hint}`)
  }

  let raw = ''
  try {
    raw = String(await response.text())
  } catch {
    raw = ''
  }

  const text = extractAiText(raw)
  if (!text) throw new Error('AI 返回内容为空')
  return { text, model }
}
