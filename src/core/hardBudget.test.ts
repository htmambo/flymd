// 硬预算与状态锁测试（perf 批次 I）
//
// 锁定 raceWithHardBudget 的四条语义：
// 1. 预算内正常 resolve
// 2. 超时后调用方立即拿到拒绝
// 3. **迟到 resolve 被丢弃**（状态锁的核心价值：不与超时结果重复处理）
// 4. **迟到 reject 被丢弃**（不产生未处理的 rejection）

import { describe, it, expect, vi } from 'vitest'
import { raceWithHardBudget, BudgetTimeoutError } from './hardBudget'

describe('raceWithHardBudget', () => {
  it('预算内正常返回结果', async () => {
    await expect(raceWithHardBudget(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('任务的错误原样透传', async () => {
    const err = new Error('boom')
    await expect(raceWithHardBudget(Promise.reject(err), 1000)).rejects.toBe(err)
  })

  it('超时后调用方收到拒绝', async () => {
    const never = new Promise<string>(() => {})
    await expect(raceWithHardBudget(never, 10)).rejects.toThrow(/请求超时/)
  })

  it('超时回调被调用一次', async () => {
    const onTimeout = vi.fn()
    const never = new Promise<string>(() => {})
    await expect(raceWithHardBudget(never, 10, onTimeout)).rejects.toThrow()
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('迟到的 resolve 被丢弃：不再改变已 settle 的结果', async () => {
    let resolveLate: (v: string) => void = () => {}
    const late = new Promise<string>((res) => { resolveLate = res })
    const p = raceWithHardBudget(late, 10)
    await expect(p).rejects.toThrow(/请求超时/)
    // 迟到到达：既不该让已拒绝的 promise 变成成功，也不该有未处理 rejection
    resolveLate('late')
    await expect(p).rejects.toThrow(/请求超时/)
    await new Promise((r) => setTimeout(r, 20))
    await expect(p).rejects.toThrow(/请求超时/)
  })

  it('迟到的 reject 被丢弃：不产生未处理 rejection', async () => {
    let rejectLate: (e: any) => void = () => {}
    const late = new Promise<string>((_res, rej) => { rejectLate = rej })
    const p = raceWithHardBudget(late, 10)
    await expect(p).rejects.toThrow(/请求超时/)
    rejectLate(new Error('late failure'))
    // 若未处理，vitest 会以 unhandled rejection 报失败
    await new Promise((r) => setTimeout(r, 30))
    await expect(p).rejects.toThrow(/请求超时/)
  })

  it('超时以 BudgetTimeoutError 拒绝（下游可与任务自身失败区分）', async () => {
    const never = new Promise<string>(() => {})
    const err = await raceWithHardBudget(never, 10).catch((e) => e)
    expect(err).toBeInstanceOf(BudgetTimeoutError)
    expect(err.isBudgetTimeout).toBe(true)
  })

  it('budgetMs 非法时抛 RangeError（setTimeout 对 NaN/负数会立即触发）', () => {
    expect(() => raceWithHardBudget(Promise.resolve(1), NaN)).toThrow(RangeError)
    expect(() => raceWithHardBudget(Promise.resolve(1), 0)).toThrow(RangeError)
    expect(() => raceWithHardBudget(Promise.resolve(1), -1)).toThrow(RangeError)
    expect(() => raceWithHardBudget(Promise.resolve(1), Infinity)).toThrow(RangeError)
  })

  it('onTimeout 抛错不影响超时拒绝', async () => {
    const never = new Promise<string>(() => {})
    const err = await raceWithHardBudget(never, 10, () => { throw new Error('boom') })
      .catch((e) => e)
    expect(err).toBeInstanceOf(BudgetTimeoutError)
  })

  it('预算内完成时不再触发超时回调', async () => {
    const onTimeout = vi.fn()
    await raceWithHardBudget(Promise.resolve(1), 50, onTimeout)
    await new Promise((r) => setTimeout(r, 80))
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
