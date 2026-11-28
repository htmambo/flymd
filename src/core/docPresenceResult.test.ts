import { describe, it, expect } from 'vitest'
import { normalizeDocPresenceScanResult } from './docPresenceResult'

describe('normalizeDocPresenceScanResult', () => {
  it('解析结构体返回', () => {
    expect(
      normalizeDocPresenceScanResult({
        dirs: ['/lib', '/lib/a'],
        truncated: true,
        errors: 3,
        visited: 50000,
      }),
    ).toEqual({ dirs: ['/lib', '/lib/a'], truncated: true, errors: 3, visited: 50000 })
  })

  it('兼容旧数组返回', () => {
    expect(normalizeDocPresenceScanResult(['/lib', '/lib/a'])).toEqual({
      dirs: ['/lib', '/lib/a'],
      truncated: false,
      errors: 0,
      visited: 0,
    })
  })

  it('过滤非字符串并给缺省值', () => {
    expect(normalizeDocPresenceScanResult({ dirs: ['/lib', 1, null, {}] })).toEqual({
      dirs: ['/lib'],
      truncated: false,
      errors: 0,
      visited: 0,
    })
    expect(normalizeDocPresenceScanResult(null)).toEqual({
      dirs: [],
      truncated: false,
      errors: 0,
      visited: 0,
    })
    expect(normalizeDocPresenceScanResult({ dirs: 'x', truncated: 'yes', errors: -1, visited: NaN })).toEqual({
      dirs: [],
      truncated: false,
      errors: 0,
      visited: 0,
    })
  })
})
