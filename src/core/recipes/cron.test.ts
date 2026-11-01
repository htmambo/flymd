// cron 表达式解析与下次触发时间计算的测试
// 覆盖：字段解析、宏、非法输入、日/周 OR 语义、跨天/跨月推进

import { describe, it, expect } from 'vitest'
import { parseCron, nextCronTime, cronMatches } from './cron'

describe('parseCron', () => {
  it('解析标准 5 段表达式', () => {
    const spec = parseCron('0 9 * * *')
    expect(spec.minutes).toEqual([0])
    expect(spec.hours).toEqual([9])
    expect(spec.days).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
    expect(spec.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(spec.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(spec.domRestricted).toBe(false)
    expect(spec.dowRestricted).toBe(false)
  })

  it('解析列表、范围与步长', () => {
    const spec = parseCron('0,30 9-17 * * 1-5')
    expect(spec.minutes).toEqual([0, 30])
    expect(spec.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(spec.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(spec.dowRestricted).toBe(true)

    const step = parseCron('*/15 * * * *')
    expect(step.minutes).toEqual([0, 15, 30, 45])

    const step2 = parseCron('0 0-12/6 * * *')
    expect(step2.hours).toEqual([0, 6, 12])
  })

  it('裸数字带步长时从该值起递增', () => {
    const spec = parseCron('5/20 * * * *')
    expect(spec.minutes).toEqual([5, 25, 45])
  })

  it('把周字段的 7 归一化成 0（周日）', () => {
    const spec = parseCron('0 0 * * 7')
    expect(spec.weekdays).toEqual([0])
  })

  it('支持 @daily 等宏', () => {
    expect(parseCron('@daily').hours).toEqual([0])
    expect(parseCron('@hourly').minutes).toEqual([0])
    expect(parseCron('@weekly').weekdays).toEqual([0])
    expect(parseCron('@monthly').days).toEqual([1])
    expect(parseCron('@yearly').months).toEqual([1])
  })

  it('拒绝非法表达式并给出可读错误', () => {
    expect(() => parseCron('')).toThrow(/表达式为空/)
    expect(() => parseCron('0 9 * *')).toThrow(/5 段/)
    expect(() => parseCron('60 * * * *')).toThrow(/越界/)
    expect(() => parseCron('0 24 * * *')).toThrow(/越界/)
    expect(() => parseCron('0 0 32 * *')).toThrow(/越界/)
    expect(() => parseCron('0 0 * 13 *')).toThrow(/越界/)
    expect(() => parseCron('0 0 * * 8')).toThrow(/越界/)
    expect(() => parseCron('abc * * * *')).toThrow(/无法解析/)
    expect(() => parseCron('*/0 * * * *')).toThrow(/步长/)
    expect(() => parseCron('5-1 * * * *')).toThrow(/起点大于终点/)
  })
})

describe('nextCronTime', () => {
  // 2026-11-01 是星期日，2026-11-02 是星期一
  it('当天稍晚触发时返回当天该时刻', () => {
    const spec = parseCron('0 9 * * *')
    const from = new Date(2026, 10, 1, 8, 0, 0)
    const next = nextCronTime(spec, from)
    expect(next).not.toBeNull()
    expect(next!.getFullYear()).toBe(2026)
    expect(next!.getMonth()).toBe(10)
    expect(next!.getDate()).toBe(1)
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(0)
  })

  it('已过该时刻时推到明天', () => {
    const spec = parseCron('0 9 * * *')
    const next = nextCronTime(spec, new Date(2026, 10, 1, 9, 0, 30))
    expect(next!.getDate()).toBe(2)
    expect(next!.getHours()).toBe(9)
  })

  it('恰好等于触发时刻时视为已过（避免重复触发）', () => {
    const spec = parseCron('0 9 * * *')
    const next = nextCronTime(spec, new Date(2026, 10, 1, 9, 0, 0))
    expect(next!.getDate()).toBe(2)
  })

  it('按星期过滤时跳到下一个匹配日', () => {
    const spec = parseCron('0 9 * * 1') // 只在星期一
    const next = nextCronTime(spec, new Date(2026, 10, 1, 8, 0, 0))
    expect(next!.getDate()).toBe(2)
    expect(next!.getDay()).toBe(1)
  })

  it('日与周同时限定时取 OR', () => {
    const spec = parseCron('0 9 1 * 1') // 每月 1 号 或 每周一
    // 11-01 是星期日，但正好是 1 号 → 命中
    let next = nextCronTime(spec, new Date(2026, 10, 1, 8, 0, 0))
    expect(next!.getDate()).toBe(1)
    // 11-02 是星期一 → 命中
    next = nextCronTime(spec, new Date(2026, 10, 2, 8, 0, 0))
    expect(next!.getDate()).toBe(2)
    // 11-03 是星期二，日期也不是 1 号 → 下一个匹配是 11-09（星期一）
    // 若误实现成 AND（既要是 1 号又要是星期一），这里会一路跳到 2027-02-01
    next = nextCronTime(spec, new Date(2026, 10, 3, 8, 0, 0))
    expect(next!.getMonth()).toBe(10)
    expect(next!.getDate()).toBe(9)
    expect(next!.getDay()).toBe(1)
  })

  it('只限定日时不会被星期几带偏', () => {
    const spec = parseCron('0 9 1 * *')
    const next = nextCronTime(spec, new Date(2026, 10, 3, 8, 0, 0))
    expect(next!.getMonth()).toBe(11)
    expect(next!.getDate()).toBe(1)
  })

  it('跨月推进', () => {
    const spec = parseCron('0 0 1 * *')
    const next = nextCronTime(spec, new Date(2026, 10, 15, 12, 0, 0))
    expect(next!.getMonth()).toBe(11)
    expect(next!.getDate()).toBe(1)
    expect(next!.getHours()).toBe(0)
  })

  it('每年一次的表达式也能算出（搜索上限内）', () => {
    const spec = parseCron('0 0 1 1 *')
    const next = nextCronTime(spec, new Date(2026, 5, 2, 0, 0, 0))
    expect(next!.getFullYear()).toBe(2027)
    expect(next!.getMonth()).toBe(0)
    expect(next!.getDate()).toBe(1)
  })
})

describe('cronMatches', () => {
  it('判断某时刻是否命中', () => {
    const spec = parseCron('0 9 * * *')
    expect(cronMatches(spec, new Date(2026, 10, 1, 9, 0, 0))).toBe(true)
    expect(cronMatches(spec, new Date(2026, 10, 1, 9, 1, 0))).toBe(false)
    expect(cronMatches(spec, new Date(2026, 10, 1, 8, 0, 0))).toBe(false)
  })
})
