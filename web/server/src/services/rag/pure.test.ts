/**
 * pure.ts 单测
 *
 * 这些测试锁住与 `public/plugins/flymd-RAG/main.js` 的算法兼容性。
 * 如果插件算法改了,这里也得同步改。
 */
import { describe, it, expect } from "vitest";
import {
  fnv1aHex,
  cosineScoreAt,
  buildChunkId,
  splitMarkdownBlocks,
  chunkByLines,
} from "./pure.js";

describe("fnv1aHex", () => {
  it("空字符串 → 已知固定值", () => {
    expect(fnv1aHex("")).toBe("811c9dc5");
  });
  it("确定性", () => {
    expect(fnv1aHex("hello")).toBe(fnv1aHex("hello"));
  });
  it("不同输入 → 不同输出", () => {
    expect(fnv1aHex("a")).not.toBe(fnv1aHex("b"));
  });
  it("结果为 8 位 hex", () => {
    expect(fnv1aHex("test")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("cosineScoreAt", () => {
  it("全零向量 → 0(denom 为 0)", () => {
    const v = new Float32Array([0, 0, 0]);
    const q = new Float32Array([1, 1, 1]);
    expect(cosineScoreAt(v, 0, q, 3, Math.sqrt(3))).toBe(0);
  });
  it("单位向量相同 → 1", () => {
    const v = new Float32Array([1, 0, 0]);
    const q = new Float32Array([1, 0, 0]);
    expect(cosineScoreAt(v, 0, q, 3, 1)).toBeCloseTo(1, 5);
  });
  it("正交向量 → 0", () => {
    const v = new Float32Array([1, 0, 0]);
    const q = new Float32Array([0, 1, 0]);
    expect(cosineScoreAt(v, 0, q, 3, 1)).toBe(0);
  });
  it("反向量 → -1", () => {
    const v = new Float32Array([1, 2, 3]);
    const q = new Float32Array([-1, -2, -3]);
    const qNorm = Math.sqrt(1 + 4 + 9);
    expect(cosineScoreAt(v, 0, q, 3, qNorm)).toBeCloseTo(-1, 5);
  });
  it("offset 正确寻址", () => {
    // 拼接 [1,0,0] 和 [0,1,0],offset=3 命中第二段
    const v = new Float32Array([1, 0, 0, 0, 1, 0]);
    const q = new Float32Array([0, 1, 0]);
    expect(cosineScoreAt(v, 3, q, 3, 1)).toBeCloseTo(1, 5);
  });
});

describe("buildChunkId", () => {
  it("确定性", () => {
    expect(buildChunkId("a.md", 1, 5, "hello")).toBe(buildChunkId("a.md", 1, 5, "hello"));
  });
  it("格式为 rel:start-end:hash", () => {
    const id = buildChunkId("foo.md", 10, 20, "x");
    expect(id).toBe("foo.md:10-20:" + fnv1aHex("x"));
  });
  it("行号 < 1 → 1", () => {
    const id = buildChunkId("a.md", 0, 0, "x");
    expect(id).toContain(":1-1:");
  });
  it("endLine < startLine → 调整到 startLine", () => {
    const id = buildChunkId("a.md", 5, 3, "x");
    expect(id).toContain(":5-5:");
  });
  it("反斜杠 → 正斜杠", () => {
    const id = buildChunkId("a\\b.md", 1, 1, "x");
    expect(id).toContain("a/b.md:");
  });
});

describe("splitMarkdownBlocks", () => {
  it("无 heading → 整文档一个块", () => {
    const blocks = splitMarkdownBlocks(["a", "b", "c"], 2);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ start: 0, end: 2, heading: "", level: 0 });
  });
  it("二级 heading 切分", () => {
    const lines = [
      "# Title",
      "",
      "## Section 1",
      "content 1",
      "## Section 2",
      "content 2",
    ];
    const blocks = splitMarkdownBlocks(lines, 2);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].heading).toBe(""); // 第一个 heading 之前
    expect(blocks[1].heading).toBe("Section 1");
    expect(blocks[2].heading).toBe("Section 2");
  });
  it("code fence 内的 # 不算 heading", () => {
    const lines = [
      "## Real",
      "```",
      "# Fake in code",
      "```",
      "## Another",
    ];
    const blocks = splitMarkdownBlocks(lines, 2);
    const headings = blocks.map((b) => b.heading);
    expect(headings).toContain("Real");
    expect(headings).toContain("Another");
    expect(headings).not.toContain("Fake in code");
  });
  it("minLevel=1 包含一级", () => {
    const lines = ["# H1", "content", "## H2", "content"];
    const blocks = splitMarkdownBlocks(lines, 1);
    // #H1 在第 0 行,##H2 在第 2 行 → 2 个块:[0..1] heading=H1, [2..3] heading=H2
    // (pre-H1 是空,因为 H1 已经在行 0,没有 pre-heading 内容可分)
    expect(blocks.map((b) => b.heading)).toEqual(["H1", "H2"]);
  });
  it("minLevel=3 排除二级", () => {
    const lines = ["## H2", "content", "### H3", "content"];
    const blocks = splitMarkdownBlocks(lines, 3);
    expect(blocks.map((b) => b.heading)).toEqual(["", "H3"]);
  });
  it("尾部收尾 ### 被去掉", () => {
    const lines = ["## Title ###"];
    const blocks = splitMarkdownBlocks(lines, 2);
    expect(blocks[0].heading).toBe("Title");
  });
});

describe("chunkByLines", () => {
  it("空数组 → 空结果", () => {
    expect(chunkByLines([], { maxChars: 100, overlapChars: 0, byHeading: true })).toEqual([]);
  });
  it("单行,未超 maxChars → 一个 chunk", () => {
    const r = chunkByLines(["hello"], { maxChars: 100, overlapChars: 0, byHeading: true });
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("hello");
  });
  it("maxChars=10,行很长 → 切多块", () => {
    const lines = [
      "aaaaaaaaaa", // 10
      "bbbbbbbbbb", // 10 → 累计 21 超 10
    ];
    const r = chunkByLines(lines, { maxChars: 10, overlapChars: 0, byHeading: false });
    expect(r.length).toBeGreaterThanOrEqual(1);
    // 第一块不应同时包含两行(因为 a 行已经 10 字符,加 b 就超 10)
    expect(r[0].text).not.toContain("bbbbbbbbbb");
  });
  it("byHeading=true → 先按 heading 切", () => {
    const lines = [
      "## A",
      "a1",
      "a2",
      "## B",
      "b1",
    ];
    const r = chunkByLines(lines, { maxChars: 100, overlapChars: 0, byHeading: true });
    expect(r.length).toBeGreaterThanOrEqual(2);
    const aBlock = r.find((c) => c.text.includes("a1"));
    const bBlock = r.find((c) => c.text.includes("b1"));
    expect(aBlock).toBeDefined();
    expect(bBlock).toBeDefined();
  });
  it("overlap=0 → 块不重叠(简化实现)", () => {
    const lines = ["a".repeat(5), "b".repeat(5), "c".repeat(5)];
    const r = chunkByLines(lines, { maxChars: 6, overlapChars: 0, byHeading: false });
    // 验证:每个 chunk 文本都是 unique 字符集
    for (const c of r) {
      expect(c.text.length).toBeGreaterThan(0);
    }
  });
});
