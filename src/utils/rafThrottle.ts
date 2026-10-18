// rAF 节流:leading 立即执行,同一帧内多次调用合并为一次 trailing 补发(用最新参数)。
// 用于 scroll 等高频事件:一帧最多执行两次(leading + trailing),
// 监听器保持 passive,不阻塞滚动。

export interface RafThrottle<Args extends unknown[]> {
  (...args: Args): void
  /** 取消待执行的 trailing 帧(组件销毁时调用,保证 fn 不再被触发) */
  cancel(): void
}

export function createRafThrottle<Args extends unknown[]>(fn: (...args: Args) => void): RafThrottle<Args> {
  let rafId: number | null = null
  let trailingArgs: Args | null = null

  const throttled = ((...args: Args) => {
    if (rafId != null) {
      // 本帧已调度过 leading:只记录最新参数,等 trailing 帧补发一次
      trailingArgs = args
      return
    }
    fn(...args)
    rafId = requestAnimationFrame(() => {
      rafId = null
      const pending = trailingArgs
      trailingArgs = null
      if (pending) fn(...pending)
    })
  }) as RafThrottle<Args>

  throttled.cancel = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    trailingArgs = null
  }

  return throttled
}
