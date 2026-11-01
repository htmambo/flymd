// YAML → Recipe 的解析与校验。
//
// 解析阶段把所有"用户可能写错"的情况挡在门外：字段缺失、类型不对、cron 非法、
// 输出路径越界……错误信息要能让人一眼看懂并知道怎么改。
//
// 校验原则：宁可拒绝一条 recipe，也不要让它带着半截配置在后台乱跑。

import * as yaml from 'js-yaml'
import { parseCron } from './cron'
import type { Recipe, RecipeOutput, RecipeTrigger } from './types'

/** recipe id 允许的字符：字母数字开头，可含 . _ - */
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** 库内相对路径校验：不能是绝对路径，不能含 `..` 段 */
export function isSafeRelativePath(p: string): boolean {
  const s = String(p || '').trim()
  if (!s) return false
  const norm = s.replace(/\\/g, '/')
  if (norm.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(norm)) return false
  if (norm.split('/').some((seg) => seg === '..')) return false
  return true
}

function fail(message: string): never {
  throw new Error(message)
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${what} 必须是一个对象`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, what: string, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${what} 必须是字符串`)
  const s = value.trim()
  if (!allowEmpty && !s) fail(`${what} 不能为空`)
  return s
}

function asBoolean(value: unknown, what: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') fail(`${what} 必须是 true 或 false`)
  return value
}

function asStringArray(value: unknown, what: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(`${what} 必须是字符串数组`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') fail(`${what} 的每一项都必须是字符串`)
    const s = item.trim()
    if (s) out.push(s)
  }
  return out
}

function parseTrigger(raw: unknown): RecipeTrigger {
  const obj = asObject(raw, 'trigger')

  const type = asString(obj.type, 'trigger.type')
  if (type !== 'schedule' && type !== 'on-save') {
    fail(`trigger.type 只能是 schedule 或 on-save（收到 "${type}"）`)
  }

  const trigger: RecipeTrigger = { type }

  if (type === 'schedule') {
    const cron = asString(obj.cron, 'trigger.cron')
    // 立刻验一次 cron，避免坏表达式进到调度器才炸
    try {
      parseCron(cron)
    } catch (e) {
      fail(`trigger.cron 无法解析：${(e as Error).message}`)
    }
    trigger.cron = cron
  } else {
    const paths = asStringArray(obj.paths, 'trigger.paths')
    for (const p of paths) {
      if (p.startsWith('/')) fail(`trigger.paths 必须是库内相对路径（"${p}"）`)
    }
    trigger.paths = paths

    const debounce = obj.debounceMs
    if (debounce !== undefined && debounce !== null) {
      const n = Number(debounce)
      if (!Number.isFinite(n) || n < 0) fail('trigger.debounceMs 必须是非负数字')
      trigger.debounceMs = Math.floor(n)
    }
  }

  return trigger
}

function parseOutput(raw: unknown): RecipeOutput {
  if (raw === undefined || raw === null) return { mode: 'none' }
  const obj = asObject(raw, 'output')

  const mode = asString(obj.mode, 'output.mode')
  if (mode !== 'none' && mode !== 'note' && mode !== 'replace') {
    fail(`output.mode 只能是 none / note / replace（收到 "${mode}"）`)
  }

  const output: RecipeOutput = { mode }

  if (mode !== 'none') {
    const path = asString(obj.path, 'output.path')
    if (!isSafeRelativePath(path)) {
      fail(`output.path 必须是库内相对路径，不能是绝对路径或含 ".."（收到 "${path}"）`)
    }
    output.path = path.replace(/\\/g, '/').replace(/^\/+/, '')
  }

  output.heading = asBoolean(obj.heading, 'output.heading', true)
  return output
}

/**
 * 解析一个 recipe 文件内容。
 * 失败时抛带说明的 Error（调用方转成 RecipeParseError 展示）。
 */
export function parseRecipeYaml(text: string, sourceFile = ''): Recipe {
  // 空内容单独处理：js-yaml 对空串抛的是英文的 "expected a document"，
  // 这里换成能直接指导用户的中文说明
  if (!String(text ?? '').trim()) fail('文件内容为空')

  let doc: unknown
  try {
    doc = yaml.load(text)
  } catch (e) {
    const msg = (e as Error).message
    // js-yaml 对"空文档"（空串或只有注释）抛的是英文错误，这里换成中文说明
    if (/input is empty|expected a document/i.test(msg)) fail('文件内容为空')
    fail(`YAML 语法错误：${msg}`)
  }

  if (doc === null || doc === undefined) fail('文件内容为空')
  const obj = asObject(doc, 'recipe')

  const id = asString(obj.id, 'id')
  if (!ID_PATTERN.test(id)) {
    fail(`id 只能包含字母、数字、. _ -，且必须以字母或数字开头（收到 "${id}"）`)
  }

  const name = asString(obj.name, 'name')
  const enabled = asBoolean(obj.enabled, 'enabled', true)
  const trigger = parseTrigger(obj.trigger)
  const prompt = asString(obj.prompt, 'prompt')
  const output = parseOutput(obj.output)

  const recipe: Recipe = { id, name, enabled, trigger, prompt, output }
  if (sourceFile) recipe.sourceFile = sourceFile

  if (obj.system !== undefined && obj.system !== null) {
    recipe.system = asString(obj.system, 'system', true)
  }
  if (obj.model !== undefined && obj.model !== null) {
    recipe.model = asString(obj.model, 'model')
  }

  if (obj.ai !== undefined && obj.ai !== null) {
    const ai = asObject(obj.ai, 'ai')
    const override: NonNullable<Recipe['ai']> = {}
    if (ai.baseUrl !== undefined && ai.baseUrl !== null) {
      override.baseUrl = asString(ai.baseUrl, 'ai.baseUrl')
    }
    if (ai.apiKey !== undefined && ai.apiKey !== null) {
      override.apiKey = asString(ai.apiKey, 'ai.apiKey', true)
    }
    if (ai.model !== undefined && ai.model !== null) {
      override.model = asString(ai.model, 'ai.model')
    }
    if (ai.freeModel !== undefined && ai.freeModel !== null) {
      override.freeModel = asString(ai.freeModel, 'ai.freeModel')
    }
    recipe.ai = override
  }

  return recipe
}
