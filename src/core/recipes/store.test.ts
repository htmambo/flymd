// recipes 目录读写的测试
//
// 这里刻意用**真实文件系统**（Node fs 兜底）而不是内存 Map：
// 配方落盘 → 列出 → 解析 → 冲突检测 → 运行日志追加，是一条完整链路，
// 用假文件系统测不出目录遍历和文件名过滤上的问题。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fsMock = vi.hoisted(() => ({ root: '' }))

vi.mock('../fsSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fsSafe')>()
  const nodeFs = await import('node:fs')
  return {
    ...actual,
    ensureDir: vi.fn(async (dir: string) => {
      nodeFs.mkdirSync(dir, { recursive: true })
    }),
    readTextFileAnySafe: vi.fn(async (p: string) => nodeFs.readFileSync(p, 'utf8')),
    writeTextFileAnySafe: vi.fn(async (p: string, content: string) => {
      nodeFs.writeFileSync(p, content, 'utf8')
    }),
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    if (cmd === 'list_dir_any') {
      const nodeFs = await import('node:fs')
      const path = await import('node:path')
      const out: any[] = []
      let entries: string[] = []
      try {
        entries = nodeFs.readdirSync(args.path)
      } catch {
        return out
      }
      for (const name of entries) {
        const full = path.join(args.path, name)
        let isDir = false
        try {
          isDir = nodeFs.statSync(full).isDirectory()
        } catch {}
        out.push({ name, path: full, is_dir: isDir, is_file: !isDir })
      }
      return out
    }
    return null
  }),
}))

import { loadRecipes, listRecipeFiles, writeRecipeFile, appendRunRecord, readRunRecords, recipesDir, runsFile } from './store'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flymd-recipes-store-'))
  fsMock.root = root
})

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
})

describe('目录与路径', () => {
  it('recipes 目录落在 .flymd/recipes 下', () => {
    expect(recipesDir('/lib')).toBe('/lib/.flymd/recipes')
    expect(recipesDir('/lib/')).toBe('/lib/.flymd/recipes')
    expect(runsFile('/lib')).toBe('/lib/.flymd/recipes/runs.jsonl')
  })
})

describe('listRecipeFiles', () => {
  it('目录不存在时返回空数组（不是错误）', async () => {
    expect(await listRecipeFiles(root)).toEqual([])
  })

  it('只列 yaml/yml 文件，忽略其它文件与子目录', async () => {
    const dir = join(root, '.flymd', 'recipes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.yaml'), 'id: a')
    writeFileSync(join(dir, 'b.yml'), 'id: b')
    writeFileSync(join(dir, 'c.txt'), '不是配方')
    writeFileSync(join(dir, 'runs.jsonl'), '{}')
    mkdirSync(join(dir, '子目录'))

    const files = await listRecipeFiles(root)
    expect(files.sort()).toEqual(['a.yaml', 'b.yml'])
  })
})

describe('loadRecipes', () => {
  it('加载并解析多个 recipe', async () => {
    const dir = join(root, '.flymd', 'recipes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.yaml'), 'id: a\nname: 甲\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: 干甲\n')
    writeFileSync(join(dir, 'b.yaml'), 'id: b\nname: 乙\ntrigger:\n  type: on-save\nprompt: 干乙\n')

    const { recipes, errors } = await loadRecipes(root)
    expect(errors).toEqual([])
    expect(recipes.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(recipes[0].sourceFile).toBeTruthy()
  })

  it('单个文件出错不影响其它文件', async () => {
    const dir = join(root, '.flymd', 'recipes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'good.yaml'), 'id: good\nname: 好\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x\n')
    writeFileSync(join(dir, 'bad.yaml'), 'name: 缺 id\nprompt: x\n')

    const { recipes, errors } = await loadRecipes(root)
    expect(recipes.length).toBe(1)
    expect(recipes[0].id).toBe('good')
    expect(errors.length).toBe(1)
    expect(errors[0].file).toBe('bad.yaml')
    expect(errors[0].error).toContain('id')
  })

  it('id 冲突时保留先读到的，后来的记为错误', async () => {
    const dir = join(root, '.flymd', 'recipes')
    mkdirSync(dir, { recursive: true })
    // 文件按名称排序加载：a.yaml 先
    writeFileSync(join(dir, 'a.yaml'), 'id: same\nname: 甲\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x\n')
    writeFileSync(join(dir, 'b.yaml'), 'id: same\nname: 乙\ntrigger:\n  type: schedule\n  cron: "@daily"\nprompt: x\n')

    const { recipes, errors } = await loadRecipes(root)
    expect(recipes.length).toBe(1)
    expect(recipes[0].name).toBe('甲')
    expect(errors.length).toBe(1)
    expect(errors[0].error).toContain('重复')
  })
})

describe('writeRecipeFile', () => {
  it('自动建目录并写入', async () => {
    await writeRecipeFile(root, 'new.yaml', 'id: new\n')
    expect(existsSync(join(root, '.flymd', 'recipes', 'new.yaml'))).toBe(true)
    expect(readFileSync(join(root, '.flymd', 'recipes', 'new.yaml'), 'utf8')).toContain('id: new')
  })
})

describe('运行日志', () => {
  it('追加并能读回（倒序）', async () => {
    await appendRunRecord(root, { ts: '2026-11-01T09:00:00.000Z', recipeId: 'a', recipeName: '甲', trigger: 'schedule', ok: true, durationMs: 10 })
    await appendRunRecord(root, { ts: '2026-11-02T09:00:00.000Z', recipeId: 'b', recipeName: '乙', trigger: 'on-save', ok: false, durationMs: 20, error: '炸了' })

    const runs = await readRunRecords(root)
    expect(runs.length).toBe(2)
    expect(runs[0].recipeId).toBe('b') // 最近的在前
    expect(runs[1].recipeId).toBe('a')
  })

  it('日志文件是 jsonl，一行一条', async () => {
    await appendRunRecord(root, { ts: '1', recipeId: 'a', recipeName: '甲', trigger: 'schedule', ok: true, durationMs: 1 })
    await appendRunRecord(root, { ts: '2', recipeId: 'b', recipeName: '乙', trigger: 'schedule', ok: true, durationMs: 1 })
    const text = readFileSync(runsFile(root), 'utf8')
    const lines = text.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).recipeId).toBe('a')
  })

  it('坏行被跳过，不影响其余记录', async () => {
    const dir = join(root, '.flymd', 'recipes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(runsFile(root), '{"recipeId":"ok1"}\n这不是 JSON\n{"recipeId":"ok2"}\n')
    const runs = await readRunRecords(root)
    expect(runs.length).toBe(2)
  })

  it('没有日志文件时返回空数组', async () => {
    expect(await readRunRecords(root)).toEqual([])
  })

  it('limit 生效', async () => {
    for (let i = 0; i < 5; i++) {
      await appendRunRecord(root, { ts: String(i), recipeId: 'r' + i, recipeName: 'x', trigger: 'schedule', ok: true, durationMs: 1 })
    }
    expect((await readRunRecords(root, 2)).length).toBe(2)
  })
})
