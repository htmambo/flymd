// 单段文件名 / 文件夹名校验。
//
// 库内新建与重命名都是 `dir + sep + name` 拼接。name 来自模板（tp.filename）、
// 重命名对话框或后续自动化调用，可能含路径分隔符、`..`、盘符冒号（Windows 上
// baseDir.join(绝对路径) 会替换 base）或控制字符——一旦放行就会写到库外。
//
// 约定：只校验单段名；完整路径的越界判断仍由 isInside / Rust 侧负责。

/**
 * 校验并返回可安全拼接的单段名。不安全时抛错（调用方负责提示）。
 * 不做 trim：前后空格在 POSIX 是合法字符，保持调用方原样。
 */
export function assertSafeEntryName(name: unknown): string {
  const raw = String(name ?? '')
  if (!raw.trim()) throw new Error('名称不能为空')
  if (raw === '.' || raw === '..') throw new Error(`名称非法: ${raw}`)
  if (/[\\/]/.test(raw)) throw new Error(`名称不能包含路径分隔符: ${raw}`)
  if (raw.includes(':') || /[\x00-\x1f]/.test(raw)) throw new Error(`名称包含非法字符: ${raw}`)
  return raw
}
