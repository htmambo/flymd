/**
 * SSRF 防护 — baseUrl 校验
 *
 * 拒绝(即使 allowPrivate=true 也硬拒):
 *   - 169.254.0.0/16 (link-local,含 cloud metadata 169.254.169.254)
 *   - 0.0.0.0/8      (Windows 会路由到 127.0.0.1)
 *   - IPv4-mapped IPv6 [::ffff:127.0.0.1] 等
 *   - "::" (unspecified)
 *
 * 默认拒绝(allowPrivate=true 时放行):
 *   - IPv4 loopback (127.0.0.0/8)
 *   - IPv4 private (10/8, 172.16/12, 192.168/16)
 *   - IPv6 loopback (::1)
 *   - IPv6 private (fc00::/7)
 *   - IPv6 link-local (fe80::/10)
 *   - 主机名 localhost, *.localhost
 *   - 非 http(s) 协议 (file, gopher, dict, ldap...)
 *
 * 放行:
 *   - 公网 IP / 公网主机名
 *   - 白名单:flymd 官方代理
 *
 * 注意(本期未实现,记入 backlog):
 *   - DNS rebinding 防护:此处只做字符串层校验,不做 dns.lookup
 *     (dns.lookup 会引入延迟和 TOCTOU,需要 IP 锁定机制才能根治)
 *   - 真正的安全应:resolve host → 验证 IP 不在黑名单 → 发起 fetch 时
 *     用解析后的 IP 直连(host header 仍传原名)。本期不做。
 */

export type ValidateOptions = {
  /** 允许私网 / loopback IP(自托管 LLM 场景),默认 false */
  allowPrivate?: boolean;
  /** 额外白名单主机名(默认含 flymd 官方代理) */
  additionalAllowlist?: string[];
};

export type ValidateResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/** 默认白名单(与浏览器端插件 flymd-bge-free 保持一致) */
export const DEFAULT_ALLOWLIST: ReadonlyArray<string> = [
  "flymd.llingfei.com",
];

/** IPv4 私网/loopback/link-local 范围(可被 allowPrivate 绕过) */
const IPV4_PRIVATE_RANGES: Array<{ test: (n: number) => boolean; name: string }> = [
  { test: (n) => (n & 0xff000000) >>> 0 === 0x7f000000, name: "127.0.0.0/8 loopback" },
  { test: (n) => (n & 0xff000000) >>> 0 === 0x0a000000, name: "10.0.0.0/8 private" },
  {
    test: (n) => {
      const b1 = (n >>> 24) & 0xff;
      const b2 = (n >>> 16) & 0xff;
      return b1 === 172 && b2 >= 16 && b2 <= 31;
    },
    name: "172.16.0.0/12 private",
  },
  {
    test: (n) => (n & 0xffff0000) >>> 0 === 0xc0a80000,
    name: "192.168.0.0/16 private",
  },
];

/**
 * 硬拒 IPv4 范围(allowPrivate=true 也无法绕过)
 *   - 169.254.0.0/16  cloud metadata(IMDS)
 *   - 0.0.0.0/8       Windows 路由到 127.0.0.1
 */
const IPV4_HARD_BLOCKED_RANGES: Array<{ test: (n: number) => boolean; name: string }> = [
  { test: (n) => (n & 0xffff0000) >>> 0 === 0xa9fe0000, name: "169.254.0.0/16 link-local (cloud metadata)" },
  { test: (n) => (n >>> 24) === 0, name: "0.0.0.0/8" },
];

/** 仅检查硬拒 IPv4 范围(allowPrivate 也无法绕过) */
export function isHardBlockedIPv4(host: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((s) => parseInt(s, 10));
  if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return "malformed IPv4";
  }
  const n = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  for (const r of IPV4_HARD_BLOCKED_RANGES) {
    if (r.test(n)) return r.name;
  }
  return null;
}

/** 检查 IPv4 字符串是否命中黑名单(包含硬拒 + 私网/loopback) */
export function isPrivateOrLoopbackIPv4(host: string): string | null {
  // 先查硬拒
  const hard = isHardBlockedIPv4(host);
  if (hard) return hard;
  // 再查私网/loopback
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((s) => parseInt(s, 10));
  if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return "malformed IPv4";
  }
  const n = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  for (const r of IPV4_PRIVATE_RANGES) {
    if (r.test(n)) return r.name;
  }
  return null;
}

/** 从 IPv6 host 中提取 IPv4-mapped 的 IPv4 部分,否则 null
 *  处理两种形式:
 *    - 明文 ::ffff:127.0.0.1 或 ::127.0.0.1(罕见,部分解析器保留)
 *    - 十六进制 ::ffff:7f00:1(标准 URL 解析器会规范化成这种)
 *  把最后 32 位按 16-bit group 拆成 4 个字节,拼成 "a.b.c.d"
 */
