// Recipes 引擎的测试
// 覆盖：加载与调度、on-save 触发与防抖、护栏写回（含快照失败即中止）、
// 输出三种模式、并发跳过、运行日志。

import { describe, it, expect, vi, beforeEach } from 'vitest'

const LIB_ROOT = '/tmp/flymd-recipes-test'

// ---- mock：库作用域 ----
const libStub = vi.hoisted(() => ({ root: '/tmp/flymd-recipes-test' }))

vi.mock('../libraryConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../libraryConfig')>()
  return {
    ...actual,
    LIBRARY_CHANGED_EVENT: 'flymd:library:changed',
    getLibraryScope: () => ({ id: 'lib1', root: libStub.root, persisted: true }),
    resolveLibraryPath: (root: string, rel: string) => `${root.replace(/[\\/]+$/, '')}/${rel}`,
    toLibraryRelativePath: (root: string, p: string) => {
      const r = root.replace(/[\\/]+$/, '')
      const q = p.replace(/\\/g, '/')
      if (!q.startsWith(r + '/')) return null
      return q.slice(r.length + 1)
    },
  }
})

// ---- mock：文件系统 ----
const fsStub = vi.hoisted(() => ({
  files: new Map<string, string>(),
}))

vi.mock('../fsSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fsSafe')>()
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    readTextFileAnySafe: vi.fn(async (p: string) => {
      if (!fsStub.files.has(p)) throw new Error('not found: ' + p)
      return fsStub.files.get(p) as string
    }),
    writeTextFileAnySafe: vi.fn(async (p: string, content: string) => {
      fsStub.files.set(p, content)
    }),
  }
})

// ---- mock：store ----
const storeStub = vi.hoisted(() => ({
  recipes: [] as any[],
  errors: [] as any[],
  runs: [] as any[],
}))

vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store')>()
  return {
    ...actual,
    loadRecipes: vi.fn(async () => ({ recipes: storeStub.recipes, errors: storeStub.errors })),
    appendRunRecord: vi.fn(async (_root: string, record: any) => {
      storeStub.runs.push(record)
    }),
    readRunRecords: vi.fn(async () => storeStub.runs.slice().reverse()),
  }
})

// ---- mock：通知 ----
vi.mock('../uiNotifications', () => ({
  NotificationManager: { show: vi.fn() },
}))

// ---- mock：Tauri invoke ----
const invokeStub = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: any }>,
  snapshotShouldFail: false,
  markdownFiles: [] as string[],
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    invokeStub.calls.push({ cmd, args })
    if (cmd === 'ai_guard_snapshot') {
      if (invokeStub.snapshotShouldFail) throw new Error('快照失败')
      return { id: 'snap-001', path: args.path }
    }
    if (cmd === 'flymd_list_markdown_files') return invokeStub.markdownFiles
    return null
  }),
}))

import { initRecipesEngine } from './engine'

function makeRecipe(over: any = {}) {
  return {
    id: 'r1',
    name: '测试任务',
    enabled: true,
    trigger: { type: 'on-save', paths: ['日记/*.md'] },
    prompt: '处理 {{file}}',
    output: { mode: 'none' },
    ...over,
  }
}

/** 造一个引擎：定时器可控、AI 请求可控 */
function makeEngine(over: any = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = []
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: 'AI 产出' } }] }),
  }))
  const store = {
    get: vi.fn(async () => ({
      'ai.config': {
        provider: 'custom',
        baseUrl: 'https://api.test/v1',
        apiKey: 'sk-test',
        model: 'test-model',
      },
    })),
  }
  const engine = initRecipesEngine({
    getLibraryRoot: () => libStub.root,
    getStore: () => store as any,
    setTimeoutFn: (fn: () => void, ms: number) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeoutFn: () => {},
    invokeImpl: (cmd: string, args: any) => {
      invokeStub.calls.push({ cmd, args })
      if (cmd === 'ai_guard_snapshot') {
        if (invokeStub.snapshotShouldFail) throw new Error('快照失败')
        return Promise.resolve({ id: 'snap-001', path: args.path })
      }
      if (cmd === 'flymd_list_markdown_files') return Promise.resolve(invokeStub.markdownFiles)
      return Promise.resolve(null)
    },
    fetchImpl: fetchImpl as any,
    notify: vi.fn(),
    ...over,
  })
  return { engine, timers, fetchImpl }
}

