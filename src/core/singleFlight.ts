/**
 * first-wins 单飞包装：并发调用复用同一个进行中的 Promise，直到它 settle
 * （resolve 或 reject）后才允许下一次重新发起。
 *
 * 用于"同一时刻只应推进一遍"的场景，例如窗口退出：关闭按钮 / Cmd+Q /
 * onCloseRequested 三条路径可能在同一事件循环内并发抵达，包装后只跑一遍主体，
 * 其余调用拿到同一个 Promise（含正在等待用户的对话框）。settle 后清空，使
 * "取消退出"等路径可以再次发起。
 */
export function singleFlight<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let inFlight: Promise<void> | null = null
  return (...args: A): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        await fn(...args)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }
}
