// Recipe YAML 解析与校验的测试
// 重点：坏配置必须**报错**而不是半截生效——错误信息要能指到具体字段

import { describe, it, expect } from 'vitest'
import { parseRecipeYaml, isSafeRelativePath } from './parse'

const VALID = `
id: daily-report
name: 每日汇总
enabled: true
trigger:
  type: schedule
  cron: "0 9 * * *"
prompt: |
  汇总 {{date}} 的笔记。
output:
  mode: note
  path: "AI/日报.md"
  heading: true
`

describe('parseRecipeYaml', () => {
  it('解析完整的 recipe', () => {
    const r = parseRecipeYaml(VALID, 'daily-report.yaml')
    expect(r.id).toBe('daily-report')
    expect(r.name).toBe('每日汇总')
    expect(r.enabled).toBe(true)
    expect(r.trigger.type).toBe('schedule')
    expect(r.trigger.cron).toBe('0 9 * * *')
    expect(r.prompt).toContain('{{date}}')
    expect(r.output.mode).toBe('note')
    expect(r.output.path).toBe('AI/日报.md')
    expect(r.output.heading).toBe(true)
    expect(r.sourceFile).toBe('daily-report.yaml')
  })

  it('缺省值：enabled 为 true、output 为 none', () => {
    const r = parseRecipeYaml(`
id: minimal
name: 最小
trigger:
  type: on-save
prompt: 做点什么
`)
    expect(r.enabled).toBe(true)
    expect(r.output.mode).toBe('none')
    expect(r.output.path).toBeUndefined()
    expect(r.trigger.paths).toEqual([])
  })

  it('on-save 可以配 paths 与防抖', () => {
    const r = parseRecipeYaml(`
id: saver
name: 保存触发
trigger:
  type: on-save
  paths: ["日记/*.md"]
  debounceMs: 8000
prompt: 补待办
`)
    expect(r.trigger.type).toBe('on-save')
    expect(r.trigger.paths).toEqual(['日记/*.md'])
    expect(r.trigger.debounceMs).toBe(8000)
  })

  it('支持内联 ai 覆盖', () => {
    const r = parseRecipeYaml(`
id: ai
name: AI 覆盖
trigger:
  type: schedule
  cron: "@daily"
prompt: 干活
ai:
  baseUrl: https://example.com/v1
  apiKey: sk-test
  model: my-model
`)
    expect(r.ai).toEqual({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'my-model',
    })
  })

  it('忽略未知字段（为将来留出兼容空间）', () => {
    const r = parseRecipeYaml(`
id: future
name: 未来字段
trigger:
  type: schedule
  cron: "@daily"
prompt: 干活
someUnknownField: 123
`)
    expect(r.id).toBe('future')
  })

  it('拒绝缺失的必填字段', () => {
    expect(() => parseRecipeYaml('name: 缺 id\nprompt: x')).toThrow(/id/)
    expect(() => parseRecipeYaml('id: a\nprompt: x')).toThrow(/name/)
    expect(() => parseRecipeYaml('id: a\nname: b')).toThrow(/trigger/)
    expect(() => parseRecipeYaml('id: a\nname: b\ntrigger:\n  type: schedule\n  cron: "@daily"')).toThrow(/prompt/)
  })

  it('拒绝非法的 id', () => {
    expect(() => parseRecipeYaml('id: "有中文"\nname: b\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x')).toThrow(/id/)
    expect(() => parseRecipeYaml('id: "-开头"\nname: b\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x')).toThrow(/id/)
  })

  it('拒绝非法的 trigger 类型', () => {
    expect(() => parseRecipeYaml('id: a\nname: b\ntrigger:\n  type: whenever\nprompt: x')).toThrow(/schedule/)
  })

  it('schedule 缺少 cron 时报错', () => {
    expect(() => parseRecipeYaml('id: a\nname: b\ntrigger:\n  type: schedule\nprompt: x')).toThrow(/cron/)
  })

  it('cron 非法时报错并带出原因', () => {
    expect(() => parseRecipeYaml('id: a\nname: b\ntrigger:\n  type: schedule\n  cron: "坏表达式"\nprompt: x')).toThrow(/cron/)
  })

  it('拒绝越界的输出路径', () => {
    const base = 'id: a\nname: b\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x\noutput:\n  mode: note\n  path: '
    expect(() => parseRecipeYaml(base + '"/etc/passwd"')).toThrow(/output.path/)
    expect(() => parseRecipeYaml(base + '"../outside.md"')).toThrow(/output.path/)
    expect(() => parseRecipeYaml(base + '"../../outside.md"')).toThrow(/output.path/)
  })

  it('拒绝非法的 output.mode', () => {
    expect(() =>
      parseRecipeYaml('id: a\nname: b\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x\noutput:\n  mode: append'),
    ).toThrow(/output.mode/)
  })

  it('YAML 语法错误时报错', () => {
    expect(() => parseRecipeYaml('id: [未闭合\n')).toThrow(/YAML/)
  })

  it('空文件报错', () => {
    expect(() => parseRecipeYaml('')).toThrow(/为空/)
    expect(() => parseRecipeYaml('# 只有注释\n')).toThrow(/为空/)
  })
})

describe('isSafeRelativePath', () => {
  it('接受库内相对路径', () => {
    expect(isSafeRelativePath('AI/日报.md')).toBe(true)
    expect(isSafeRelativePath('日报.md')).toBe(true)
  })

  it('拒绝绝对路径与越界路径', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:\\Windows\\x.md')).toBe(false)
    expect(isSafeRelativePath('../x.md')).toBe(false)
    expect(isSafeRelativePath('a/../../x.md')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
  })
})