/** 等异步任务跑完 */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  libStub.root = LIB_ROOT
  fsStub.files.clear()
  storeStub.recipes = []
  storeStub.errors = []
  storeStub.runs = []
  invokeStub.calls = []
  invokeStub.snapshotShouldFail = false
  invokeStub.markdownFiles = []
})

describe('加载与调度', () => {
  it('reload 后按 cron 排定下一次触发', async () => {
    storeStub.recipes = [
      makeRecipe({ id: 'cron1', trigger: { type: 'schedule', cron: '0 9 * * *' } }),
      makeRecipe({ id: 'save1' }),
    ]
    const { engine, timers } = makeEngine()
    await engine.reload()

    expect(timers.length).toBe(1) // 只有 schedule 型的排定时器
    expect(timers[0].ms).toBeGreaterThan(0)

    const list = await engine.list()
    expect(list.length).toBe(2)
    const cronView = list.find((r) => r.id === 'cron1')
    expect(cronView?.nextRunAt).toBeTruthy()
  })

  it('禁用的 recipe 不排定时器', async () => {
    storeStub.recipes = [
      makeRecipe({ id: 'off', enabled: false, trigger: { type: 'schedule', cron: '0 9 * * *' } }),
    ]
    const { engine, timers } = makeEngine()
    await engine.reload()
    expect(timers.length).toBe(0)
  })

  it('解析错误的 recipe 也会列出来并标记 broken', async () => {
    storeStub.recipes = [makeRecipe()]
    storeStub.errors = [{ file: 'bad.yaml', error: 'id 缺失' }]
    const { engine } = makeEngine()
    await engine.reload()
    const list = await engine.list()
    const broken = list.find((r) => r.broken)
    expect(broken?.sourceFile).toBe('bad.yaml')
  })
})

