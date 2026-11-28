// 文件/目录打开的受控入口。
//
// 背景：capability 里 `opener:allow-open-path` 的 scope 曾是 `**`，等价于
// “以系统默认程序打开任意路径”的原语（Linux 上可触发 .desktop、Windows 上可触发 .exe）。
// 现在前端不再持有该权限，统一调用 Rust 的 open_path_guarded：
// - 目录：交给文件管理器；
// - 文件：扩展名白名单（文档/图片/音视频）；
// - 安装包：只允许 Downloads / temp。
import { invoke } from '@tauri-apps/api/core'

export async function openPathGuarded(path: string): Promise<void> {
  const p = String(path || '')
  if (!p) throw new Error('openPathGuarded: path 为空')
  await invoke('open_path_guarded', { path: p })
}
