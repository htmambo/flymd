// 通用文件系统安全操作封装（与 UI 解耦，只做路径与读写）

import { mkdir, rename, readFile, writeFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

/** openFileWatcher 用的 file snapshot,跨 plugin-fs scope 兼容 */
export type FileSnapshot = {
  mtimeMs: number
  size: number
}

// 统一路径分隔符（在当前平台风格下清洗多余分隔符）
export function normSep(p: string): string {
  return p.replace(/[\\/]+/g, p.includes('\\') ? '\\' : '/')
}

// 判断 p 是否位于 root 之内（大小写不敏感，按规范化路径前缀判断）
export function isInside(root: string, p: string): boolean {
  try {
    const r = normSep(root).toLowerCase()
    const q = normSep(p).toLowerCase()
    const base = r.endsWith('/') || r.endsWith('\\') ? r : r + (r.includes('\\') ? '\\' : '/')
    return q.startsWith(base)
  } catch {
    return false
  }
}

// 确保目录存在（递归创建）
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true } as any)
  } catch {}
}

// 安全移动文件：优先尝试 rename，失败则回退到复制+删除
export async function moveFileSafe(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst)
  } catch {
    const data = await readFile(src)
    await ensureDir(dst.replace(/[\\/][^\\/]*$/, ''))
    await writeFile(dst, data as any)
    try {
      await remove(src)
    } catch {}
  }
}

// 安全重命名：在同一目录内构造新路径并调用 moveFileSafe
export async function renameFileSafe(p: string, newName: string): Promise<string> {
  const base = p.replace(/[\\/][^\\/]*$/, '')
  const dst = base + (base.includes('\\') ? '\\' : '/') + newName
  await moveFileSafe(p, dst)
  return dst
}

// 将任意 open() 返回值归一化为可用于 fs API 的字符串路径
export function normalizePath(input: unknown): string {
  try {
    if (typeof input === 'string') return input
    if (input && typeof (input as any).path === 'string') return (input as any).path
    if (input && typeof (input as any).filePath === 'string') return (input as any).filePath
    const p: any = (input as any)?.path
    if (p) {
      if (typeof p === 'string') return p
      if (typeof p?.href === 'string') return p.href
      if (typeof p?.toString === 'function') {
        const s = p.toString()
        if (typeof s === 'string' && s) return s
      }
    }
    if (input && typeof (input as any).href === 'string') return (input as any).href
    if (input && typeof (input as any).toString === 'function') {
      const s = (input as any).toString()
      if (typeof s === 'string' && s) return s
    }
    return String(input ?? '')
  } catch {
    return String(input ?? '')
  }
}

// 统一读文件兜底：fs 失败则调用后端命令读取
export async function readTextFileAnySafe(p: string): Promise<string> {
  try {
    const data = await readFile(p as any)
    return new TextDecoder().decode(data as any)
  } catch (e) {
    try {
      return await invoke<string>('read_text_file_any', { path: p })
    } catch {
      throw e
    }
  }
}

// 统一写文件兜底：fs 失败则调用后端命令写入
export async function writeTextFileAnySafe(p: string, content: string): Promise<void> {
  const data = new TextEncoder().encode(content)
  try {
    await writeFile(p as any, data as any)
  } catch (e) {
    try {
      await invoke('write_text_file_any', { path: p, content })
    } catch {
      throw e
    }
  }
}

/**
 * 统一 stat 兜底：plugin-fs 失败则调用后端 stat_any 跨 scope 读 mtime/size。
 * 错误识别与 readTextFileWithFallback 一致(forbidden path|not allowed|EACCES|EPERM|Access Denied)。
 * 不可用时返回 null(调用方按"文件不可访问"处理)。
 */
function isFallbackError(msg: string): boolean {
  return /forbidden\s*path/i.test(msg)
    || /not\s*allowed/i.test(msg)
    || /EACCES|EPERM|Access\s*Denied/i.test(msg)
}