describe('on-save 触发', () => {
  it('路径命中时执行并把 AI 结果写回', async () => {
    storeStub.recipes = [
      makeRecipe({
        output: { mode: 'replace', path: 'AI/结果.md' },
      }),
    ]
    fsStub.files.set(`${LIB_ROOT}/日记/今天.md`, '- [ ] 写周报')

    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // 提示词里带上了触发文件的相对路径
    const init = (fetchImpl.mock.calls[0] as any)[1]
    const body = JSON.parse(init.body)
    expect(body.messages[1].content).toContain('日记/今天.md')

    // 写回落到目标笔记
    expect(fsStub.files.get(`${LIB_ROOT}/AI/结果.md`)).toBe('AI 产出')
  })

  it('路径不命中时不执行', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/其它/今天.md`)
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('防抖窗口内的重复保存不重复触发', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('保存事件不在库内时被忽略', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved('/tmp/别的库/日记/今天.md')
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('写回与护栏', () => {
  it('写回前先建护栏快照', async () => {
    storeStub.recipes = [makeRecipe({ output: { mode: 'replace', path: 'AI/结果.md' } })]
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    const snapCall = invokeStub.calls.find((c) => c.cmd === 'ai_guard_snapshot')
    expect(snapCall).toBeTruthy()
    expect(snapCall!.args.libraryRoot).toBe(LIB_ROOT)
    expect(snapCall!.args.actor).toBe('recipe')
    expect(snapCall!.args.newContent).toBe('AI 产出')
  })

  it('快照失败即中止写入', async () => {
    storeStub.recipes = [makeRecipe({ output: { mode: 'replace', path: 'AI/结果.md' } })]
    invokeStub.snapshotShouldFail = true
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(fsStub.files.has(`${LIB_ROOT}/AI/结果.md`)).toBe(false)
    expect(storeStub.runs[0]?.ok).toBe(false)
    expect(storeStub.runs[0]?.error).toMatch(/快照失败/)
  })

  it('note 模式追加到已有内容之后', async () => {
    storeStub.recipes = [makeRecipe({ output: { mode: 'note', path: 'AI/结果.md' } })]
    fsStub.files.set(`${LIB_ROOT}/AI/结果.md`, '旧内容')
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    const content = fsStub.files.get(`${LIB_ROOT}/AI/结果.md`) || ''
    expect(content).toContain('旧内容')
    expect(content).toContain('AI 产出')
  })

  it('mode=none 时不写任何文件', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(invokeStub.calls.some((c) => c.cmd === 'ai_guard_snapshot')).toBe(false)
    expect(fsStub.files.size).toBe(0)
  })

  it('目标落在尚不存在的子目录时先建目录再写', async () => {
    storeStub.recipes = [makeRecipe({ output: { mode: 'replace', path: 'AI/子目录/结果.md' } })]
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    const { ensureDir } = await import('../fsSafe')
    expect((ensureDir as any).mock.calls.some((c: any[]) => c[0] === `${LIB_ROOT}/AI/子目录`)).toBe(true)
    expect(fsStub.files.get(`${LIB_ROOT}/AI/子目录/结果.md`)).toBe('AI 产出')
  })
})

describe('手动执行与运行日志', () => {
  it('runNow 执行指定 recipe 并返回记录', async () => {
    storeStub.recipes = [makeRecipe({ id: 'manual1', output: { mode: 'none' } })]
    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    const rec = await engine.runNow('manual1')
    expect(rec?.ok).toBe(true)
    expect(rec?.trigger).toBe('manual')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('runNow 对不存在的 recipe 返回 null', async () => {
    const { engine } = makeEngine()
    await engine.reload()
    expect(await engine.runNow('不存在')).toBeNull()
  })

  it('每次执行都写一条运行日志', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(storeStub.runs.length).toBe(1)
    expect(storeStub.runs[0].recipeId).toBe('r1')
    expect(storeStub.runs[0].trigger).toBe('on-save')
    expect(storeStub.runs[0].ok).toBe(true)
    expect(storeStub.runs[0].excerpt).toBe('AI 产出')
  })

  it('AI 调用失败时记录失败原因', async () => {
    storeStub.recipes = [makeRecipe()]
    const { engine } = makeEngine({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any,
    })
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(storeStub.runs[0].ok).toBe(false)
    expect(storeStub.runs[0].error).toMatch(/500/)
  })
})

describe('模板变量', () => {
  it('on-save 时把文件内容与待办放进变量', async () => {
    storeStub.recipes = [makeRecipe({ prompt: '待办：{{todos}}\n正文：{{content}}' })]
    fsStub.files.set(`${LIB_ROOT}/日记/今天.md`, '- [ ] 写周报\n正文内容')

    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    const init = (fetchImpl.mock.calls[0] as any)[1]
    const body = JSON.parse(init.body)
    expect(body.messages[1].content).toContain('写周报')
    expect(body.messages[1].content).toContain('正文内容')
  })

  it('引用 {{files}} 时才做全库扫描', async () => {
    storeStub.recipes = [makeRecipe({ prompt: '文件列表：{{files}}' })]
    invokeStub.markdownFiles = [`${LIB_ROOT}/a.md`, `${LIB_ROOT}/子/b.md`]

    const { engine, fetchImpl } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()

    expect(invokeStub.calls.some((c) => c.cmd === 'flymd_list_markdown_files')).toBe(true)
    const init = (fetchImpl.mock.calls[0] as any)[1]
    const body = JSON.parse(init.body)
    expect(body.messages[1].content).toContain('a.md')
    expect(body.messages[1].content).toContain('子/b.md')
  })

  it('未引用 {{files}} 时不做全库扫描', async () => {
    storeStub.recipes = [makeRecipe({ prompt: '没有文件列表' })]
    const { engine } = makeEngine()
    await engine.reload()
    engine.onFileSaved(`${LIB_ROOT}/日记/今天.md`)
    await flush()
    expect(invokeStub.calls.some((c) => c.cmd === 'flymd_list_markdown_files')).toBe(false)
  })
})
