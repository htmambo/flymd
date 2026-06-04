/**
 * ssrf.ts 单测
 */
import { describe, it, expect } from "vitest";
import {
  validateBaseUrl,
  isPrivateOrLoopbackIPv4,
  isPrivateOrLoopbackIPv6,
  DEFAULT_ALLOWLIST,
} from "./ssrf.js";

describe("isPrivateOrLoopbackIPv4", () => {
  it("127.0.0.1 → loopback", () => {
    expect(isPrivateOrLoopbackIPv4("127.0.0.1")).toMatch(/loopback/);
  });
  it("10.0.0.1 → private", () => {
    expect(isPrivateOrLoopbackIPv4("10.0.0.1")).toMatch(/private/);
  });
  it("172.16.0.1 → private (172.16/12)", () => {
    expect(isPrivateOrLoopbackIPv4("172.16.0.1")).toMatch(/private/);
  });
  it("172.31.255.255 → private", () => {
    expect(isPrivateOrLoopbackIPv4("172.31.255.255")).toMatch(/private/);
  });
  it("172.32.0.1 → null (公网)", () => {
    expect(isPrivateOrLoopbackIPv4("172.32.0.1")).toBeNull();
  });
  it("192.168.1.1 → private", () => {
    expect(isPrivateOrLoopbackIPv4("192.168.1.1")).toMatch(/private/);
  });
  it("169.254.169.254 → link-local (cloud metadata)", () => {
    expect(isPrivateOrLoopbackIPv4("169.254.169.254")).toMatch(/link-local/);
  });
  it("8.8.8.8 → null (公网 DNS)", () => {
    expect(isPrivateOrLoopbackIPv4("8.8.8.8")).toBeNull();
  });
  it("0.0.0.0 → blocked", () => {
    expect(isPrivateOrLoopbackIPv4("0.0.0.0")).toMatch(/0\.0\.0\.0/);
  });
  it("256.0.0.1 → malformed", () => {
    expect(isPrivateOrLoopbackIPv4("256.0.0.1")).toMatch(/malformed/);
  });
  it("非 IP → null", () => {
    expect(isPrivateOrLoopbackIPv4("api.openai.com")).toBeNull();
  });
});

describe("isPrivateOrLoopbackIPv6", () => {
  it("::1 → loopback", () => {
    expect(isPrivateOrLoopbackIPv6("::1")).toMatch(/loopback/);
  });
  it("0:0:0:0:0:0:0:1 → loopback", () => {
    expect(isPrivateOrLoopbackIPv6("0:0:0:0:0:0:0:1")).toMatch(/loopback/);
  });
  it(":: → unspecified (硬拒)", () => {
    expect(isPrivateOrLoopbackIPv6("::")).toMatch(/unspecified/);
  });
  it("0:0:0:0:0:0:0:0 → unspecified (硬拒)", () => {
    expect(isPrivateOrLoopbackIPv6("0:0:0:0:0:0:0:0")).toMatch(/unspecified/);
  });
  it("::ffff:127.0.0.1 → IPv4-mapped loopback (硬拒)", () => {
    expect(isPrivateOrLoopbackIPv6("::ffff:127.0.0.1")).toMatch(/127\.0\.0\.0/);
  });
  it("::ffff:169.254.169.254 → IPv4-mapped metadata (硬拒)", () => {
    expect(isPrivateOrLoopbackIPv6("::ffff:169.254.169.254")).toMatch(/link-local/);
  });
  it("::ffff:8.8.8.8 → IPv4-mapped 公网(放行)", () => {
    expect(isPrivateOrLoopbackIPv6("::ffff:8.8.8.8")).toBeNull();
  });
  it("::127.0.0.1 → IPv4-compat loopback (硬拒)", () => {
    expect(isPrivateOrLoopbackIPv6("::127.0.0.1")).toMatch(/127\.0\.0\.0/);
  });
  it("fc00:: → private (ULA)", () => {
    expect(isPrivateOrLoopbackIPv6("fc00::1")).toMatch(/private/);
  });
  it("fd12:3456:: → private (ULA)", () => {
    expect(isPrivateOrLoopbackIPv6("fd12:3456::1")).toMatch(/private/);
  });
  it("fe80:: → link-local", () => {
    expect(isPrivateOrLoopbackIPv6("fe80::1")).toMatch(/link-local/);
  });
  it("feb0:: → link-local", () => {
    expect(isPrivateOrLoopbackIPv6("feb0::1")).toMatch(/link-local/);
  });
  it("2001:db8:: → null (公网/文档段)", () => {
    expect(isPrivateOrLoopbackIPv6("2001:db8::1")).toBeNull();
  });
});

