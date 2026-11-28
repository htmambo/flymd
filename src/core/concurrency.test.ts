import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from './concurrency'

const tick = () => new Promise<void>((r) => setTimeout(r, 1))

describe('runWithConcurrency', () => {
  it('并发不超过上限，且处理完全部条目', async () => {
    let inflight = 0
    let maxInflight = 0
    const seen: number[] = []
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 4, async (item) => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await tick()
      seen.push(item)
      inflight--
    })
    expect(maxInflight).toBe(4)
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('条目少于上限时全部并行', async () => {
    let inflight = 0
    let maxInflight = 0
    await runWithConcurrency([1, 2], 8, async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await tick()
      inflight--
    })
    expect(maxInflight).toBe(2)
  })

  it('空列表与非法上限不报错', async () => {
    await expect(runWithConcurrency([], 4, async () => {})).resolves.toBeUndefined()

    let maxInflight = 0
    let inflight = 0
    await runWithConcurrency([1, 2, 3], 0, async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await tick()
      inflight--
    })
    expect(maxInflight).toBe(1)
  })

  it('任务抛错时整体 reject', async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})
