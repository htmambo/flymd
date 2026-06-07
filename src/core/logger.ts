/**
 * 日志系统模块
 * 从 main.ts 拆分，支持写入文件和控制台输出
 */

import { open as openFileHandle, BaseDirectory } from '@tauri-apps/plugin-fs'

// 日志相关
const LOG_NAME = 'flymd.log'

// 日志级别
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export async function appendLog(level: LogLevel, message: string, details?: unknown) {
  const timestamp = new Date().toISOString()
  let logLine = `[${timestamp}] [${level}] ${message}`

  if (details !== undefined) {
    if (details instanceof Error) {
      logLine += `\n  错误: ${details.message}`
      if (details.stack) {
        logLine += `\n  堆栈:\n${details.stack.split('\n').map(l => '    ' + l).join('\n')}`
      }
    } else {
      try {
        logLine += `\n  详情: ${JSON.stringify(details, null, 2)}`
      } catch {
        logLine += `\n  详情: ${String(details)}`
      }
    }
  }

  logLine += '\n'

  // 先输出到控制台作为备份
  const consoleMsg = `[${level}] ${message}`
  if (level === 'ERROR') {
    console.error(consoleMsg, details)
  } else if (level === 'WARN') {
    console.warn(consoleMsg, details)
  } else {
    console.log(consoleMsg, details)
  }

  // 尝试写入文件
  try {
    const data = new TextEncoder().encode(logLine)

    const tryWrite = async (baseDir: BaseDirectory) => {
      try {
        const f = await openFileHandle(LOG_NAME, { write: true, append: true, create: true, baseDir })
        try {
          await f.write(data)
        } finally {
          await f.close()
        }
        return true
      } catch (e) {
        return false
      }
    }

    // 优先尝试 AppLog / AppLocalData，成功则返回
    try {
      const base1: BaseDirectory = BaseDirectory.AppLog ?? BaseDirectory.AppLocalData
      const f1 = await openFileHandle(LOG_NAME, { write: true, append: true, create: true, baseDir: base1 })
      try { await f1.write(data) } finally { await f1.close() }
      return
    } catch {}

    // 优先尝试写入可执行文件同级目录
    let success = await tryWrite(BaseDirectory.Executable)

    if (!success) {
      // 备选：AppData 或 AppLog
      success = await tryWrite(BaseDirectory.AppLog ?? BaseDirectory.AppData)
    }
  } catch (e) {
    // 文件写入失败也不影响应用运行
    console.warn('日志文件写入失败，但不影响应用运行')
  }
}

// 初始化全局异常监听（在模块加载时自动执行）
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e: any) => {
      try { void appendLog('ERROR', '全局错误', e?.error ?? e?.message ?? e) } catch {}
    })
    window.addEventListener('unhandledrejection', (e: any) => {
      try { void appendLog('ERROR', 'Promise 未处理的拒绝', e?.reason ?? e) } catch {}
    })
  }
} catch {}

// 添加通用日志函数供其他地方调用
export function logInfo(message: string, details?: unknown) {
  void appendLog('INFO', message, details)
}

export function logWarn(message: string, details?: unknown) {
  void appendLog('WARN', message, details)
}

export function logDebug(message: string, details?: unknown) {
  void appendLog('DEBUG', message, details)
}
