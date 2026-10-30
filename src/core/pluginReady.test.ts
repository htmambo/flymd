// 插件就绪门控测试（perf 批次 I）
//
// 锁定语义：
// 1. 激活窗口内，外部 wait() 排队等待到 finish
// 2. 激活流程内部**不经过**门控（调用方直接调 pluginHost.activatePlugin），
//    因此不存在等待自己的自锁——本测试用"内部路径不走门控"来体现这一约定
// 3. finish() 幂等；失败路径也 finish → 外部调用不会被永久阻塞
// 4. 未打开窗口时 wait() 立即执行
//
// 回归要点：早期实现用全局 depth 计数区分内外，外部审查实测该误判会在最长
// 激活窗口内让门控完全失效（外部调用被当作内部调用而跳过等待）。现实现已
// 移除 depth，"内外区分"改为调用方显式绕过的约定。

import { describe, it, expect } from 'vitest'
import { createPluginReadyGate } from './pluginReady'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('createPluginReadyGate', () => {
  it('初始未就绪', () => {
    const gate = createPluginReadyGate()
    expect(gate.isReady()).toBe(false)
  })

  it('激活窗口内外部 wait() 排队等待到 finish', async () => {
    const gate = createPluginReadyGate()
    gate.begin()
    let ran = false
    const p = gate.wait(async () => { ran = true })
    await tick(10)
    expect(ran).toBe(false)
    gate.finish()
    await p
    expect(ran).toBe(true)
    expect(gate.isReady()).toBe(true)
  })

  it('run 进行中外部 wait() 仍然等待（回归：早期 depth 实现会误跳过）', async () => {
    const gate = createPluginReadyGate()
    gate.begin()
    // 模拟"激活流程内部正在跑一个长任务"
    let releaseInternal: () => void = () => {}
    const internal = new Promise<void>((r) => { releaseInternal = r })
    void internal.then(() => gate.finish())

    // 此时外部来一个调用：必须排队，不能因为"内部任务在跑"而跳过等待
    let ran = false
    const p = gate.wait(async () => { ran = true })
    await tick(10)
    expect(ran).toBe(false)
    releaseInternal()
    await p
    expect(ran).toBe(true)
  })

  it('finish() 幂等', async () => {
    const gate = createPluginReadyGate()
    gate.begin()
    gate.finish()
    gate.finish()
    expect(gate.isReady()).toBe(true)
    let ran = false
    await gate.wait(async () => { ran = true })
    expect(ran).toBe(true)
  })

  it('未打开窗口时 wait() 立即执行', async () => {
    const gate = createPluginReadyGate()
    let ran = false
    await gate.wait(async () => { ran = true })
    expect(ran).toBe(true)
  })

  it('begin() 幂等：不会产生第二个 pending', async () => {
    const gate = createPluginReadyGate()
    gate.begin()
    gate.begin()
    let ran = false
    const p = gate.wait(async () => { ran = true })
    await tick(10)
    expect(ran).toBe(false)
    gate.finish()
    await p
    expect(ran).toBe(true)
  })

  it('就绪后 wait() 不再等待', async () => {
    const gate = createPluginReadyGate()
    gate.begin()
    gate.finish()
    let ran = false
    const started = Date.now()
    await gate.wait(async () => { ran = true })
    expect(ran).toBe(true)
    expect(Date.now() - started).toBeLessThan(100)
  })
})
