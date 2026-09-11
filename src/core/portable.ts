/**
 * 便携模式模块
 * 从 main.ts 拆分，支持便携式配置的导入导出
 *
 * 重要语义（PR-6 库私有化 v2 修订）：
 * - 便携模式备份**仅打包全局**（主题/字号/快捷键/全局扩展/全局偏好），
 *   **不** 包含任何库的内容（库内配置 .flymd/config.json / .flymd/local.json 跟库走）
 * - 用户若需导出单库配置，应走"库设置 → 导出此库配置"独立入口
 *   （由 libraryExport.ts 实现,见 ui/librarySettingsDialog.ts）
 */

import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { collectConfigBackupFiles, CONFIG_BACKUP_VERSION, type ConfigBackupPayload } from './configBackup'

// 便携模式备份文件名
export const PORTABLE_BACKUP_FILENAME = 'flymd-portable.flymdconfig'

export function getPortableBaseDir(): BaseDirectory {
  const anyBase = BaseDirectory as any
  return anyBase?.App ?? anyBase?.Resource ?? BaseDirectory.AppLocalData
}

let _portableDirAbs: string | null | undefined
export async function getPortableDirAbsolute(): Promise<string | null> {
  if (typeof _portableDirAbs !== 'undefined') return _portableDirAbs
  try {
    const mod: any = await import('@tauri-apps/api/path')
    if (mod?.executableDir) {
      const dir = await mod.executableDir()
      if (dir && typeof dir === 'string') {
        _portableDirAbs = dir.replace(/[\\/]+$/, '')
        return _portableDirAbs
      }
    }
  } catch {}
  _portableDirAbs = null
  return _portableDirAbs
}

export function joinPortableFile(dir: string | null): string | null {
  if (!dir) return null
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir + sep + PORTABLE_BACKUP_FILENAME
}

export async function exportPortableBackupSilent(): Promise<boolean> {
  try {
    // PR-6: 便携模式仅备份全局。不传 includeLibraries,显式声明语义。
    const { files } = await collectConfigBackupFiles()
    if (!files.length) return false
    const payload: ConfigBackupPayload = {
      version: CONFIG_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      files
    }
    const absDir = await getPortableDirAbsolute()
    const targetAbs = joinPortableFile(absDir)
    if (targetAbs) {
      await writeTextFile(targetAbs as any, JSON.stringify(payload))
    } else {
      await writeTextFile(PORTABLE_BACKUP_FILENAME as any, JSON.stringify(payload), { baseDir: getPortableBaseDir() } as any)
    }
    return true
  } catch (err) {
    console.warn('[Portable] 导出失败', err)
    return false
  }
}

export async function readPortableBackupPayload(): Promise<ConfigBackupPayload | null> {
  try {
    let text: string | null = null
    const absDir = await getPortableDirAbsolute()
    const targetAbs = joinPortableFile(absDir)
    if (targetAbs) {
      const absExists = await exists(targetAbs as any)
      if (absExists) {
        text = await readTextFile(targetAbs as any)
      }
    }
    if (!text) {
      const existsFile = await exists(PORTABLE_BACKUP_FILENAME as any, { baseDir: getPortableBaseDir() } as any)
      if (!existsFile) return null
      text = await readTextFile(PORTABLE_BACKUP_FILENAME as any, { baseDir: getPortableBaseDir() } as any)
    }
    if (!text) return null
    const payload = JSON.parse(text) as ConfigBackupPayload
    if (!payload || !Array.isArray(payload.files)) return null
    return payload
  } catch (err) {
    console.warn('[Portable] 读取便携备份失败', err)
    return null
  }
}
