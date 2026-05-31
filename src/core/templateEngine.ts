// 轻量级模板引擎：兼容 Templater 常用子集
// 支持 date / file / frontmatter / system 模块

export type TemplateVars = {
  fileName: string // 不含扩展名
  fileExt: string // 扩展名（不含点）
  fileTitle: string // 同 fileName，兼容 Templater 习惯
  now: Date
  filePath?: string // 文件绝对路径
  fileRelativePath?: string // 文件相对库根路径
  folderPath?: string // 文件夹绝对路径
  folderRelativePath?: string // 文件夹相对库根路径
  fileCreationDate?: Date
  fileModifiedDate?: Date
  frontmatter?: Record<string, any>
}

function applyDateOffset(date: Date, offset: string): Date {
  const result = new Date(date)
  const m = offset.match(/^P([+-]?\d+)([YMWD])$/i)
  if (!m) return result
  const num = parseInt(m[1], 10)
  const unit = m[2].toUpperCase()
  switch (unit) {
    case 'Y':
      result.setFullYear(result.getFullYear() + num)
      break
    case 'M':
      result.setMonth(result.getMonth() + num)
      break
    case 'W':
      result.setDate(result.getDate() + num * 7)
      break
    case 'D':
      result.setDate(result.getDate() + num)
      break
  }
  return result
}

function formatDate(date: Date, format: string): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const map: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    dddd: date.toLocaleDateString('zh-CN', { weekday: 'long' }),
    MMM: date.toLocaleDateString('zh-CN', { month: 'short' }),
  }
  let result = format
  const keys = Object.keys(map).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    result = result.replace(new RegExp(k, 'g'), map[k])
  }
  return result
}

async function evaluateExpression(expr: string, vars: TemplateVars): Promise<string> {
  // 兼容 Templater 的 tp. 前缀，如 tp.date.now → date.now
  let trimmed = expr.trim().replace(/^tp\./, '')
  // 统一把单引号参数转为双引号，简化正则匹配
  trimmed = trimmed.replace(/'([^']*)'/g, '"$1"')

  // date.now("format", offset?)  offset 支持数字（天数）或 ISO 8601 字符串
  const dateNowMatch = trimmed.match(
    /^date\.now\("([^"]+)"\s*(?:,\s*(-?\d+|"[^"]*"))?\)$/,
  )
  if (dateNowMatch) {
    const [, fmt, offsetStr] = dateNowMatch
    let d = new Date(vars.now)
    if (offsetStr) {
      if (offsetStr.startsWith('"')) {
        d = applyDateOffset(d, offsetStr.slice(1, -1))
      } else {
        d.setDate(d.getDate() + parseInt(offsetStr, 10))
      }
    }
    return formatDate(d, fmt)
  }

  // date.tomorrow("format")
  const dateTomorrowMatch = trimmed.match(/^date\.tomorrow\("([^"]+)"\)$/)
  if (dateTomorrowMatch) {
    const d = new Date(vars.now)
    d.setDate(d.getDate() + 1)
    return formatDate(d, dateTomorrowMatch[1])
  }

  // date.yesterday("format")
  const dateYesterdayMatch = trimmed.match(/^date\.yesterday\("([^"]+)"\)$/)
  if (dateYesterdayMatch) {
    const d = new Date(vars.now)
    d.setDate(d.getDate() - 1)
    return formatDate(d, dateYesterdayMatch[1])
  }

  // date.weekday("format", weekday)
  // weekday: 0=本周一, 6=本周日, 7=下周一, -1=上周日, -7=上周一
  const dateWeekdayMatch = trimmed.match(
    /^date\.weekday\("([^"]+)"\s*,\s*(-?\d+)\)$/,
  )
  if (dateWeekdayMatch) {
    const [, fmt, weekdayStr] = dateWeekdayMatch
    const weekday = parseInt(weekdayStr, 10)
    const d = new Date(vars.now)
    const currentDay = d.getDay() // 0=Sunday, 1=Monday, ...
    // 转换为周一为 0 的系统
    const currentWeekday = currentDay === 0 ? 6 : currentDay - 1
    const targetWeekday = ((weekday % 7) + 7) % 7
    const weekOffset = Math.floor(weekday / 7)
    const daysDiff = targetWeekday - currentWeekday + weekOffset * 7
    d.setDate(d.getDate() + daysDiff)
    return formatDate(d, fmt)
  }

  // file.name / file.basename / file.title
  if (
    trimmed === 'file.name' ||
    trimmed === 'file.basename' ||
    trimmed === 'file.title'
  ) {
    return vars.fileName
  }

  // file.ext
  if (trimmed === 'file.ext') return vars.fileExt

  // file.folder(absolute?)  absolute=true 时返回相对路径
  const folderMatch = trimmed.match(/^file\.folder\((true|false)?\)$/)
  if (folderMatch) {
    const absolute = folderMatch[1] === 'true'
    if (absolute) {
      return vars.folderRelativePath || ''
    }
    const folder = vars.folderRelativePath || vars.folderPath || ''
    return folder.split(/[\\/]/).pop() || ''
  }

  // file.path(relative?)  relative=true 时返回相对路径
  const pathMatch = trimmed.match(/^file\.path\((true|false)?\)$/)
  if (pathMatch) {
    const relative = pathMatch[1] === 'true'
    if (relative) {
      return vars.fileRelativePath || ''
    }
    return vars.filePath || ''
  }

  // file.creation_date("format")
  const creationDateMatch = trimmed.match(/^file\.creation_date\("([^"]+)"\)$/)
  if (creationDateMatch) {
    const d = vars.fileCreationDate || vars.now
    return formatDate(new Date(d), creationDateMatch[1])
  }

  // file.last_modified_date("format")
  const modifiedDateMatch = trimmed.match(
    /^file\.last_modified_date\("([^"]+)"\)$/,
  )
  if (modifiedDateMatch) {
    const d = vars.fileModifiedDate || vars.now
    return formatDate(new Date(d), modifiedDateMatch[1])
  }

  // frontmatter.<variable>
  const fmMatch = trimmed.match(/^frontmatter\.(.+)$/)
  if (fmMatch) {
    const key = fmMatch[1]
    if (vars.frontmatter && key in vars.frontmatter) {
      const val = vars.frontmatter[key]
      if (Array.isArray(val)) return val.join(', ')
      return String(val ?? '')
    }
    return ''
  }

  // system.clipboard()
  if (trimmed === 'system.clipboard()') {
    try {
      const text = await navigator.clipboard.readText()
      return text || ''
    } catch {
      return ''
    }
  }

  // system.prompt("text", "default")
  const promptMatch = trimmed.match(
    /^system\.prompt\("([^"]*)"(?:,\s*"([^"]*)")?\)$/,
  )
  if (promptMatch) {
    const text = promptMatch[1] || ''
    const defaultValue = promptMatch[2] || ''
    const result = prompt(text, defaultValue)
    return result || ''
  }

  return ''
}

