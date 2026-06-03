/**
 * Notify 模块单测(纯函数 + 签名)
 */
import { describe, it, expect } from "vitest";
import { signFeishu, sendFeishu } from "./feishu.js";
import { signDingtalk, appendDingtalkSign } from "./dingtalk.js";
import { makeDedupKey } from "./dedup.js";
import {
  listChannelsFromSettings, isValidChannelId, channelsForEvent, findChannel, maskChannel,
} from "./store.js";
import type { NotifyChannelConfig } from "./types.js";

describe("signFeishu", () => {
  it("签名确定性(同 secret+ts → 同结果)", () => {
    const a = signFeishu("SEC123", 1700000000);
    const b = signFeishu("SEC123", 1700000000);
    expect(a).toBe(b);
  });
  it("不同 ts → 不同结果", () => {
    const a = signFeishu("SEC", 1);
    const b = signFeishu("SEC", 2);
    expect(a).not.toBe(b);
  });
  it("不同 secret → 不同结果", () => {
    const a = signFeishu("AAA", 100);
    const b = signFeishu("BBB", 100);
    expect(a).not.toBe(b);
  });
  it("签名结果是 base64 字符串", () => {
    const s = signFeishu("x", 1);
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    // base64 charset
    expect(/^[A-Za-z0-9+/=]+$/.test(s)).toBe(true);
  });
});

describe("signDingtalk + appendDingtalkSign", () => {
  it("signDingtalk 确定性", () => {
    const a = signDingtalk("SEC", 1700000000000);
    const b = signDingtalk("SEC", 1700000000000);
    expect(a).toBe(b);
  });
  it("appendDingtalkSign 拼接到 URL", () => {
    const url = "https://oapi.dingtalk.com/robot/send?access_token=ABC";
    const signed = appendDingtalkSign(url, "SEC", 1700000000000);
    expect(signed).toContain("timestamp=1700000000000");
    expect(signed).toContain("sign=");
    // access_token 保留
    expect(signed).toContain("access_token=ABC");
  });
  it("appendDingtalkSign 对无 ? 的 URL 用 ? 开头", () => {
    const url = "https://example.com/hook";
    const signed = appendDingtalkSign(url, "S", 100);
    expect(signed.startsWith(url + "?")).toBe(true);
  });
});

describe("makeDedupKey", () => {
  it("同 event+message+detail → 同 key", () => {
    const a = makeDedupKey("ai_error", "fail", { x: 1 });
    const b = makeDedupKey("ai_error", "fail", { x: 1 });
    expect(a).toBe(b);
  });
  it("不同 detail → 不同 key", () => {
    const a = makeDedupKey("e", "m", { x: 1 });
    const b = makeDedupKey("e", "m", { x: 2 });
    expect(a).not.toBe(b);
  });
  it("key 是 16 字符 hex", () => {
    const k = makeDedupKey("a", "b");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("isValidChannelId", () => {
  it("接受合法 id", () => {
    expect(isValidChannelId("feishu_main")).toBe(true);
    expect(isValidChannelId("tg-1")).toBe(true);
    expect(isValidChannelId("a")).toBe(true);
  });
  it("拒绝非法 id", () => {
    expect(isValidChannelId("")).toBe(false);
    expect(isValidChannelId("a b")).toBe(false);
    expect(isValidChannelId("中文")).toBe(false);
    expect(isValidChannelId("a.b")).toBe(false);
    expect(isValidChannelId("a/../b")).toBe(false);
  });
});

describe("listChannelsFromSettings", () => {
  it("从 settings 数组解析通道", () => {
    const settings = [
      { key: "notify.channels.feishu_main.type", value: "feishu" },
      { key: "notify.channels.feishu_main.webhook", value: "https://open.feishu.cn/hook/abc" },
      { key: "notify.channels.feishu_main.enabled", value: true },
      { key: "notify.channels.feishu_main.events", value: ["ai_error"] },
      { key: "notify.channels.dd.type", value: "dingtalk" },
      { key: "notify.channels.dd.webhook", value: "https://oapi.dingtalk.com/robot/send?access_token=xyz" },
      // 无效 type → 忽略
      { key: "notify.channels.bad.type", value: "fake" },
      // 无关 key
      { key: "ai.providers.openai.apiKey", value: "sk-xxx" },
    ];
    const list = listChannelsFromSettings(settings);
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.id === "feishu_main")?.type).toBe("feishu");
    expect(list.find((c) => c.id === "dd")?.type).toBe("dingtalk");
  });
  it("空数组 → 空结果", () => {
    expect(listChannelsFromSettings([])).toEqual([]);
  });
});

describe("channelsForEvent", () => {
  const chs: NotifyChannelConfig[] = [
    { id: "a", type: "feishu", enabled: true, events: ["ai_error"] },
    { id: "b", type: "feishu", enabled: true, events: [] }, // 空 = 全部
    { id: "c", type: "feishu", enabled: false, events: ["ai_error"] }, // 禁用
    { id: "d", type: "feishu", enabled: true, events: ["server_error"] }, // 不订阅
  ];
  it("返回 enabled 且订阅了该事件的", () => {
    const r = channelsForEvent(chs, "ai_error");
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
  it("event 不在订阅列表 → 只有 events=[] 的命中", () => {
    const r = channelsForEvent(chs, "rate_limit");
    expect(r.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("findChannel", () => {
  const chs: NotifyChannelConfig[] = [
    { id: "a", type: "feishu", enabled: true, events: [] },
    { id: "b", type: "telegram", enabled: true, events: [] },
  ];
  it("找到存在", () => {
    expect(findChannel(chs, "b")?.type).toBe("telegram");
  });
  it("找不到返 null", () => {
    expect(findChannel(chs, "z")).toBeNull();
  });
});

describe("maskChannel", () => {
  it("webhook / secret / botToken 都被脱敏", () => {
    const c: NotifyChannelConfig = {
      id: "x", type: "feishu", enabled: true, events: [],
      webhook: "https://open.feishu.cn/hook/abcdefghijklmnop",
      secret: "SECabcd1234",
      botToken: "1234567890:ABCdef",
    };
    const m = maskChannel(c);
    expect(m.webhook).toContain("*");
    expect(m.webhook).toContain("mnop");
    expect(m.secret).toMatch(/\*+1234$/);
    expect(m.botToken).toMatch(/\*+Cdef$/);
  });
  it("短字符串 → 全 ****", () => {
    const c: NotifyChannelConfig = { id: "y", type: "telegram", enabled: true, events: [], webhook: "abc" };
    const m = maskChannel(c);
    expect(m.webhook).toBe("****");
  });
});

describe("sendFeishu 集成(失败注入)", () => {
  it("webhook 为空 → 失败", async () => {
    const r = await sendFeishu({ id: "x", type: "feishu", enabled: true, events: [] }, "hi");
    expect(r.success).toBe(false);
    expect(r.error).toContain("webhook");
  });
});
