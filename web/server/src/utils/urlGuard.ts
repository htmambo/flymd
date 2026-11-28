/**
 * 出站 URL 校验（webhook / 通知渠道）。
 *
 * 通知 webhook 由管理员配置，但仍是出站请求面：恶意或被篡改的配置可以把服务端
 * 当作 SSRF 原语，访问云元数据、link-local 或本机服务。这里只做请求前校验：
 * - 仅 http/https，拒绝 URL 内嵌凭据；
 * - 拒绝 link-local / 0.0.0.0/8 / 常见云元数据地址；
 * - 私网与回环保留（自托管机器人/内网通知是常见用法）。
 *
 * 残余：不做 DNS 解析锁定，域名解析到受限地址的 rebinding 场景未覆盖。
 */

export type OutboundUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

const BLOCKED_V4: ReadonlyArray<{ octets: number[]; reason: string }> = [
  { octets: [100, 100, 100, 200], reason: "Alibaba Cloud metadata" },
  { octets: [168, 63, 129, 16], reason: "Azure WireServer" },
  { octets: [192, 0, 0, 192], reason: "Oracle Cloud metadata" },
]

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const octets = m.slice(1).map((s) => Number.parseInt(s, 10))
  return octets.every((n) => Number.isFinite(n) && n >= 0 && n <= 255) ? octets : null
}

function blockedReasonV4(octets: number[]): string | null {
  if (octets[0] === 169 && octets[1] === 254) return "IPv4 link-local / ECS metadata"
  if (octets[0] === 0) return "0.0.0.0/8"
  for (const item of BLOCKED_V4) {
    if (item.octets.every((n, i) => n === octets[i])) return item.reason
  }
  return null
}

/** `::ffff:a9fe:a9fe`（URL 会归一化为十六进制形式）→ 169.254.169.254 */
function ipv4FromMapped(host: string): number[] | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (!m) return null
  const hi = Number.parseInt(m[1], 16)
  const lo = Number.parseInt(m[2], 16)
  return [hi >> 8 & 0xff, hi & 0xff, lo >> 8 & 0xff, lo & 0xff]
}

function blockedReasonV6(host: string): string | null {
  if (host === "::") return "IPv6 unspecified"
  // fd00:ec2::254 —— AWS IPv6 IMDS
  if (host === "fd00:ec2::254") return "AWS IPv6 metadata"
  const mapped = ipv4FromMapped(host)
  if (mapped) return blockedReasonV4(mapped)
  const first = Number.parseInt((host.split(":")[0] || "0"), 16)
  if (Number.isFinite(first) && (first & 0xffc0) === 0xfe80) {
    return "IPv6 link-local"
  }
  return null
}

export function validateOutboundUrl(raw: string): OutboundUrlResult {
  let url: URL
  try {
    url = new URL(String(raw || ""))
  } catch {
    return { ok: false, reason: "webhook URL 无效" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `仅支持 http/https，收到 ${url.protocol}` }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "webhook URL 不能包含用户名/密码" }
  }

  const host = url.hostname
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase()
  if (!host) return { ok: false, reason: "webhook URL 缺少主机名" }
  if (host === "metadata.google.internal" || host === "metadata.goog") {
    return { ok: false, reason: "拒绝访问云元数据主机" }
  }

  const v4 = parseIPv4(host)
  if (v4) {
    const reason = blockedReasonV4(v4)
    return reason ? { ok: false, reason: `拒绝访问受限地址（${reason}）` } : { ok: true, url }
  }
  if (host.includes(":")) {
    const reason = blockedReasonV6(host)
    return reason ? { ok: false, reason: `拒绝访问受限地址（${reason}）` } : { ok: true, url }
  }
  return { ok: true, url }
}
