// AI 配置解析与请求的测试
// 重点：配置优先级必须稳定（recipe 内联 > AI 助手 > 内置免费模式），
// 以及"没配 Key"时给出的提示要能指导用户去哪儿配。

import { describe, it, expect, vi } from 'vitest'
import {
  resolveAiSettings,
  buildApiUrl,
  buildApiHeaders,
  buildRollingClientToken,
  extractAiText,
  callAi,
} from './ai'
import type { Recipe } from './types'

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r',
    name: 'R',
    enabled: true,
    trigger: { type: 'schedule', cron: '@daily' },
    prompt: 'p',
    output: { mode: 'none' },
    ...over,
  }
}

function storeWith(cfg: any) {
  return {
    get: vi.fn(async (key: string) => {
      if (key === 'plugin:ai-assistant') return { 'ai.config': cfg }
      return null
    }),
  }
}

describe('resolveAiSettings', () => {
  it('没有 AI 助手配置时回落到内置免费模式', async () => {
    const s = await resolveAiSettings(null, { getStore: () => null })
    expect(s.provider).toBe('free')
    expect(s.model).toBe('Qwen/Qwen3-8B')
    expect(s.baseUrl).toContain('ai_proxy.php')
  })

  it('读取 AI 助手的自定义配置', async () => {
    const s = await resolveAiSettings(null, {
      getStore: () => storeWith({
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-abc',
        model: 'gpt-4o',
      }) as any,
    })
    expect(s.provider).toBe('custom')
    expect(s.baseUrl).toBe('https://api.example.com/v1')
    expect(s.apiKey).toBe('sk-abc')
    expect(s.model).toBe('gpt-4o')
  })

  it('AI 助手的免费档位映射到对应模型', async () => {
    const s = await resolveAiSettings(null, {
      getStore: () => storeWith({ provider: 'free', freeModel: 'gemini' }) as any,
    })
    expect(s.model).toBe('gemini-2.5-flash')
    expect(s.provider).toBe('free')
  })

  it('recipe 内联配置覆盖 AI 助手配置', async () => {
    const s = await resolveAiSettings(
      makeRecipe({ ai: { baseUrl: 'https://recipe.example/v1', apiKey: 'sk-recipe', model: 'r-model' } }),
      {
        getStore: () => storeWith({
          provider: 'custom',
          baseUrl: 'https://assistant.example/v1',
          apiKey: 'sk-assistant',
          model: 'a-model',
        }) as any,
      },
    )
    expect(s.baseUrl).toBe('https://recipe.example/v1')
    expect(s.apiKey).toBe('sk-recipe')
    expect(s.model).toBe('r-model')
  })

  it('recipe 顶层的 model 覆盖一切', async () => {
    const s = await resolveAiSettings(
      makeRecipe({ model: 'top-model', ai: { model: 'inline-model' } }),
      { getStore: () => null },
    )
    expect(s.model).toBe('top-model')
  })
})

describe('buildApiUrl', () => {
  it('补齐 /chat/completions', () => {
    expect(buildApiUrl({ baseUrl: 'https://x.com/v1', apiKey: '', model: 'm', provider: 'custom' }))
      .toBe('https://x.com/v1/chat/completions')
  })

  it('去掉结尾多余的斜杠', () => {
    expect(buildApiUrl({ baseUrl: 'https://x.com/v1//', apiKey: '', model: 'm', provider: 'custom' }))
      .toBe('https://x.com/v1/chat/completions')
  })

  it('已经是完整路径时不再拼接', () => {
    expect(buildApiUrl({ baseUrl: 'https://x.com/v1/chat/completions', apiKey: '', model: 'm', provider: 'custom' }))
      .toBe('https://x.com/v1/chat/completions')
  })
})

describe('buildApiHeaders', () => {
  it('自定义服务带 Authorization', () => {
    const h = buildApiHeaders({ baseUrl: 'x', apiKey: 'sk-1', model: 'm', provider: 'custom' }, 0)
    expect(h.Authorization).toBe('Bearer sk-1')
    expect(h['X-Flymd-Token']).toBeUndefined()
  })

  it('免费模式不带 Key，但带滚动令牌', () => {
    const h = buildApiHeaders({ baseUrl: 'x', apiKey: '', model: 'm', provider: 'free' }, 0)
    expect(h.Authorization).toBeUndefined()
    expect(String(h['X-Flymd-Token'])).toMatch(/^flymd-[0-9a-f]{16}$/)
  })
})

describe('buildRollingClientToken', () => {
  it('同一时间窗口内结果稳定', () => {
    const a = buildRollingClientToken(0)
    const b = buildRollingClientToken(1000)
    expect(a).toBe(b)
  })

  it('跨窗口后变化', () => {
    const a = buildRollingClientToken(0)
    const b = buildRollingClientToken(120000)
    expect(a).not.toBe(b)
  })
})

describe('extractAiText', () => {
  it('解析标准 JSON 响应', () => {
    const raw = JSON.stringify({ choices: [{ message: { content: '  你好  ' } }] })
    expect(extractAiText(raw)).toBe('你好')
  })

  it('解析 SSE 流式响应', () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      '',
      'data: [DONE]',
    ].join('\n')
    expect(extractAiText(raw)).toBe('你好')
  })

  it('空内容返回空串', () => {
    expect(extractAiText('')).toBe('')
    expect(extractAiText('{}')).toBe('')
  })
})

describe('callAi', () => {
  const settings = { baseUrl: 'https://x.com/v1', apiKey: 'sk-1', model: 'm', provider: 'custom' as const }

  it('成功时返回文本与模型', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '结果' } }] }),
    }))
    const r = await callAi({ prompt: '问题' }, settings, { fetchImpl: fetchImpl as any })
    expect(r.text).toBe('结果')
    expect(r.model).toBe('m')

    // 请求体正确
    const [, init] = fetchImpl.mock.calls[0] as any
    const body = JSON.parse(init.body)
    expect(body.model).toBe('m')
    expect(body.stream).toBe(false)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toBe('问题')
  })

  it('HTTP 失败时抛出带状态码的错误', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }))
    await expect(callAi({ prompt: 'x' }, settings, { fetchImpl: fetchImpl as any }))
      .rejects.toThrow(/429/)
  })

  it('未配置 Key 时给出可操作的提示', async () => {
    await expect(
      callAi({ prompt: 'x' }, { ...settings, apiKey: '' }, { fetchImpl: (async () => ({})) as any }),
    ).rejects.toThrow(/API Key/)
  })

  it('提示词为空时报错', async () => {
    await expect(callAi({ prompt: '  ' }, settings, { fetchImpl: (async () => ({})) as any }))
      .rejects.toThrow(/提示词为空/)
  })
})
