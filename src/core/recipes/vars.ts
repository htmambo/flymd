// prompt 模板变量渲染。
//
// 占位符形式：`{{name}}`。允许变量名两侧有空白（`{{ date }}`）。
// 未知变量替换为空串，并把名字收集起来交给调用方记进运行日志——
// 静默吞掉一个拼错的变量名，用户只会觉得"AI 好像没读到我的数据"。

export interface RecipeVars {
  [key: string]: string
}

export interface RenderResult {
  /** 渲染后的文本 */
  text: string
  /** 出现过的未知变量名（去重） */
  unknown: string[]
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

/** 渲染模板。vars 里没有的变量会被替换为空串并记入 unknown。 */
export function renderTemplate(template: string, vars: RecipeVars): RenderResult {
  const source = String(template ?? '')
  const unknown: string[] = []
  const seen = new Set<string>()

  const text = source.replace(PLACEHOLDER, (_match, name: string) => {
    const key = String(name)
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key]
      return v === undefined || v === null ? '' : String(v)
    }
    if (!seen.has(key)) {
      seen.add(key)
      unknown.push(key)
    }
    return ''
  })

  return { text, unknown }
}

/** 本地日期 YYYY-MM-DD */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 本地时间 HH:mm:ss */
export function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${mi}:${s}`
}

/** 本地日期时间 YYYY-MM-DD HH:mm:ss */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`
}

const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 星期（中文） */
export function formatWeekday(d: Date): string {
  return WEEKDAY_ZH[d.getDay()] ?? ''
}

/**
 * 提取 markdown 里未完成的待办项（`- [ ] xxx`）。
 * 顺带把已完成的（`- [x]`）排除掉——recipe 想拿的是"还没做的事"。
 */
export function extractTodos(content: string): string {
  const text = String(content ?? '')
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[-*+]\s+\[([^\]])\]\s*(.+)$/.exec(line)
    if (!m) continue
    const mark = String(m[1] || '').trim().toLowerCase()
    if (mark === 'x' || mark === 'X') continue
    const body = String(m[2] || '').trim()
    if (body) out.push(body)
  }
  return out.join('\n')
}
