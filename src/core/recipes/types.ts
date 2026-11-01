// Recipes（定时/触发式 AI 任务）的类型定义。
//
// 设计文档：docs/Task/Active/2026-11-01-scheduled-ai-recipes.md
//
// 这里的类型同时描述「YAML 文件长什么样」与「运行时引擎消费什么」，
// 两者刻意保持同一形状——解析阶段把 YAML 规范化成 Recipe，运行期不再做额外转换。

/** 触发方式 */
export type RecipeTriggerType = 'schedule' | 'on-save'

/** 触发器配置 */
export interface RecipeTrigger {
  type: RecipeTriggerType
  /** schedule：5 段 cron 表达式（分 时 日 月 周） */
  cron?: string
  /** on-save：路径 glob 列表（相对库根，/ 分隔）。空/缺省 = 匹配全部 */
  paths?: string[]
  /** on-save：同一文件在窗口内的防抖间隔（毫秒），默认 3000 */
  debounceMs?: number
}

/** 输出方式 */
export type RecipeOutputMode = 'none' | 'note' | 'replace'

/** 输出配置 */
export interface RecipeOutput {
  /** none=不落盘（只记运行日志）；note=追加；replace=覆盖 */
  mode: RecipeOutputMode
  /** 目标笔记（库内相对路径），mode≠none 时必填 */
  path?: string
  /** note 模式是否加分隔标题与时间戳，默认 true */
  heading?: boolean
}

/** recipe 内联 AI 配置（覆盖全局/AI 助手配置） */
export interface RecipeAiOverride {
  baseUrl?: string
  apiKey?: string
  model?: string
  /** 免费模型档位：qwen | gemini | glm */
  freeModel?: string
}

/** 一条 recipe */
export interface Recipe {
  /** 库内唯一标识 */
  id: string
  /** 展示名 */
  name: string
  /** 是否启用，默认 true */
  enabled: boolean
  trigger: RecipeTrigger
  /** 提示词正文，支持 {{变量}} */
  prompt: string
  /** system 提示词，可选 */
  system?: string
  /** 覆盖默认模型，可选 */
  model?: string
  /** 覆盖 AI 配置，可选 */
  ai?: RecipeAiOverride
  output: RecipeOutput
  /** 来源文件名（相对 recipes 目录），运行时填充 */
  sourceFile?: string
}

/** recipe 文件解析失败信息 */
export interface RecipeParseError {
  /** 出错文件名（相对 recipes 目录） */
  file: string
  /** 可读的错误说明 */
  error: string
}

/** 单次执行的运行记录（runs.jsonl 的一行） */
export interface RecipeRunRecord {
  /** ISO 时间戳 */
  ts: string
  recipeId: string
  recipeName: string
  /** 触发来源：schedule | on-save | manual */
  trigger: string
  ok: boolean
  durationMs: number
  /** 失败原因 */
  error?: string
  /** 写入的目标笔记（库内相对路径） */
  outputPath?: string
  /** 写入护栏快照 id，可用 rollback_write 回滚 */
  snapshotId?: string
  /** AI 输出摘要（前若干字） */
  excerpt?: string
  /** 未知模板变量名 */
  unknownVars?: string[]
}

/** 引擎对外暴露的 recipe 视图（附加运行态信息） */
export interface RecipeView extends Recipe {
  /** 下次触发时间（ISO），schedule 才有 */
  nextRunAt?: string
  /** 该 recipe 是否因解析错误被跳过 */
  broken?: boolean
}
