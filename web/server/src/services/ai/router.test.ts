/**
 * Router 单测
 *
 * 不依赖真 API,纯函数测试。
 * 跑法:cd web && npm test
 */
import { describe, it, expect } from "vitest";
import {
  inferProviderByModel,
  loadProviderConfigs,
  pickProvider,
  normalizeError,
} from "./router.js";

describe("inferProviderByModel", () => {
  it("GPT 系列 → openai", () => {
    expect(inferProviderByModel("gpt-4o-mini")).toBe("openai");
    expect(inferProviderByModel("gpt-4")).toBe("openai");
    expect(inferProviderByModel("o1-preview")).toBe("openai");
    expect(inferProviderByModel("text-embedding-3-small")).toBe("openai");
  });
  it("Claude 系列 → anthropic", () => {
    expect(inferProviderByModel("claude-3-5-sonnet-20241022")).toBe("anthropic");
    expect(inferProviderByModel("claude-3-haiku-20240307")).toBe("anthropic");
  });
  it("Ollama / 开源模型 → ollama", () => {
    expect(inferProviderByModel("ollama:qwen2.5")).toBe("ollama");
    expect(inferProviderByModel("qwen2.5:7b")).toBe("ollama");
    expect(inferProviderByModel("llama3.1")).toBe("ollama");
    expect(inferProviderByModel("deepseek-r1")).toBe("ollama");
  });
  it("未知 → generic-openai(兜底)", () => {
    expect(inferProviderByModel("some-custom-model")).toBe("generic-openai");
    expect(inferProviderByModel("")).toBe("generic-openai");
  });
});

describe("loadProviderConfigs", () => {
  it("从 settings key/value 数组解析 provider configs", () => {
    const settings = [
      { key: "ai.providers.openai.apiKey", value: "sk-xxx" },
      { key: "ai.providers.openai.baseUrl", value: "https://api.openai.com" },
      { key: "ai.providers.openai.enabled", value: true },
      { key: "ai.providers.ollama.baseUrl", value: "http://localhost:11434" },
      { key: "ai.providers.ollama.enabled", value: true },
      // 禁用的应被排除
      { key: "ai.providers.generic-openai.apiKey", value: "abc" },
      { key: "ai.providers.generic-openai.enabled", value: false },
      // 未知 provider 应被忽略
      { key: "ai.providers.fake.model", value: "x" },
      // 无关 key
      { key: "apikey.github", value: "ghp" },
    ];
    const configs = loadProviderConfigs(settings);
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.provider === "openai")).toBeDefined();
    expect(configs.find((c) => c.provider === "ollama")).toBeDefined();
    expect(configs.find((c) => c.provider === "generic-openai")).toBeUndefined();
  });
  it("Ollama 允许无 apiKey", () => {
    const settings = [
      { key: "ai.providers.ollama.baseUrl", value: "http://localhost:11434" },
      { key: "ai.providers.ollama.enabled", value: true },
    ];
    const configs = loadProviderConfigs(settings);
    expect(configs).toHaveLength(1);
    expect(configs[0].apiKey).toBe("");
  });
});

describe("pickProvider", () => {
  const configs = [
    { provider: "openai" as const, apiKey: "sk-1", enabled: true },
    { provider: "ollama" as const, apiKey: "", enabled: true },
    { provider: "generic-openai" as const, apiKey: "x", enabled: true },
  ];

  it("gpt-* → 选 openai", () => {
    expect(pickProvider("gpt-4o-mini", configs)?.provider).toBe("openai");
  });
  it("qwen* → 选 ollama", () => {
    expect(pickProvider("qwen2.5:7b", configs)?.provider).toBe("ollama");
  });
  it("unknown model → 选 generic-openai(优先)", () => {
    expect(pickProvider("custom-model", configs)?.provider).toBe("generic-openai");
  });
  it("configs 为空 → null", () => {
    expect(pickProvider("gpt-4o-mini", [])).toBeNull();
  });
});

describe("normalizeError", () => {
  it("HTTP 401 → auth", () => {
    const e = new Error("HTTP 401: bad token");
    const r = normalizeError(e);
    expect(r.type).toBe("auth");
    expect(r.status).toBe(401);
    expect(r.retryable).toBe(false);
  });
  it("HTTP 429 → rate_limit", () => {
    const r = normalizeError(new Error("HTTP 429: slow down"));
    expect(r.type).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });
  it("HTTP 500 → upstream + retryable", () => {
    const r = normalizeError(new Error("HTTP 500: oops"));
    expect(r.type).toBe("upstream");
    expect(r.retryable).toBe(true);
  });
  it("fetch failed → upstream + 502", () => {
    const r = normalizeError(new Error("fetch failed"));
    expect(r.type).toBe("upstream");
    expect(r.status).toBe(502);
  });
  it("timeout 关键词 → timeout", () => {
    const r = normalizeError(new Error("request aborted: timeout"));
    expect(r.type).toBe("timeout");
    expect(r.status).toBe(504);
  });
  it("未知 Error → internal + 500", () => {
    const r = normalizeError(new Error("weird bug"));
    expect(r.type).toBe("internal");
    expect(r.status).toBe(500);
  });
});
