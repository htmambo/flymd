// 5 段 cron 表达式解析与「下次触发时间」计算。
//
// 格式：分 时 日 月 周（标准 5 段式，不是 Quartz 的 6/7 段）。
// 支持：`*`、`a`、`a-b`、`a-b/s`、`*/s`、逗号列表。
// 宏：@yearly / @annually / @monthly / @weekly / @daily / @midnight / @hourly。
//
// 语义遵循标准 cron：日与周**同时**被限定时取 OR（任一匹配即触发）；
// 只限定其一时按该字段匹配；都未限定（都是 `*`）则每天都匹配。
//
// 全部为纯函数，便于单测。

export interface CronSpec {
  /** 0-59 */
  minutes: number[]
  /** 0-23 */
  hours: number[]
  /** 1-31 */
  days: number[]
  /** 1-12 */
  months: number[]
  /** 0-6，0=周日（输入里的 7 归一化成 0） */
  weekdays: number[]
  /** 日字段是否被限定（非 `*`） */
  domRestricted: boolean
  /** 周字段是否被限定（非 `*`） */
  dowRestricted: boolean
}

interface FieldRange {
  min: number
  max: number
}

const FIELD_MINUTE: FieldRange = { min: 0, max: 59 }
const FIELD_HOUR: FieldRange = { min: 0, max: 23 }
const FIELD_DOM: FieldRange = { min: 1, max: 31 }
const FIELD_MONTH: FieldRange = { min: 1, max: 12 }
const FIELD_DOW: FieldRange = { min: 0, max: 7 }

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

function cronError(message: string): Error {
  return new Error(`cron 表达式非法：${message}`)
}

function expandRange(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(v)
  return out
}

/**
 * 解析单个字段。
 * 返回取��后的数值集合，以及该字段是否被限定（不是 `*`）。
 */
function parseField(
  raw: string,
  range: FieldRange,
  fieldName: string,
): { values: number[]; restricted: boolean } {
  const text = String(raw ?? '').trim()
  if (!text) throw cronError(`${fieldName} 段为空`)

  if (text === '*') {
    const values = expandRange(range.min, range.max, 1)
    return { values, restricted: false }
  }

  const values = new Set<number>()
  for (const rawPart of text.split(',')) {
    const part = rawPart.trim()
    if (!part) throw cronError(`${fieldName} 段存在空项（"${text}"）`)

    let step = 1
    let body = part
    const slashAt = part.indexOf('/')
    if (slashAt >= 0) {
      body = part.slice(0, slashAt).trim()
      const stepText = part.slice(slashAt + 1).trim()
      if (!/^\d+$/.test(stepText)) throw cronError(`${fieldName} 段步长非法（"${part}"）`)
      step = parseInt(stepText, 10)
      if (step <= 0) throw cronError(`${fieldName} 段步长必须为正（"${part}"）`)
      if (!body) throw cronError(`${fieldName} 段步长缺少范围（"${part}"）`)
    }

    if (body === '*') {
      for (const v of expandRange(range.min, range.max, step)) values.add(v)
      continue
    }

    if (/^\d+$/.test(body)) {
      const from = parseInt(body, 10)
      if (from < range.min || from > range.max) {
        throw cronError(`${fieldName} 段取值越界（${from}，允许 ${range.min}-${range.max}）`)
      }
      // 裸数字带步长：从该值起按步长递增到上界（cron 的 `5/2` 语义）
      const to = step > 1 ? range.max : from
      for (const v of expandRange(from, to, step)) values.add(v)
      continue
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(body)
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10)
      const to = parseInt(rangeMatch[2], 10)
      if (from < range.min || from > range.max || to < range.min || to > range.max) {
        throw cronError(`${fieldName} 段范围越界（"${body}"，允许 ${range.min}-${range.max}）`)
      }
      if (from > to) throw cronError(`${fieldName} 段范围起点大于终点（"${body}"）`)
      for (const v of expandRange(from, to, step)) values.add(v)
      continue
    }

    throw cronError(`${fieldName} 段无法解析（"${part}"）`)
  }

  return { values: Array.from(values).sort((a, b) => a - b), restricted: true }
}

/**
 * 解析 5 段 cron 表达式。失败抛带中文说明的 Error。
 */
export function parseCron(expr: string): CronSpec {
  let text = String(expr ?? '').trim()
  if (!text) throw cronError('表达式为空')

  const macro = MACROS[text.toLowerCase()]
  if (macro) text = macro

  const parts = text.split(/\s+/)
  if (parts.length !== 5) {
    throw cronError(`应为 5 段（分 时 日 月 周），实际 ${parts.length} 段`)
  }

  const minute = parseField(parts[0], FIELD_MINUTE, '分钟')
  const hour = parseField(parts[1], FIELD_HOUR, '小时')
  const dom = parseField(parts[2], FIELD_DOM, '日')
  const month = parseField(parts[3], FIELD_MONTH, '月')
  const dow = parseField(parts[4], FIELD_DOW, '周')

  // 周字段的 7 归一化成 0（周日），然后去重
  const weekdays = Array.from(new Set(dow.values.map((v) => (v === 7 ? 0 : v)))).sort((a, b) => a - b)

  return {
    minutes: minute.values,
    hours: hour.values,
    days: dom.values,
    months: month.values,
    weekdays,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  }
}

/** 判断某个时刻是否命中该 cron 表达式 */
export function cronMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.minutes.includes(date.getMinutes())) return false
  if (!spec.hours.includes(date.getHours())) return false
  if (!spec.months.includes(date.getMonth() + 1)) return false

  const domOk = spec.days.includes(date.getDate())
  const dowOk = spec.weekdays.includes(date.getDay())

  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk
  if (spec.domRestricted) return domOk
  if (spec.dowRestricted) return dowOk
  return true
}

/** 最大向前搜索天数（约 5 年，够覆盖「每年一次」的表达式） */
const MAX_LOOKAHEAD_DAYS = 366 * 5

/**
 * 计算严格晚于 from 的下一次触发时刻。
 * `from` 精确到秒（例如 09:00:30）时，09:00 这一分钟视为已过。
 * 找不到（理论上不会发生）返回 null。
 */
export function nextCronTime(spec: CronSpec, from: Date): Date | null {
  // 阈值：from 截断到分钟，且必须严格大于它
  const threshold = new Date(from.getTime())
  threshold.setSeconds(0, 0)

  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())

  for (let day = 0; day < MAX_LOOKAHEAD_DAYS; day++) {
    const monthOk = spec.months.includes(cursor.getMonth() + 1)
    const domOk = spec.days.includes(cursor.getDate())
    const dowOk = spec.weekdays.includes(cursor.getDay())

    let dayOk: boolean
    if (spec.domRestricted && spec.dowRestricted) dayOk = domOk || dowOk
    else if (spec.domRestricted) dayOk = domOk
    else if (spec.dowRestricted) dayOk = dowOk
    else dayOk = true

    if (monthOk && dayOk) {
      for (const h of spec.hours) {
        for (const m of spec.minutes) {
          const candidate = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate(),
            h,
            m,
            0,
            0,
          )
          if (candidate.getTime() > threshold.getTime()) return candidate
        }
      }
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  }

  return null
}
