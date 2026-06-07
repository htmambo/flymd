/**
 * 调度工具
 * 从 main.ts 抽离,纯函数,无 main.ts 状态依赖
 */

/** 当前时间(ms),优先 performance.now,降级 Date.now */
export function nowMs(): number {
  try { return (performance && typeof performance.now === 'function') ? performance.now() : Date.now() } catch { return Date.now() }
}

/**
 * 在首屏渲染之后异步执行 task
 * - 优先 requestAnimationFrame
 * - 不支持环境降级 window.setTimeout
 * - task 执行被 try/catch 包裹,失败不影响主流程
 */
export function scheduleAfterFirstPaint(task: () => void, delay = 0): void {
  const run = () => {
    try {
      window.setTimeout(() => {
        try { task() } catch {}
      }, Math.max(0, delay | 0))
    } catch {
      try { task() } catch {}
    }
  }
  try {
    requestAnimationFrame(() => { run() })
  } catch {
    window.setTimeout(run, Math.max(16, delay | 0))
  }
}
