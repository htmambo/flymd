// Recipes 引擎：加载 recipe、按 cron / on-save 触发、调用 AI、写回结果、记运行日志。
//
// 设计文档：docs/Task/Active/2026-11-01-scheduled-ai-recipes.md
//
// 三条硬约束：
// 1. 写回必须先过写入护栏（ai_guard_snapshot）——快照失败即中止写入。
//    核心侧是异步的，所以能做到 MCP 那样的"失败即中止"，比插件侧的弱保证强。
// 2. 同一 recipe 正在执行时再次触发 → 直接跳过，不排队堆积。
// 3. 只订阅编辑器的保存事件，不订阅文件系统 watcher —— recipes 的输出是直接写文件，
//    不会触发保存事件，天然不存在"AI 写回 → 触发 on-save → 再写回"的循环。

import { invoke } from '@tauri-apps/api/core'
import { NotificationManager } from '../uiNotifications'
import { getLibraryScope, resolveLibraryPath, toLibraryRelativePath, LIBRARY_CHANGED_EVENT } from '../libraryConfig'
import { ensureDir, readTextFileAnySafe, writeTextFileAnySafe } from '../fsSafe'
import { nextCronTime, parseCron, type CronSpec } from './cron'
import { matchAnyGlob } from './glob'
import { loadRecipes, appendRunRecord, readRunRecords } from './store'
import { callAi, resolveAiSettings, type AiDeps } from './ai'
import {
  extractTodos,
  formatDate,
  formatDateTime,
  formatTime,
  formatWeekday,
  renderTemplate,
} from './vars'
import type { Recipe, RecipeParseError, RecipeRunRecord, RecipeView } from './types'

/** setTimeout 的单次上限（ms），约 24.8 天 */
const MAX_TIMEOUT_MS = 2_147_483_647

/** 定时器迟到容忍窗：超过就不补跑，直接排下一次 */
const DRIFT_TOLERANCE_MS = 120_000

/** on-save 默认防抖窗口 */
const DEFAULT_DEBOUNCE_MS = 3000

/** 摘要保留长度 */
const EXCERPT_LIMIT = 200

export interface RecipesEngineDeps extends AiDeps {
  /** 当前库根；不传则用 libraryConfig 的当前库 */
  getLibraryRoot?: () => string | null
  /** Tauri store（读 AI 助手配置） */
  getStore?: () => any | null
  /** 定时器注入（测试用） */
  setTimeoutFn?: (fn: () => void, ms: number) => any
  clearTimeoutFn?: (h: any) => void
  /** invoke 注入（测试用） */
  invokeImpl?: (cmd: string, args?: any) => Promise<any>
  /** 通知用户 */
  notify?: (message: string, type?: 'success' | 'error') => void
}

export interface RecipesEngine {
  /** 启动（加载 recipe + 排调度 + 订阅保存事件） */
  start(): void
  /** 停止 */
  stop(): void
  /** 重新加载 recipe（库切换 / 用户改了 yaml 后） */
  reload(): Promise<void>
  /** 列出 recipe（含下次触发时间） */
  list(): Promise<RecipeView[]>
  /** 列出解析错误 */
  listErrors(): Promise<RecipeParseError[]>
  /** 手动执行一次 */
  runNow(recipeId: string): Promise<RecipeRunRecord | null>
  /** 最近的运行记录 */
  getRuns(limit?: number): Promise<RecipeRunRecord[]>
  /** 外部（main.ts）转发的文件保存事件 */
  onFileSaved(path: string): void
  /** 库切换 */
  onLibraryChanged(root: string | null): void
}

interface ScheduleEntry {
  timer: any
  nextAt: number
}

function defaultSetTimeout(fn: () => void, ms: number): any {
  return setTimeout(fn, ms)
}

function defaultClearTimeout(h: any): void {
  clearTimeout(h)
}

function notifyUser(message: string, type: 'success' | 'error'): void {
  try {
    NotificationManager.show(type === 'error' ? 'plugin-error' : 'plugin-success', message, 2600)
  } catch {
    console.log('[recipes]', message)
  }
}

/** 取库根：优先用注入的，其次用 libraryConfig 的当前库 */
function resolveRoot(deps: RecipesEngineDeps): string | null {
  try {
    const injected = deps.getLibraryRoot?.()
    if (injected) return injected
  } catch {}
  try {
    return getLibraryScope().root
  } catch {
    return null
  }
}

/** 取库名（根目录的最后一段） */
function libraryName(root: string): string {
  const r = String(root || '').replace(/[\\/]+$/, '')
  return r.split(/[\\/]/).pop() || r
}

