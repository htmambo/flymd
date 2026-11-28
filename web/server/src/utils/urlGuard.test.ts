import { describe, it, expect } from "vitest"
import { validateOutboundUrl } from "./urlGuard.js"

describe("validateOutboundUrl", () => {
  it("接受公网与内网 http/https webhook", () => {
    expect(validateOutboundUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x").ok).toBe(true)
    expect(validateOutboundUrl("http://192.168.1.20:8080/hook").ok).toBe(true)
    expect(validateOutboundUrl("http://127.0.0.1:3000/hook").ok).toBe(true)
    expect(validateOutboundUrl("http://[::1]:3000/hook").ok).toBe(true)
  })

  it("拒绝非 http(s) 与内嵌凭据", () => {
    expect(validateOutboundUrl("file:///etc/passwd").ok).toBe(false)
    expect(validateOutboundUrl("ftp://example.test/x").ok).toBe(false)
    const withUserInfo = "https://" + "user" + ":" + "cred" + "@example.test/x"
    expect(validateOutboundUrl(withUserInfo).ok).toBe(false)
    expect(validateOutboundUrl("not a url").ok).toBe(false)
  })

  it("拒绝云元数据 / link-local / 未指定地址", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data/",
      "http://169.254.170.2/v2/credentials",
      "http://100.100.100.200/latest/meta-data/",
      "http://168.63.129.16/machine/?x",
      "http://192.0.0.192/opc/v1/instance/",
      "http://0.0.0.0:8080/x",
      "http://2852039166/", // 十进制 169.254.169.254
      "http://0xa9.0xfe.0xa9.0xfe/",
      "http://169.254.169.254./",
      "http://metadata.google.internal./computeMetadata/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[fd00:ec2::254]/",
    ]) {
      expect(validateOutboundUrl(u).ok, u).toBe(false)
    }
  })
})
