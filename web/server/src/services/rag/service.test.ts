/**
 * service.ts 单测(全部用假 deps,无 IO)
 */
import { describe, it, expect } from "vitest";
import {
  RagService,
  FileIndexReader,
  OpenAIEmbedder,
  formatContext,
  buildAskPrompt,
  DEFAULT_SYSTEM_PROMPT,
  getLibraryId,
  getIndexDir,
  type RagIndex,
  type Embedder,
  type Llm,
  type IndexReader,
} from "./service.js";
import { fnv1aHex } from "./pure.js";

// ============================================================
// 假 deps 工厂
// ============================================================

function fakeIndexReader(chunks: Record<string, { vec: number[]; rel: string; start: number; end: number; text: string; heading?: string }>, dims: number = 4): IndexReader {
  const vectors: number[] = [];
  const meta: RagIndex["meta"] = {
    schemaVersion: 1,
    embeddingModel: "fake-model",
    dims,
    chunks: {},
  };
  let offset = 0;
  for (const [id, c] of Object.entries(chunks)) {
    const chunkVec = c.vec.slice(0, dims);
    while (chunkVec.length < dims) chunkVec.push(0);
    vectors.push(...chunkVec);
    meta.chunks[id] = {
      id,
      relativePath: c.rel,
      startLine: c.start,
      endLine: c.end,
      text: c.text,
      heading: c.heading,
      vectorOffset: offset,
    };
    offset += dims;
  }
  const idx: RagIndex = { meta, vectors: Float32Array.from(vectors) };
  return {
    async load(_root: string) {
      return idx;
    },
  };
}

function fakeEmbedder(perInput: (input: string) => number[]): Embedder {
  return {
    async embed(inputs: string[]) {
      return inputs.map(perInput);
    },
  };
}

function fakeLlm(holder: { messages?: Array<{ role: string; content: string }> }, response: { content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }): Llm {
  return {
    async chat(messages) {
      // holder 是 mutable 引用,测试用例在调用后读 holder.messages
      holder.messages = messages as Array<{ role: string; content: string }>;
      return response;
    },
  };
}

// ============================================================
// formatContext / buildAskPrompt
// ============================================================

describe("formatContext", () => {
  it("无 hits → 占位", () => {
    expect(formatContext([], "q")).toBe("(无相关资料)");
  });
  it("正常拼接 [1] [2] + score + relative", () => {
    const hits = [
      {
        id: "a:1-1:h",
        score: 0.9,
        filePath: "/x/a.md",
        relative: "a.md",
        heading: "标题",
        startLine: 1,
        endLine: 1,
        snippet: "hello world",
      },
      {
        id: "b:1-1:h",
        score: 0.7,
        filePath: "/x/b.md",
        relative: "b.md",
        heading: "",
        startLine: 1,
        endLine: 1,
        snippet: "second",
      },
    ];
    const out = formatContext(hits, "q");
    expect(out).toContain("[1]");
    expect(out).toContain("a.md L1-1");
    expect(out).toContain("标题");
    expect(out).toContain("hello world");
    expect(out).toContain("[2]");
    expect(out).toContain("b.md L1-1");
  });
  it("超 maxContextChars 截断 + ...", () => {
    const long = "x".repeat(5000);
    const hits = [
      {
        id: "a:1-1:h",
        score: 0.9,
        filePath: "/x/a.md",
        relative: "a.md",
        heading: "",
        startLine: 1,
        endLine: 1,
        snippet: long,
      },
    ];
    const out = formatContext(hits, "q", 500);
    expect(out.length).toBeLessThanOrEqual(550);
    expect(out).toContain("...");
  });
});