export function initRecipesEngine(deps: RecipesEngineDeps = {}): RecipesEngine {
  const setT = deps.setTimeoutFn || defaultSetTimeout
  const clearT = deps.clearTimeoutFn || defaultClearTimeout
  const doInvoke = deps.invokeImpl || ((cmd: string, args?: any) => invoke(cmd, args))
  const notify = deps.notify || notifyUser

  let started = false
  let recipes: Recipe[] = []
  let errors: RecipeParseError[] = []
  const schedules = new Map<string, ScheduleEntry>()
  /** 正在执行的 recipe id */
  const inFlight = new Set<string>()
  /** on-save 防抖：key = `${recipeId}|${relPath}` */
  const lastTrigger = new Map<string, number>()
  /** 引擎自己写过的路径 + 时间，窗口内忽略其保存事件 */
  const selfWrites = new Map<string, number>()

  function currentRoot(): string | null {
    return resolveRoot(deps)
  }

  // ---------- 调度 ----------

  function clearSchedules(): void {
    for (const entry of schedules.values()) {
      try { clearT(entry.timer) } catch {}
    }
    schedules.clear()
  }

  function arm(recipe: Recipe, spec: CronSpec, from: Date): void {
    const next = nextCronTime(spec, from)
    if (!next) return
    const delay = Math.max(0, next.getTime() - Date.now())
    const handle = setT(() => {
      void fireScheduled(recipe, spec, next)
    }, Math.min(delay, MAX_TIMEOUT_MS))
    schedules.set(recipe.id, { timer: handle, nextAt: next.getTime() })
  }

  async function fireScheduled(recipe: Recipe, spec: CronSpec, scheduledFor: Date): Promise<void> {
    const drift = Date.now() - scheduledFor.getTime()
    if (drift <= DRIFT_TOLERANCE_MS) {
      try {
        await runRecipe(recipe, 'schedule')
      } catch (e) {
        console.warn('[recipes] 定时任务执行失败：', e)
      }
    } else {
      console.warn(`[recipes] 定时任务「${recipe.name}」迟到 ${Math.round(drift / 1000)}s，跳过本次`)
    }
    // 从「原定时刻」往后排下一次，避免因为执行耗时而跳过一格
    arm(recipe, spec, scheduledFor)
  }

  function scheduleAll(): void {
    clearSchedules()
    const now = new Date()
    for (const recipe of recipes) {
      if (!recipe.enabled) continue
      if (recipe.trigger.type !== 'schedule') continue
      const cron = recipe.trigger.cron
      if (!cron) continue
      try {
        const spec = parseCron(cron)
        arm(recipe, spec, now)
      } catch (e) {
        console.warn(`[recipes] recipe「${recipe.name}」的 cron 无法解析：`, e)
      }
    }
  }

  // ---------- 变量 ----------

  async function listMarkdownRelPaths(root: string): Promise<string[]> {
    try {
      const abs = await doInvoke('flymd_list_markdown_files', { root })
      const list = Array.isArray(abs) ? abs : []
      const out: string[] = []
      for (const p of list) {
        const rel = toLibraryRelativePath(root, String(p))
        if (rel) out.push(rel)
      }
      out.sort()
      return out
    } catch (e) {
      console.warn('[recipes] 列出 markdown 文件失败：', e)
      return []
    }
  }

  async function buildVars(
    recipe: Recipe,
    root: string,
    triggerPath: string | null,
  ): Promise<Record<string, string>> {
    const now = new Date()
    const vars: Record<string, string> = {
      date: formatDate(now),
      time: formatTime(now),
      datetime: formatDateTime(now),
      weekday: formatWeekday(now),
      library: libraryName(root),
      file: '',
      content: '',
      todos: '',
      files: '',
    }

    let content = ''
    if (triggerPath) {
      vars.file = triggerPath
      try {
        content = await readTextFileAnySafe(resolveLibraryPath(root, triggerPath))
      } catch {
        content = ''
      }
      vars.content = content
      vars.todos = extractTodos(content)
    }

    // {{files}} 是全库扫描，只在真被引用时才付出这个代价
    if (/\{\{\s*files\s*\}\}/.test(recipe.prompt)) {
      const list = await listMarkdownRelPaths(root)
      vars.files = list.join('\n')
    }

    return vars
  }

  // ---------- 执行 ----------

  async function runRecipe(
    recipe: Recipe,
    trigger: 'schedule' | 'on-save' | 'manual',
    triggerPath: string | null = null,
  ): Promise<RecipeRunRecord> {
    const startedAt = Date.now()
    const root = currentRoot()

    const record: RecipeRunRecord = {
      ts: new Date(startedAt).toISOString(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      trigger,
      ok: false,
      durationMs: 0,
    }

    if (!root) {
      record.error = '没有可用的库根'
      record.durationMs = Date.now() - startedAt
      // 没有库根就没有地方写运行日志，直接返回
      return record
    }

    try {
      const vars = await buildVars(recipe, root, triggerPath)
      const rendered = renderTemplate(recipe.prompt, vars)
      if (rendered.unknown.length) {
        record.unknownVars = rendered.unknown
        console.warn(`[recipes] recipe「${recipe.name}」引用了未知变量：${rendered.unknown.join(', ')}`)
      }

      const settings = await resolveAiSettings(recipe, { ...deps, getStore: deps.getStore })
      const result = await callAi(
        { prompt: rendered.text, system: recipe.system, model: recipe.model },
        settings,
        deps,
      )

      record.excerpt = result.text.slice(0, EXCERPT_LIMIT)

      // 写回
      if (recipe.output.mode !== 'none' && recipe.output.path) {
        const written = await writeOutput(recipe, root, result.text, record)
        if (!written) {
          record.error = '写回失败（详见控制台）'
          record.durationMs = Date.now() - startedAt
          await appendRunRecord(root, record)
          return record
        }
      }

      record.ok = true
      record.durationMs = Date.now() - startedAt
      await appendRunRecord(root, record)
      // on-save 每保存一次就弹一次提示太吵，成功就静默（运行日志里有）；
      // 失败一律提示——那需要人管。
      if (trigger !== 'on-save') notify(`任务「${recipe.name}」已完成`, 'success')
      return record
    } catch (e) {
      record.error = (e as Error)?.message || String(e)
      record.durationMs = Date.now() - startedAt
      await appendRunRecord(root, record)
      console.warn(`[recipes] 任务「${recipe.name}」失败：`, e)
      notify(`任务「${recipe.name}」失败：${record.error}`, 'error')
      return record
    }
  }

  /**
   * 写回结果。**先过护栏建快照，快照失败即中止**。
   * 返回是否成功。
   */
  async function writeOutput(
    recipe: Recipe,
    root: string,
    aiText: string,
    record: RecipeRunRecord,
  ): Promise<boolean> {
    const rel = String(recipe.output.path || '')
    const abs = resolveLibraryPath(root, rel)

    // 目标可能落在尚不存在的子目录（如 AI/日报.md）——先建出来。
    // 否则 plugin-fs 的 writeFile 会失败再回落到 Rust 命令（那边会 create_dir_all），
    // 能写成功但多绕一圈，不如显式建好。
    const parent = abs.replace(/[\\/][^\\/]*$/, '')
    if (parent && parent !== abs) {
      try { await ensureDir(parent) } catch {}
    }

    let before = ''
    let existed = false
    try {
      before = await readTextFileAnySafe(abs)
      existed = true
    } catch {
      before = ''
      existed = false
    }

    let next: string
    if (recipe.output.mode === 'replace') {
      next = aiText
    } else {
      // note：追加
      const heading = recipe.output.heading === false ? '' : `## ${formatDateTime(new Date())}\n\n`
      const section = `${heading}${aiText}\n`
      next = existed ? `${before.replace(/\s*$/, '')}\n\n${section}` : section
    }

    // 护栏快照：失败即中止写入（核心侧可以 await，所以能做得到）
    try {
      const snap = await doInvoke('ai_guard_snapshot', {
        libraryRoot: root,
        path: abs,
        newContent: next,
        beforeContent: existed ? before : null,
        operation: 'recipe_write',
        actor: 'recipe',
        reason: recipe.name,
      })
      const id = snap && typeof snap === 'object' ? (snap as any).id : null
      if (id) record.snapshotId = String(id)
    } catch (e) {
      console.warn('[recipes] 写入快照失败，已中止写入：', e)
      throw new Error(`写入快照失败，已中止写入：${(e as Error)?.message || String(e)}`)
    }

    await writeTextFileAnySafe(abs, next)
    record.outputPath = rel
    // 记一笔自写，窗口内忽略该路径的保存事件（双保险）
    selfWrites.set(rel, Date.now())
    return true
  }

  // ---------- 对外接口 ----------

  async function reload(): Promise<void> {
    const root = currentRoot()
    if (!root) {
      recipes = []
      errors = []
      clearSchedules()
      return
    }
    const loaded = await loadRecipes(root)
    recipes = loaded.recipes
    errors = loaded.errors
    if (errors.length) {
      console.warn(
        `[recipes] ${errors.length} 个 recipe 解析失败：`,
        errors.map((e) => `${e.file} — ${e.error}`).join('; '),
      )
    }
    scheduleAll()
  }

  async function list(): Promise<RecipeView[]> {
    const out: RecipeView[] = recipes.map((r) => {
      const view: RecipeView = { ...r }
      const entry = schedules.get(r.id)
      if (entry) view.nextRunAt = new Date(entry.nextAt).toISOString()
      return view
    })
    // 解析失败的 recipe 也列出来（标记 broken），用户才能在界面上看到问题
    for (const err of errors) {
      out.push({
        id: '',
        name: err.file,
        enabled: false,
        trigger: { type: 'schedule' },
        prompt: '',
        output: { mode: 'none' },
        sourceFile: err.file,
        broken: true,
      })
    }
    return out
  }

  async function listErrors(): Promise<RecipeParseError[]> {
    return errors.slice()
  }

  async function runNow(recipeId: string): Promise<RecipeRunRecord | null> {
    const recipe = recipes.find((r) => r.id === recipeId)
    if (!recipe) return null
    return await runRecipe(recipe, 'manual')
  }

  async function getRuns(limit = 50): Promise<RecipeRunRecord[]> {
    const root = currentRoot()
    if (!root) return []
    return await readRunRecords(root, limit)
  }

  /**
   * 裁掉防抖表里已经过期的项。
   * 防抖窗口最长可能有几分钟，窗口外的记录留着没意义，只会占内存。
   */
  function pruneLastTrigger(now: number): void {
    if (lastTrigger.size < 512) return
    const staleBefore = now - 10 * 60_000
    for (const [k, t] of lastTrigger) {
      if (t < staleBefore) lastTrigger.delete(k)
    }
    // 极端情况下（短时间内触发过成千上万次）仍然超量：直接清空重来，
    // 代价只是下一轮防抖可能放行一次，优于无限增长。
    if (lastTrigger.size >= 512) lastTrigger.clear()
  }

  function onFileSaved(path: string): void {    const root = currentRoot()
    if (!root) return
    const rel = toLibraryRelativePath(root, path)
    if (!rel) return

    // 自写窗口内忽略（双保险；理论上 recipes 的直接写文件不触发保存事件）
    const selfAt = selfWrites.get(rel)
    if (selfAt !== undefined) {
      if (Date.now() - selfAt < 5000) return
      selfWrites.delete(rel)
    }

    for (const recipe of recipes) {
      if (!recipe.enabled) continue
      if (recipe.trigger.type !== 'on-save') continue
      if (!matchAnyGlob(recipe.trigger.paths, rel)) continue

      const debounce = Number(recipe.trigger.debounceMs ?? DEFAULT_DEBOUNCE_MS)
      const key = `${recipe.id}|${rel}`
      const last = lastTrigger.get(key)
      const now = Date.now()
      if (last !== undefined && now - last < debounce) continue
      lastTrigger.set(key, now)
      // 防抖表按 (recipe, 文件) 累积，长会话下会一直涨——顺手裁掉过期项
      pruneLastTrigger(now)

      void (async () => {
        if (inFlight.has(recipe.id)) return
        inFlight.add(recipe.id)
        try {
          await runRecipe(recipe, 'on-save', rel)
        } catch (e) {
          console.warn('[recipes] on-save 任务失败：', e)
        } finally {
          inFlight.delete(recipe.id)
        }
      })()
    }
  }

  function onLibraryChanged(root: string | null): void {
    void reload()
  }

  function start(): void {
    if (started) return
    started = true
    void reload()
    try {
      window.addEventListener('flymd-file-saved', (e: Event) => {
        const detail = (e as CustomEvent)?.detail
        const p = detail && typeof detail === 'object' ? (detail as any).path : null
        if (typeof p === 'string' && p) onFileSaved(p)
      })
    } catch (e) {
      console.warn('[recipes] 订阅保存事件失败：', e)
    }
    // 库切换：重新加载 recipe 并重排调度（recipe 集合是按库走的）
    try {
      window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
        void reload()
      })
    } catch (e) {
      console.warn('[recipes] 订阅库切换事件失败：', e)
    }
  }

  function stop(): void {
    started = false
    clearSchedules()
  }

  return {
    start,
    stop,
    reload,
    list,
    listErrors,
    runNow,
    getRuns,
    onFileSaved,
    onLibraryChanged,
  }
}
