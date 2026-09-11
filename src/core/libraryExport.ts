// 库私有化 v2 - PR-6: 库配置导出 helper
//
// 区别于便携模式(只备份全局),库配置导出针对单库,支持两种模式:
//   - 不含凭据:仅打包 .flymd/config.json (通道 A,共享段)
//   - 含凭据:再附加 .flymd/local.json (通道 C,需二次确认)
//
// 输出格式复用 ConfigBackupPayload(同 .flymdconfig 文件格式),
// 路径前缀 libraryConfig:<libId>/... + libraryLocal:<libId>/...
// 便于 restore 时按 libId 还原到对应库。
//
// 详见 docs/Task/Archive/2026-09/2026-09-11-library-private-v2-pr6-portable-backup.md

import { writeTextFile, readFile, exists } from '@tauri-apps/plugin-fs'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { collectConfigBackupFiles, CONFIG_BACKUP_VERSION, type ConfigBackupPayload, type LibraryBackupSpec } from './configBackup'
import { formatBackupTimestamp } from './configBackup'

export type LibraryExportMode = 'noCredentials' | 'withCredentials'

export interface LibraryExportResult {
  /** 导出文件路径（用户选择的位置） */
  path: string
  /** 包含的库 id */
  libId: string
  /** 模式 */
  mode: LibraryExportMode
  /** 实际打包的文件数 */
  fileCount: number
}

/**
 * 导出指定库的配置(.flymdconfig 格式)。
 * - mode='noCredentials' → 仅 config.json(通道 A)
 * - mode='withCredentials' → config.json + local.json(通道 C,凭据敏感)
 *
 * 默认通过 Tauri save dialog 让用户选择保存位置;
 * 也可传入 `targetPath` 跳过 dialog(测试用)。
 */
export async function exportLibraryConfig(opts: {
  libId: string
  libRoot: string
  mode: LibraryExportMode
  /** 跳过 dialog,直接写到该路径（测试用） */
  targetPath?: string
}): Promise<LibraryExportResult | null> {
  if (!opts.libId || !opts.libRoot) return null
  const spec: LibraryBackupSpec = {
    id: opts.libId,
    root: opts.libRoot,
    includeCredentials: opts.mode === 'withCredentials',
  }
  const { files } = await collectConfigBackupFiles({ includeLibraries: [spec] })
  if (files.length === 0) return null

  const payload: ConfigBackupPayload = {
    version: CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    files,
  }
  const ts = formatBackupTimestamp(new Date())
  const suffix = opts.mode === 'withCredentials' ? 'with-creds' : 'no-creds'
  const defaultName = `flymd-library-${opts.libId}-${ts}-${suffix}.flymdconfig`

  // 选择保存路径
  let target: string | undefined = opts.targetPath
  if (!target) {
    try {
      const picked = await saveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'flymd 配置', extensions: ['flymdconfig'] }],
      })
      target = picked ?? undefined
    } catch {
      target = undefined
    }
  }
  if (!target) return null

  await writeTextFile(target as any, JSON.stringify(payload, null, 2))
  return {
    path: target,
    libId: opts.libId,
    mode: opts.mode,
    fileCount: files.length,
  }
}

/**
 * 探测库内是否含凭据（local.json 存在且非空）。
 * 用于导出前判断是否需要"含凭据"选项。
 */
export async function hasLibraryCredentials(libRoot: string): Promise<boolean> {
  try {
    const path = `${libRoot.replace(/[\\/]+$/, '')}/.flymd/local.json`
    if (!(await exists(path as any))) return false
    const data = await readFile(path as any)
    return data.length > 10  // "{}" 视为无凭据
  } catch {
    return false
  }
}