describe("validateBaseUrl", () => {
  it("公网 https 放行", () => {
    const r = validateBaseUrl("https://api.openai.com/v1");
    expect(r.ok).toBe(true);
  });
  it("官方白名单放行", () => {
    const r = validateBaseUrl("https://flymd.llingfei.com/ai/ai_proxy.php/v1");
    expect(r.ok).toBe(true);
    expect(DEFAULT_ALLOWLIST).toContain("flymd.llingfei.com");
  });
  it("子域名放行", () => {
    const r = validateBaseUrl("https://api.flymd.llingfei.com/x");
    expect(r.ok).toBe(true);
  });
  it("127.0.0.1 拒绝", () => {
    const r = validateBaseUrl("http://127.0.0.1:8080/embeddings");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loopback/);
  });
  it("10.0.0.1 拒绝", () => {
    const r = validateBaseUrl("http://10.0.0.1/embeddings");
    expect(r.ok).toBe(false);
  });
  it("192.168.1.1 拒绝", () => {
    const r = validateBaseUrl("http://192.168.1.1/embeddings");
    expect(r.ok).toBe(false);
  });
  it("169.254.169.254 拒绝(cloud metadata)", () => {
    const r = validateBaseUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
  });
  it("169.254.169.254 即使 allowPrivate=true 也硬拒(cloud metadata)", () => {
    const r = validateBaseUrl("http://169.254.169.254/latest/meta-data/", { allowPrivate: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/link-local/);
  });
  it("0.0.0.0 硬拒(整个 0/8)", () => {
    const r = validateBaseUrl("http://0.0.0.0/");
    expect(r.ok).toBe(false);
  });
  it("[::ffff:127.0.0.1] IPv4-mapped loopback 硬拒", () => {
    const r = validateBaseUrl("http://[::ffff:127.0.0.1]/embeddings");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/127\.0\.0\.0|mapped/);
  });
  it("[::ffff:169.254.169.254] IPv4-mapped metadata 硬拒", () => {
    const r = validateBaseUrl("http://[::ffff:169.254.169.254]/");
    expect(r.ok).toBe(false);
  });
  it("[::] unspecified 硬拒", () => {
    const r = validateBaseUrl("http://[::]/embeddings");
    expect(r.ok).toBe(false);
  });
  it("localhost 拒绝", () => {
    const r = validateBaseUrl("http://localhost:8080/embeddings");
    expect(r.ok).toBe(false);
  });
  it("file:// 拒绝", () => {
    const r = validateBaseUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/协议/);
  });
  it("gopher:// 拒绝", () => {
    const r = validateBaseUrl("gopher://evil.com/x");
    expect(r.ok).toBe(false);
  });
  it("空字符串拒绝", () => {
    const r = validateBaseUrl("");
    expect(r.ok).toBe(false);
  });
  it("纯空格拒绝", () => {
    const r = validateBaseUrl("   ");
    expect(r.ok).toBe(false);
  });
  it("格式错误拒绝", () => {
    const r = validateBaseUrl("not a url");
    expect(r.ok).toBe(false);
  });
  it("allowPrivate=true 放行 127.0.0.1", () => {
    const r = validateBaseUrl("http://127.0.0.1:8080/embeddings", { allowPrivate: true });
    expect(r.ok).toBe(true);
  });
  it("allowPrivate=true 放行 localhost", () => {
    const r = validateBaseUrl("http://localhost:8080/embeddings", { allowPrivate: true });
    expect(r.ok).toBe(true);
  });
  it("additionalAllowlist 放行", () => {
    const r = validateBaseUrl("http://my-llm.local/embeddings", {
      additionalAllowlist: ["my-llm.local"],
    });
    expect(r.ok).toBe(true);
  });
  it("IPv6 loopback [::1] 拒绝", () => {
    const r = validateBaseUrl("http://[::1]:8080/embeddings");
    expect(r.ok).toBe(false);
  });
  it("IPv6 link-local [fe80::1] 拒绝", () => {
    const r = validateBaseUrl("http://[fe80::1]/embeddings");
    expect(r.ok).toBe(false);
  });
});
