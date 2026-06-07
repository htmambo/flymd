// 库内文件安全删除 + 安全新建
// 抽离自 main.ts:7184-7262。
// 抽离理由:本块是纯 FS 助手,无 main-local 闭包依赖;只依赖
// @tauri-apps/api/core 的 invoke 和 @tauri-apps/plugin-fs 的 exists/remove/stat/readDir/writeTextFile
// 以及 core/fsSafe 的 ensureDir。属于"通用能力",抽到 core/。
// 行为保留:
// - deleteFileSafe 优先 move_to_trash(回收站),失败回退到 remove + 递归 + force_remove_path,带 3 次重试
// - newFileSafe 自动选 separator、避免文件名冲突(末尾加 " N"),确保父目录存在,默认内容 "# 标题\n\n"

import { invoke } from '@tauri-apps/api/core'
import { exists, readDir, remove, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { ensureDir } from './fsSafe'

/**
 * 安全删除文件/目录。
 * 优先尝试移至回收站(macOS/Windows);若为目录或回收站失败,递归删除子项后用 force_remove_path 兜底;3 次重试。
 * @param p 绝对路径
 * @param permanent true 时跳过回收站直接物理删除
 */
export async function deleteFileSafe(p: string, permanent = false): Promise<void> {
  // 第一步:尝试移至回收站(如果不是永久删除)
  if (!permanent && typeof invoke === 'function') {
    try {
      await invoke('move_to_trash', { path: p })
      // 验证删除是否成功
      const stillExists = await exists(p)
      if (!stillExists) return
    } catch {
      // 失败,继续走永久删除路径
    }
  }

  // 第二步:永久删除(带重试机制)
  const maxRetries = 3
  let lastError: any = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await remove(p)

      const stillExists = await exists(p)
      if (!stillExists) return

      // 文件仍存在,可能需要递归删除目录
      const st: any = await stat(p)
      if (st?.isDirectory) {
        const ents = (await readDir(p, { recursive: false } as any)) as any[]
        for (const it of ents) {
          const child = typeof it?.path === 'string' ? it.path : (p + (p.includes('\\') ? '\\' : '/') + (it?.name || ''))
          await deleteFileSafe(child, true) // 递归时直接永久删除
        }
        await remove(p)
      } else if (typeof invoke === 'function') {
        await invoke('force_remove_path', { path: p })
      }

      const finalCheck = await exists(p)
      if (!finalCheck) return

      throw new Error('文件仍然存在(可能被其他程序占用)')
    } catch (e) {
      lastError = e
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        continue
      }
      throw e
    }
  }

  throw lastError ?? new Error('删除失败')
}

/**
 * 安全创建新文件:自动检测 separator、避免与已有文件冲突(末尾加 " N" 序号),
 * 确保父目录存在,默认写入 "# 标题\n\n"。
 * @returns 最终创建的全路径
 */
export async function newFileSafe(dir: string, name = '新建文档.md', content?: string): Promise<string> {
  const sep = dir.includes('\\') ? '\\' : '/'
  let n = name
  let i = 1
  while (await exists(dir + sep + n)) {
    const m = name.match(/^(.*?)(\.[^.]+)$/)
    const stem = m ? m[1] : name
    const ext = m ? m[2] : ''
    n = `${stem} ${++i}${ext}`
  }
  const full = dir + sep + n
  await ensureDir(dir)
  await writeTextFile(full, content ?? '# 标题\n\n', {} as any)
  return full
}
