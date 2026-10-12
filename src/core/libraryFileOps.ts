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
import { ensureDir, isInside } from './fsSafe'

/**
 * 安全删除文件/目录。
 * 优先尝试移至回收站(macOS/Windows);若为目录或回收站失败,递归删除子项后用 force_remove_path 兜底;3 次重试。
 *
 * 越权防护(必须在此函数内,而非只在调用点):deleteFileSafe 会递归销毁传入的
 * 任何路径,后端 move_to_trash / force_remove_path 也不做任何根目录校验。
 * 此前唯一的防线是「调用方传的路径来自文件树 dataset.path」这一假设 ——
 * 而库根行同样带 dataset.path 且会出现在右键菜单里,右键删除库根即可把整个
 * 库移入回收站,弹窗还只显示文件夹名、不提示这是整个库。
 *
 * opts.root 传入库根时,拒绝删除库根本身(isInside 对相等路径返回 false,
 * 天然覆盖),并拒绝库外路径。重命名路径(main.ts 的 F2 处理)本来就有
 * isInside 守卫,删除路径此前是唯一缺口。
 *
 * @param p 绝对路径
 * @param permanent true 时跳过回收站直接物理删除
 * @param opts.root 库根;提供时启用越权防护
 */
export async function deleteFileSafe(p: string, permanent = false, opts?: { root?: string | null }): Promise<void> {
  const root = opts?.root
  if (root) {
    if (!p) throw new Error('删除路径为空')
    if (!isInside(root, p)) {
      throw new Error(`拒绝删除库外路径: ${p}`)
    }
  }
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
          await deleteFileSafe(child, true, opts) // 递归时直接永久删除，沿用同一越权防护
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
