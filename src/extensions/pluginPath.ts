// 插件安装路径净化。
//
// 所有来自 manifest / 本地目录的路径输入都必须先过这里：
// - id 进入 `${PLUGINS_DIR}/${id}` 与 Store key；
// - main / assets 进入下载 URL、写入路径与激活时的读取路径。
//
// 攻击面：`id: "../../../.bashrc"`、`main: "..\\..\\x"`、`assets: ["C:/x"]`、
// Windows ADS（`a:b`）与 NUL 字节。这里按“段”校验后重新拼接，拒绝绝对路径。

const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// Windows 设备名：CON / NUL / COM1 / LPT1 等（含带扩展名的形式，如 CON.js）
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function assertSafeSegment(part: string, input: string): void {
  if (part === '.' || part === '..') {
    throw new Error(`插件路径包含非法段: ${input}`)
  }
  if (
    part.includes(':') ||
    part.includes('\0') ||
    /[\x00-\x1f<>"|?*#]/.test(part) ||
    // 百分号编码的 .. / 分隔符：Tauri fs 不解码，但 URL 下载会，做纵深防御
    /%2e|%2f/i.test(part)
  ) {
    throw new Error(`插件路径包含非法字符: ${input}`)
  }
  // Windows 会去掉结尾的点/空格，可能导致目录别名（如 ai-assistant. 命中 ai-assistant）
  if (part.endsWith('.') || part.endsWith(' ')) {
    throw new Error(`插件路径不能以点或空格结尾: ${input}`)
  }
  if (WIN_RESERVED_RE.test(part)) {
    throw new Error(`插件路径使用了 Windows 保留名: ${input}`)
  }
}

/** 插件 id：字母/数字开头，允许 . _ -，长度 1-64，拒绝 `..` 与 Windows 保留名。 */
export function sanitizePluginId(raw: unknown): string {
  const id = String(raw ?? '').trim()
  if (!PLUGIN_ID_RE.test(id) || id.includes('..')) {
    throw new Error(`插件 id 非法（只允许字母/数字开头，含 . _ -，长度 1-64）: ${id || '(空)'}`)
  }
  assertSafeSegment(id, id)
  return id
}

/**
 * 插件内相对路径（main / assets）：`\` 归一为 `/`，去掉前导分隔符，
 * 拒绝 `.`/`..` 段、盘符/ADS 冒号、NUL。允许 Unicode 文件名与子目录。
 * 空输入返回 fallback（assets 可传 '' 表示跳过）。
 */
export function sanitizePluginRelPath(raw: unknown, fallback = 'main.js'): string {
  const input = String(raw ?? '').trim().replace(/\\/g, '/')
  if (!input) return fallback
  const parts = input.split('/').filter((p) => p.length > 0)
  if (!parts.length) return fallback
  for (const part of parts) {
    assertSafeSegment(part, input)
  }
  return parts.join('/')
}

/** 本地安装时 readDir 返回的单段条目名：不得含分隔符、`.`/`..`、冒号或 NUL。 */
export function sanitizePluginEntryName(raw: unknown): string {
  const name = String(raw ?? '')
  if (!name || name.includes('/') || name.includes('\\')) {
    throw new Error(`插件目录条目名非法: ${name || '(空)'}`)
  }
  assertSafeSegment(name, name)
  return name
}
