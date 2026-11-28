// 固定并发上限的批处理工具。
//
// 用途：一串互不依赖的异步任务（插件更新检查、批量网络请求等）默认用
// Promise.all 会一次性全部发起；条目多时同时占满连接与回调队列。
//
// 语义：
// - 最多 limit 个任务同时在途，任一时刻启动的下一个任务都从剩余条目里取；
// - 任一任务抛错 → 整体 reject（与 Promise.all 一致），已在执行的任务不取消；
// - 空列表直接 resolve；limit 非正/NaN 按 1 处理。

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) return
  const raw = Math.floor(limit)
  const lanes = Math.max(1, Math.min(Number.isFinite(raw) && raw > 0 ? raw : 1, items.length))
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => worker()))
}