function extractMappedIPv4(h: string): string | null {
  // 形式 1:decimal  ::ffff:127.0.0.1  /  ::127.0.0.1
  const m1 = /^::(ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/.exec(h);
  if (m1) return m1[2];

  // 形式 2:hex  ::ffff:HHHH:HHHH  /  ::HHHH:HHHH(最后两段 32-bit)
  // WHATWG URL 解析器会把 [::ffff:127.0.0.1] 转成 ::ffff:7f00:1
  const m2 = /^::(ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (m2) {
    const hi = parseInt(m2[2], 16);
    const lo = parseInt(m2[3], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
  }

  return null;
}

/** 仅检查硬拒 IPv6 范围(allowPrivate 也无法绕过)
 *  - "::" unspecified
 *  - IPv4-mapped IPv6 中的内嵌 IPv4 命中硬拒
 */
export function isHardBlockedIPv6(host: string): string | null {
  const h = String(host || "").toLowerCase().split("%")[0];
  if (!h) return null;
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return ":: unspecified";
  // 提取 IPv4-mapped 的内嵌 IPv4,递归查硬拒
  const mapped4 = extractMappedIPv4(h);
  if (mapped4) {
    const reason = isHardBlockedIPv4(mapped4);
    if (reason) return `IPv4-mapped [${h}] → ${reason}`;
    return null;
  }
  return null;
}

/** 检查 IPv6 字符串是否命中黑名单(简化:仅识别常见 block) */
export function isPrivateOrLoopbackIPv6(host: string): string | null {
  // 规范化:小写 + 去掉 zone id
  const h = String(host || "").toLowerCase().split("%")[0];
  if (!h) return null;

  // 先查硬拒("::" / mapped-IPv4 in hard list)
  const hard = isHardBlockedIPv6(h);
  if (hard) return hard;

  // ::1 (loopback) — 含 "::1" 但排除 "::1xx" 这种
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return "::1 loopback";

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 → 拆出 IPv4 递归判断
  // (内嵌 IPv4 不在硬拒时,这里会走私网检查)
  const mapped4 = extractMappedIPv4(h);
  if (mapped4) {
    const reason = isPrivateOrLoopbackIPv4(mapped4);
    if (reason) return `IPv4-mapped [${h}] → ${reason}`;
    return null;
  }

  // fc00::/7 (ULA) — 首字节 0xfc 或 0xfd
  // 注意:取首组的**前 8 位**(一个字节),不是整个 16 位 group
  //   fc00::1  → 0xfc ✓
  //   fd12::1  → 0xfd ✓
  //   2001::1  → 0x20 ✗ (公网)
  const first2 = (h.split(":")[0] || "").substring(0, 2);
  if (first2 === "fc" || first2 === "fd") {
    return "fc00::/7 private (ULA)";
  }

  // fe80::/10 (link-local)
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return "fe80::/10 link-local";
  }

  return null;
}

/** 检查主机名是否是 loopback(`localhost` / `*.localhost` / 数字 IP) */
export function checkHost(host: string, opts: { allowPrivate?: boolean }): string | null {
  if (!host) return "empty host";
  const h = host.toLowerCase();

  // 主机名 loopback
  if (h === "localhost" || h.endsWith(".localhost")) return "localhost hostname";
  if (h === "ip6-localhost" || h === "ip6-loopback") return "ip6 localhost hostname";

  // IPv4 字面量
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    if (opts.allowPrivate) return null;
    const reason = isPrivateOrLoopbackIPv4(h);
    if (reason) return reason;
    return null;
  }

  // IPv6 字面量(用 [] 包裹的 host)
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    if (opts.allowPrivate) return null;
    const reason = isPrivateOrLoopbackIPv6(inner);
    if (reason) return reason;
    return null;
  }

  // 裸 IPv6
  if (h.includes(":")) {
    if (opts.allowPrivate) return null;
    const reason = isPrivateOrLoopbackIPv6(h);
    if (reason) return reason;
    return null;
  }

  // 公网主机名 → 放行(假设域名解析后是公网)
  return null;
}

/** 检查协议(http/https only) */
export function isAllowedScheme(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * 校验 baseUrl 是否可用作 embedding 服务地址
 *
 * 返回 { ok: true, url } 或 { ok: false, reason }
 */
export function validateBaseUrl(
  rawUrl: string,
  opts: ValidateOptions = {},
): ValidateResult {
  // 1) 必填
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, reason: "baseUrl 为空" };
  }
  const urlStr = String(rawUrl).trim();
  if (!urlStr) {
    return { ok: false, reason: "baseUrl 为空" };
  }

  // 2) 协议白名单
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "URL 解析失败" };
  }
  if (!isAllowedScheme(url)) {
    return { ok: false, reason: `协议被拒绝:${url.protocol}(只允许 http/https)` };
  }

  // 3) 白名单优先(flymd 官方代理永远放行)
  const allowlist = [...DEFAULT_ALLOWLIST, ...(opts.additionalAllowlist || [])];
  const hostLower = url.hostname.toLowerCase();
  if (allowlist.some((d) => hostLower === d || hostLower.endsWith("." + d))) {
    return { ok: true, url };
  }

  // 4) 硬拒黑名单(allowPrivate 也无法绕过)
  //    包括 IPv4 169.254/16 + 0/8,以及 IPv6 中提取的 mapped IPv4
  //    这些在 isPrivateOrLoopback* 函数内已强制 hard-block
  const hardCheck = checkHostHard(url.hostname);
  if (hardCheck) {
    return { ok: false, reason: `host 硬拒:${hardCheck}` };
  }

  // 5) 主机名 / IP 黑名单(allowPrivate 可绕过)
  if (!opts.allowPrivate) {
    const hostReason = checkHost(url.hostname, { allowPrivate: false });
    if (hostReason) {
      return { ok: false, reason: `host 命中黑名单:${hostReason}` };
    }
  }

  return { ok: true, url };
}

/** 硬拒检查 — 忽略 allowPrivate(只查 169.254/16, 0/8, "::", mapped-IP-in-hard) */
function checkHostHard(host: string): string | null {
  if (!host) return "empty host";
  const h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(inner)) {
      return isHardBlockedIPv4(inner);
    }
    return isHardBlockedIPv6(inner);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    return isHardBlockedIPv4(h);
  }
  if (h.includes(":")) {
    return isHardBlockedIPv6(h);
  }
  return null;
}