describe("buildAskPrompt", () => {
  it("默认 system + user 含 <context> 块", () => {
    const hits = [
      {
        id: "a:1-1:h",
        score: 0.9,
        filePath: "/x/a.md",
        relative: "a.md",
        heading: "H",
        startLine: 1,
        endLine: 1,
        snippet: "S",
      },
    ];
    const { system, user } = buildAskPrompt(hits, "Q?", 8000);
    expect(system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(user).toContain("<context>");
    expect(user).toContain("</context>");
    expect(user).toContain("Q?");
    expect(user).toContain("[1]");
  });
  it("覆盖 systemPrompt", () => {
    const { system } = buildAskPrompt([], "Q", 8000, "MY CUSTOM");
    expect(system).toBe("MY CUSTOM");
  });
});

// ============================================================
// libraryId / indexDir
// ============================================================

describe("getLibraryId", () => {
  it("确定性 + 8 hex", () => {
    const a = getLibraryId("/path/to/lib");
    const b = getLibraryId("/path/to/lib");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  it("路径分隔符归一化", () => {
    expect(getLibraryId("/path\\to\\lib")).toBe(getLibraryId("/path/to/lib"));
  });
  it("大小写归一化", () => {
    expect(getLibraryId("/PATH/LIB")).toBe(getLibraryId("/path/lib"));
  });
  it("与 FNV-1A 一致", () => {
    const norm = "/path/to/lib";
    expect(getLibraryId(norm)).toBe(fnv1aHex(norm.toLowerCase().replace(/\/$/, "")));
  });
});

describe("getIndexDir", () => {
  it("格式: <root>/.flymd/rag-index/<libId>", () => {
    const d = getIndexDir("/x");
    expect(d).toBe(`/x/.flymd/rag-index/${getLibraryId("/x")}`);
  });
});

// ============================================================
// RagService.searchHits
// ============================================================

describe("RagService.searchHits", () => {
  it("按 cosine 分数降序", async () => {
    // query = (1,0,0,0), chunks: A=(1,0,0,0) → 1, B=(0,1,0,0) → 0, C=(0.5,0.5,0,0) → 0.707
    const idx = fakeIndexReader({
      ["a:1-1:" + fnv1aHex("A")]: { vec: [1, 0, 0, 0], rel: "a.md", start: 1, end: 1, text: "A" },
      ["b:1-1:" + fnv1aHex("B")]: { vec: [0, 1, 0, 0], rel: "b.md", start: 1, end: 1, text: "B" },
      ["c:1-1:" + fnv1aHex("C")]: { vec: [0.5, 0.5, 0, 0], rel: "c.md", start: 1, end: 1, text: "C" },
    }, 4);
    const svc = new RagService({
      indexReader: idx,
      embedder: fakeEmbedder(() => [1, 0, 0, 0]),
      llm: fakeLlm({}, { content: "" }),
    });
    const hits = await svc.searchHits("/lib", "q");
    expect(hits.map((h) => h.relative)).toEqual(["a.md", "c.md", "b.md"]);
    expect(hits[0].score).toBeCloseTo(1, 4);
    expect(hits[1].score).toBeCloseTo(0.7071, 3);
    expect(hits[2].score).toBeCloseTo(0, 4);
  });

  it("minScore 过滤", async () => {
    const idx = fakeIndexReader({
      ["a:1-1:" + fnv1aHex("A")]: { vec: [1, 0, 0, 0], rel: "a.md", start: 1, end: 1, text: "A" },
      ["b:1-1:" + fnv1aHex("B")]: { vec: [0, 1, 0, 0], rel: "b.md", start: 1, end: 1, text: "B" },
    }, 4);
    const svc = new RagService({
      indexReader: idx,
      embedder: fakeEmbedder(() => [1, 0, 0, 0]),
      llm: fakeLlm({}, { content: "" }),
    });
    const hits = await svc.searchHits("/lib", "q", { minScore: 0.5 });
    expect(hits.map((h) => h.relative)).toEqual(["a.md"]);
  });

  it("topK 截断", async () => {
    const chunks: Record<string, { vec: number[]; rel: string; start: number; end: number; text: string }> = {};
    for (let i = 0; i < 10; i++) {
      chunks[`c${i}:1-1:${fnv1aHex("t" + i)}`] = {
        vec: [1, i * 0.01, 0, 0],
        rel: `c${i}.md`,
        start: 1,
        end: 1,
        text: `t${i}`,
      };
    }
    const svc = new RagService({
      indexReader: fakeIndexReader(chunks, 4),
      embedder: fakeEmbedder(() => [1, 0, 0, 0]),
      llm: fakeLlm({}, { content: "" }),
    });
    const hits = await svc.searchHits("/lib", "q", { topK: 3 });
    expect(hits).toHaveLength(3);
  });

  it("空 query 返空", async () => {
    const svc = new RagService({
      indexReader: fakeIndexReader({}, 4),
      embedder: fakeEmbedder(() => [0, 0, 0, 0]),
      llm: fakeLlm({}, { content: "" }),
    });
    expect(await svc.searchHits("/lib", "  ")).toEqual([]);
  });

  it("缺 libraryRoot 抛错", async () => {
    const svc = new RagService({
      indexReader: fakeIndexReader({}, 4),
      embedder: fakeEmbedder(() => [0, 0, 0, 0]),
      llm: fakeLlm({}, { content: "" }),
    });
    await expect(svc.searchHits("", "q")).rejects.toThrow(/libraryRoot/);
  });

  it("query 维度不一致抛错", async () => {
    const svc = new RagService({
      indexReader: fakeIndexReader({}, 4),
      embedder: fakeEmbedder(() => [1, 0]), // 维度 2
      llm: fakeLlm({}, { content: "" }),
    });
    await expect(svc.searchHits("/lib", "q")).rejects.toThrow(/维度/);
  });
});

// ============================================================
// RagService.askWithContext
// ============================================================

describe("RagService.askWithContext", () => {
  it("完整 RAG 闭环:search → prompt → llm → 返 answer + sources", async () => {
    const cap: { messages?: Array<{ role: string; content: string }> } = {};
    const idx = fakeIndexReader({
      ["a:1-1:" + fnv1aHex("A")]: { vec: [1, 0, 0, 0], rel: "a.md", start: 1, end: 1, text: "A" },
    }, 4);
    const svc = new RagService({
      indexReader: idx,
      embedder: fakeEmbedder(() => [1, 0, 0, 0]),
      llm: fakeLlm(cap, {
        content: "这是答案 [1]",
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    });
    const r = await svc.askWithContext("/lib", "Q?", { model: "m" });
    expect(r.answer).toBe("这是答案 [1]");
    expect(r.model).toBe("m");
    expect(r.usage?.total_tokens).toBe(110);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].relative).toBe("a.md");
    // 验证 LLM 收到的 prompt
    const msgs = cap.messages!;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(msgs[1].content).toContain("<context>");
    expect(msgs[1].content).toContain("[1]");
    expect(msgs[1].content).toContain("Q?");
  });

  it("覆盖 systemPrompt", async () => {
    const cap: { messages?: Array<{ role: string; content: string }> } = {};
    const idx = fakeIndexReader({}, 4);
    const svc = new RagService({
      indexReader: idx,
      embedder: fakeEmbedder(() => [1, 0, 0, 0]),
      llm: fakeLlm(cap, { content: "ok" }),
    });
    await svc.askWithContext("/lib", "q", { systemPrompt: "MY SYSTEM" });
    const msgs = cap.messages!;
    expect(msgs[0].content).toBe("MY SYSTEM");
  });
});

// ============================================================
// OpenAIEmbedder(只验构造校验,不发真请求)
// ============================================================

describe("OpenAIEmbedder", () => {
  it("公网 https 构造成功", () => {
    expect(() => new OpenAIEmbedder({ baseUrl: "https://api.openai.com/v1", model: "m" })).not.toThrow();
  });
  it("私网 baseUrl 默认拒绝", () => {
    expect(() => new OpenAIEmbedder({ baseUrl: "http://127.0.0.1:8080", model: "m" })).toThrow(/校验失败/);
  });
  it("allowPrivate=true 放行", () => {
    expect(() => new OpenAIEmbedder({ baseUrl: "http://127.0.0.1:8080", model: "m", allowPrivate: true })).not.toThrow();
  });
  it("file:// 拒绝", () => {
    expect(() => new OpenAIEmbedder({ baseUrl: "file:///etc", model: "m" })).toThrow(/校验失败/);
  });
});
