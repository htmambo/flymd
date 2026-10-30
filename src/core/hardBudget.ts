// 硬预算工具（perf 批次 I）
//
// 用途：给"底层无法取消"的异步任务套一个总预算。
//
// 背景：插件的远端 manifest 检查会拉取 raw.githubusercontent.com，真机实测单次
// 47,728ms。原先用 Promise.race + setTimeout 施加超时，有两个问题：
//   1. race 只能让"等待方"提前返回，**无法取消底层请求**——tauri http 的 Rust
//      侧请求仍会跑完，浏览器 fetch 的 abort 在 WebKitGTK 上也不保证立即生效；
//   2. 迟到 resolve 若被下游接收会与已返回的超时结果重复处理，迟到 reject 则会
//      变成未捕获的 rejection。
//
// 这里用状态锁把两条路都堵死：settle 之后任务的 resolve/reject 一律不再向下传播，
// 也不会产生未处理的 rejection。
//
// 注意：预算定时器跑在主线程上。若主线程正被长任务阻塞，定时器会延迟触发，
// 预算随之失效——所以"把网络移出应用就绪关键路径"才是根治，预算只是兜底。

/**
 * 预算超时错误。下游可 instanceof BudgetTimeoutError 区分"预算超时"
 * 与"任务自身失败"——超时通常走降级/缓存兜底，任务失败通常走错误上报，
 * 不应靠字符串匹配来区分。
 */
export class BudgetTimeoutError extends Error {
  readonly isBudgetTimeout = true
  constructor(budgetMs: number) {
    super(`请求超时（${budgetMs}ms）`)
    this.name = 'BudgetTimeoutError'
  }
}

/**
 * 以硬预算包裹异步任务：超时后调用方立即收到拒绝，迟到结果被丢弃。
 *
 * @param task      实际任务
 * @param budgetMs  预算毫秒数（必须是正有限数）
 * @param onTimeout 超时回调（用于打点/埋点）。**必须是同步函数**——若传入 async
 *                   回调，其内部 rejection 无人处理，会变成未捕获 rejection。
 */
export function raceWithHardBudget<T>(
  task: Promise<T>,
  budgetMs: number,
  onTimeout?: () => void,
): Promise<T> {
  // setTimeout 对 NaN / 负数 / Infinity 都会立即触发 → 无条件超时且无报错，
  // 此类误传必须在这里挡下来。
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError(`budgetMs 必须为正有限数，收到 ${budgetMs}`)
  }
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { onTimeout?.() } catch (e) {
        // onTimeout 是打点/埋点，不应阻断超时 reject；但静默吞掉会难以排查
        console.warn('[raceWithHardBudget] onTimeout 回调异常:', e)
      }
      reject(new BudgetTimeoutError(budgetMs))
    }, budgetMs)
    task.then(
      (v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
