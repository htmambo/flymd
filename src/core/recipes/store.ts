// recipes 目录的读写。
//
// 布局：<库根>/.flymd/recipes/*.yaml（配置，随库走、可被 WebDAV 同步）
//       <库根>/.flymd/recipes/runs.jsonl（运行日志，设备本地，不参与同步）
//
// 放在 .flymd/ 下是刻意的：recipe 是「配置」而非「设备私有数据」，
// 用户换台机器、把库同步过去，recipe 应该跟着走。

import { invoke } from '@tauri-apps/api/core'
import { ensureDir, readTextFileAnySafe, writeTextFileAnySafe } from '../fsSafe'
import { parseRecipeYaml } from './parse'
import type { Recipe, RecipeParseError, RecipeRunRecord } from './types'

/** recipes 目录（相对库根） */
export const RECIPES_DIR = '.flymd/recipes'

/** 运行日志文件名 */
export const RUNS_FILE = 'runs.jsonl'

const YAML_EXT = /\.(ya?ml)$/i

/** recipes 目录的绝对路径 */
export function recipesDir(root: string): string {
  const r = String(root || '').replace(/[\\/]+$/, '')
  return r ? `${r}/${RECIPES_DIR}` : RECIPES_DIR
}

/** 运行日志的绝对路径 */
export function runsFile(root: string): string {
  return `${recipesDir(root)}/${RUNS_FILE}`
}

/** 单个 recipe 文件的绝对路径 */
export function recipeFilePath(root: string, fileName: string): string {
  return `${recipesDir(root)}/${fileName}`
}

interface DirEntryLite {
  name: string
  path: string
  is_dir?: boolean
  isDir?: boolean
  is_file?: boolean
  isFile?: boolean
}

function entryIsDir(e: DirEntryLite): boolean {
  if (typeof e.is_dir === 'boolean') return e.is_dir
  if (typeof e.isDir === 'boolean') return e.isDir
  return false
}

function entryIsFile(e: DirEntryLite): boolean {
  if (typeof e.is_file === 'boolean') return e.is_file
  if (typeof e.isFile === 'boolean') return e.isFile
  return !entryIsDir(e)
}

/**
 * 列出 recipes 目录里的 yaml 文件名（不含路径）。
 * 目录不存在时返回空数组——这是正常状态（用户还没建 recipe）。
 */
export async function listRecipeFiles(root: string): Promise<string[]> {
  const dir = recipesDir(root)
  let entries: DirEntryLite[] = []
  try {
    entries = (await invoke<DirEntryLite[]>('list_dir_any', { path: dir })) || []
  } catch {
    return []
  }
  return entries
    .filter((e) => entryIsFile(e) && YAML_EXT.test(String(e.name || '')))
    .map((e) => String(e.name))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 加载并解析全部 recipe。
 *
 * 单个文件出错不影响其它文件——出错的条目进 errors 列表，由调用方展示。
 * id 冲突时**保留先读到的**（按文件名排序），后来的记为错误，避免两个 recipe
 * 抢占同一个 id 导致行为不可预期。
 */
export async function loadRecipes(root: string): Promise<{
  recipes: Recipe[]
  errors: RecipeParseError[]
}> {
  const files = await listRecipeFiles(root)
  const recipes: Recipe[] = []
  const errors: RecipeParseError[] = []
  const seenIds = new Map<string, string>()

  for (const file of files) {
    const path = recipeFilePath(root, file)
    let text = ''
    try {
      text = await readTextFileAnySafe(path)
    } catch (e) {
      errors.push({ file, error: `读取失败：${(e as Error).message || String(e)}` })
      continue
    }
    try {
      const recipe = parseRecipeYaml(text, file)
      const prev = seenIds.get(recipe.id)
      if (prev) {
        errors.push({ file, error: `id "${recipe.id}" 与 ${prev} 重复，已跳过本文件` })
        continue
      }
      seenIds.set(recipe.id, file)
      recipes.push(recipe)
    } catch (e) {
      errors.push({ file, error: (e as Error).message || String(e) })
    }
  }

  return { recipes, errors }
}

/** 写入一个 recipe 文件（会自动建目录） */
export async function writeRecipeFile(root: string, fileName: string, text: string): Promise<void> {
  const dir = recipesDir(root)
  await ensureDir(dir)
  await writeTextFileAnySafe(recipeFilePath(root, fileName), text)
}

/** 追加一条运行记录到 runs.jsonl */
export async function appendRunRecord(root: string, record: RecipeRunRecord): Promise<void> {
  try {
    const dir = recipesDir(root)
    await ensureDir(dir)
    const line = JSON.stringify(record) + '\n'
    const path = runsFile(root)
    let prev = ''
    try {
      prev = await readTextFileAnySafe(path)
    } catch {
      prev = ''
    }
    await writeTextFileAnySafe(path, prev + line)
  } catch (e) {
    // 运行日志写失败不应影响任务本身
    console.warn('[recipes] 写入运行日志失败：', e)
  }
}

/** 读取最近的运行记录（按时间倒序，最多 limit 条） */
export async function readRunRecords(root: string, limit = 50): Promise<RecipeRunRecord[]> {
  let text = ''
  try {
    text = await readTextFileAnySafe(runsFile(root))
  } catch {
    return []
  }
  const out: RecipeRunRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object') out.push(obj as RecipeRunRecord)
    } catch {
      // 跳过坏行
    }
  }
  out.reverse()
  return out.slice(0, Math.max(1, limit))
}