export async function statFileAnySafe(p: string): Promise<FileSnapshot | null> {
  try {
    const raw: any = await stat(p as any)
    const mtimeMs = Number(raw?.mtimeMs ?? raw?.mtime ?? raw?.modifiedAt)
    const size = Number(raw?.size)
    if (!Number.isFinite(mtimeMs) || !Number.isFinite(size)) return null
    return { mtimeMs, size }
  } catch (e) {
    const msg = (e && (e as any).message) ? String((e as any).message) : String(e)
    if (!isFallbackError(msg)) return null
    try {
      const meta = await invoke<FileSnapshot>('stat_any', { path: p })
      const mtimeMs = Number(meta?.mtimeMs)
      const size = Number(meta?.size)
      if (!Number.isFinite(mtimeMs) || !Number.isFinite(size)) return null
      return { mtimeMs, size }
    } catch {
      return null
    }
  }
}

// ========== 库私有化 v2（PR-2）基础设施包装 ==========
// 目的：为 .flymd/local.json 提供原子写 + 跨进程文件锁。
// 全部优先调 Rust 后端命令（PR-2 新增），失败 fallback 到 plugin-fs。

/**
 * 原子写：tmp + fsync + rename + fsync dir。
 * 失败 fallback 到 plugin-fs writeFile（不保证原子性,但不丢写）。
 */
export async function writeFileAtomicSafe(p: string, content: string): Promise<void> {
  try {
    await invoke('write_file_atomic', { path: p, content })
  } catch (e) {
    // fallback: ensure dir + plain write
    try {
      const dir = p.replace(/[\\/][^\\/]*$/, '')
      if (dir && dir !== p) await ensureDir(dir)
    } catch {}
    await writeFile(p as any, new TextEncoder().encode(content) as any)
  }
}

/**
 * 启动期清理 `<root>/.flymd/*.tmp`。返回删除数量。
 * 失败返回 0（容错，不阻塞启动）。
 */
export async function cleanupStaleTmpFilesSafe(root: string): Promise<number> {
  try {
    const n = await invoke<number>('cleanup_stale_tmp_files', { root })
    return Number(n) || 0
  } catch {
    return 0
  }
}

/**
 * 跨进程文件锁：以 `<path>.lock` 旁路文件 fs2 排他锁。
 * 返回 token；解锁时传回 unlockFileSafe。
 * 超时或失败时抛错。
 */
export async function tryLockFileSafe(p: string, timeoutMs = 5000): Promise<string> {
  const token = await invoke<string>('try_lock_file', { path: p, timeoutMs: timeoutMs })
  if (typeof token !== 'string' || !token) {
    throw new Error('try_lock_file returned empty token')
  }
  return token
}

/** 释放 token 对应的锁。token 不存在时后端返回错误,这里吞掉（容错）。 */
export async function unlockFileSafe(token: string): Promise<void> {
  try {
    await invoke('unlock_file', { token })
  } catch {
    // best-effort: 进程退出自动释放,这里静默
  }
}

/** 便捷：带锁读文件。 */
export async function readFileLockedSafe(p: string, timeoutMs = 5000): Promise<string> {
  return await invoke<string>('read_file_locked', { path: p, timeoutMs: timeoutMs })
}

/** 便捷：带锁原子写文件。 */
export async function writeFileLockedSafe(
  p: string,
  content: string,
  timeoutMs = 5000,
): Promise<void> {
  await invoke('write_file_locked', { path: p, content, timeoutMs: timeoutMs })
}

/**
 * 读-改-写原子操作：在同一文件锁内完成"读取当前内容 → 调 modify 合并 → 原子写"。
 * 关键用途：libraryPrivate.doWrite 等"需要先读 base 再合并 patch"的场景，
 * 把读也放入锁作用域，避免多窗口/多进程并发下"读 base → 另一个窗口写 → 写回覆盖"的数据丢失。
 *
 * 调用方负责合并逻辑：modify 接收当前文件内容（不存在则为空字符串），返回要写入的新内容。
 */
export async function readModifyWriteLockedSafe(
  p: string,
  modify: (current: string) => string | Promise<string>,
  timeoutMs = 5000,
): Promise<string> {
  const token = await tryLockFileSafe(p, timeoutMs)
  try {
    let current = ''
    try { current = await readTextFileAnySafe(p) } catch { /* 文件不存在/不可读 */ }
    const next = await modify(current)
    await writeFileAtomicSafe(p, next)
    return next
  } finally {
    await unlockFileSafe(token)
  }
}