/**
 * 从模板中提取 tp.filename=... 指令，返回提取出的文件名和清理后的模板。
 * - 值用 { } 包裹 → 内部是模板表达式，需要评估
 * - 值用 "..." 或 '...' 包裹 → 纯文本，直接去掉引号使用
 * - 无引号无花括号 → 纯文本，直接使用
 * 返回的文件名已清理非法字符。
 */
export async function extractFilenameFromTemplate(
  template: string,
  vars: TemplateVars,
): Promise<{ filename: string | null; cleanedTemplate: string }> {
  // tp.filename 必须独占一行，前面只能是空白字符（空格/制表符）
  // 匹配整行并在替换时连同换行符一起移除，确保生成的文档中不出现此行
  const regex = /^[ \t]*<%\s*tp\.filename\s*=\s*(.+?)\s*%>[ \t]*(?:\r?\n|$)/m
  const match = template.match(regex)
  if (!match) {
    return { filename: null, cleanedTemplate: template }
  }

  const valueExpr = match[1].trim()
  let rawValue = valueExpr

  // 处理 { ... } 包装 → 内部支持模板子串（含 <% %> 标签）或单个表达式
  if (valueExpr.startsWith('{') && valueExpr.endsWith('}')) {
    const inner = valueExpr.slice(1, -1).trim()
    if (/<%\s*[\s\S]+?\s*%>/.test(inner)) {
      // 包含模板标签，用 renderTemplate 渲染混合文本
      rawValue = await renderTemplate(inner, vars)
    } else {
      // 单个表达式
      rawValue = await evaluateExpression(inner, vars)
    }
  } else {
    // 去掉外层引号（支持单/双引号）
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1)
    }
    // 纯文本，无需评估
  }

  // 清理文件名非法字符
  if (rawValue) {
    rawValue = rawValue
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // 从模板中移除 tp.filename 指令
  const cleanedTemplate = template.replace(regex, '')

  return {
    filename: rawValue || null,
    cleanedTemplate,
  }
}

export async function renderTemplate(
  template: string,
  vars: TemplateVars,
): Promise<string> {
  const regex = /<%\s*([\s\S]+?)\s*%>/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(template)) !== null) {
    result += template.slice(lastIndex, match.index)
    const replacement = await evaluateExpression(match[1], vars)
    result += replacement
    lastIndex = regex.lastIndex
  }
  result += template.slice(lastIndex)
  return result
}
