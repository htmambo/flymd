// 库级文件夹模板配置管理
// 配置文件存储于 <库根>/.flymd/folder-templates.json
// 读写使用后端兜底命令，绕过 Tauri 前端 fs 权限限制

import { readDir, stat } from '@tauri-apps/plugin-fs'
import { readTextFileAnySafe, writeTextFileAnySafe } from './fsSafe'

export type FolderTemplateConfig = {
  folderPath: string // 相对库根的路径，如 "稿费/每月"
  templatePath: string // 相对库根的路径，如 "Templates/每月稿费.md"
}

const CONFIG_DIR = '.flymd'
const CONFIG_FILE = 'folder-templates.json'

function normalizeRelativePath(p: string): string {
  return p
    .replace(/^[\\/]+/, '')
    .replace(/[\\]+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

export async function getFolderTemplates(root: string): Promise<FolderTemplateConfig[]> {
  try {
    const path = root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR + '/' + CONFIG_FILE
    const text = await readTextFileAnySafe(path)
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item: any) =>
        item &&
        typeof item.folderPath === 'string' &&
        typeof item.templatePath === 'string',
    )
  } catch {
    return []
  }
}

export async function saveFolderTemplates(
  root: string,
  configs: FolderTemplateConfig[],
): Promise<void> {
  const path = root.replace(/[\\/]+$/, '') + '/' + CONFIG_DIR + '/' + CONFIG_FILE
  const safe = configs.map((c) => ({
    folderPath: normalizeRelativePath(c.folderPath),
    templatePath: normalizeRelativePath(c.templatePath),
  }))
  const text = JSON.stringify(safe, null, 2)
  await writeTextFileAnySafe(path, text)
}

export async function findTemplateForFolder(
  root: string,
  folderPath: string,
): Promise<FolderTemplateConfig | null> {
  const configs = await getFolderTemplates(root)
  const normalizedTarget = normalizeRelativePath(folderPath).toLowerCase()
  if (!normalizedTarget) return null

  let bestMatch: FolderTemplateConfig | null = null
  let bestLen = -1

  for (const cfg of configs) {
    const normalizedFolder = normalizeRelativePath(cfg.folderPath).toLowerCase()
    if (!normalizedFolder) continue
    if (
      normalizedTarget === normalizedFolder ||
      normalizedTarget.startsWith(normalizedFolder + '/')
    ) {
      if (normalizedFolder.length > bestLen) {
        bestLen = normalizedFolder.length
        bestMatch = cfg
      }
    }
  }

  return bestMatch
}

export async function resolveTemplateContent(
  root: string,
  templatePath: string,
): Promise<string | null> {
  try {
    const path =
      root.replace(/[\\/]+$/, '') + '/' + normalizeRelativePath(templatePath)
    return await readTextFileAnySafe(path)
  } catch {
    return null
  }
}

export async function scanLibraryForFoldersAndTemplates(
  root: string,
): Promise<{ folders: string[]; templates: string[] }> {
  const folders: string[] = ['']
  const templates: string[] = ['']
  const base = root.replace(/[\\/]+$/, '')
  const sep = base.includes('\\') ? '\\' : '/'

  async function walk(dir: string): Promise<void> {
    let entries: any[] = []
    try {
      entries = (await readDir(dir, { recursive: false } as any)) as any[]
    } catch {
      return
    }
    for (const entry of entries || []) {
      const name = String((entry as any)?.name || '')
      if (!name || name === '.flymd') continue
      const full =
        typeof (entry as any)?.path === 'string' && (entry as any)?.path
          ? (entry as any)?.path
          : dir + sep + name
      let isDir =
        (entry as any)?.isDirectory !== undefined
          ? !!(entry as any)?.isDirectory
          : false
      if ((entry as any)?.isDirectory === undefined) {
        try {
          const st = (await stat(full as any)) as any
          isDir = !!st?.isDirectory
        } catch {
          isDir = false
        }
      }
      const rel = full.substring(base.length + 1).replace(/\\/g, '/')
      if (isDir) {
        folders.push(rel)
        await walk(full)
      } else if (name.toLowerCase().endsWith('.md')) {
        templates.push(rel)
      }
    }
  }

  await walk(base)
  folders.sort((a, b) => a.localeCompare(b, 'zh'))
  templates.sort((a, b) => a.localeCompare(b, 'zh'))
  return { folders, templates }
}
