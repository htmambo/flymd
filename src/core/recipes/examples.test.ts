// 出厂示例 recipe 的校验测试
//
// 文档里的示例如果解析不过，用户照抄就白忙一场——所以直接拿真文件跑一遍解析。
// 示例放在 docs/Usage/examples/recipes/，对应用户指南 docs/Usage/RECIPES_GUIDE.md。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRecipeYaml } from './parse'

// 示例目录：docs/Usage/examples/recipes/（相对本测试文件）
const EXAMPLES_DIR = fileURLToPath(new URL('../../../docs/Usage/examples/recipes/', import.meta.url))

describe('出厂示例 recipe', () => {
  it('示例目录存在且不为空', () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => /\.ya?ml$/i.test(f))
    expect(files.length).toBeGreaterThan(0)
  })

  it('每个示例都能被解析成合法 recipe', () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => /\.ya?ml$/i.test(f))
    for (const file of files) {
      const text = readFileSync(join(EXAMPLES_DIR, file), 'utf8')
      const recipe = parseRecipeYaml(text, file)
      expect(recipe.id, `${file} 的 id`).toBeTruthy()
      expect(recipe.name, `${file} 的 name`).toBeTruthy()
      expect(recipe.prompt.length, `${file} 的 prompt`).toBeGreaterThan(0)
      expect(['schedule', 'on-save']).toContain(recipe.trigger.type)
      if (recipe.trigger.type === 'schedule') {
        expect(recipe.trigger.cron, `${file} 的 cron`).toBeTruthy()
      }
    }
  })

  it('示例的 id 互不重复', () => {
    const files = readdirSync(EXAMPLES_DIR).filter((f) => /\.ya?ml$/i.test(f))
    const ids = files.map((file) => {
      const text = readFileSync(join(EXAMPLES_DIR, file), 'utf8')
      return parseRecipeYaml(text, file).id
    })
    expect(new Set(ids).size).toBe(ids.length)
  })
})
