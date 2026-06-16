import { describe, it, expect, vi } from 'vitest'
import { singleFlight } from './singleFlight'

function deferred() {
  let resolve!: () => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('singleFlight', () => {
  it('并发调用只执行一次主体，且复用同一个 Promise 引用', async () => {
    const d = deferred()
    const fn = vi.fn(() => d.promise)
    const run = singleFlight(fn)

    const p1 = run()
    const p2 = run()
    const p3 = run()

    // 主体在第一次调用时已同步触发（执行到首个 await 前），后续调用被去重
    expect(fn).toHaveBeenCalledTimes(1)
    expect(p2).toBe(p1)
    expect(p3).toBe(p1)

    d.resolve()
    await Promise.all([p1, p2, p3])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('settle 后允许再次发起（对应"取消退出"后可重试）', async () => {
    const fn = vi.fn(async () => {})
    const run = singleFlight(fn)

    await run()
    await run()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('主体 reject 后同样清空，下次调用可重新执行', async () => {
    let calls = 0
    const run = singleFlight(async () => {
      calls++
      throw new Error('boom')
    })

    await expect(run()).rejects.toThrow('boom')
    await expect(run()).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })

  it('in-flight 期间不重入，settle 前主体只跑一次', async () => {
    const d = deferred()
    let calls = 0
    const run = singleFlight(() => {
      calls++
      return d.promise
    })

    const p1 = run()
    const p2 = run()
    expect(calls).toBe(1)

    d.resolve()
    await Promise.all([p1, p2])
    // settle 后再发起才会重新执行
    const p3 = run()
    expect(calls).toBe(2)
    await p3
  })
})
