/**
 * 飞书(Lark) 自定义机器人 webhook
 *
 * 协议:
 *  - URL: https://open.feishu.cn/open-apis/bot/v2/hook/<token>
 *    或自定义:https://your-domain.com/hook
 *  - 签名(可选):secret 字段
 *    timestamp = current ms
 *    string_to_sign = `${timestamp}\n${secret}`
 *    hmac_code = base64(HMAC-SHA256(string_to_sign, secret 空字节))
 *    实际算法:hmac_sha256(secret_bytes, string_to_sign).digest() → "hex"
 *  - body: { timestamp, sign, msg_type: "text", content: { text: "..." } }
 *  - 或 富文本 msg_type: "post"
 *
 * 简化版:只发 text 类型(简单清晰)
 */
import crypto from "node:crypto";
import type { ChannelSendResult, NotifyChannelConfig } from "./types.js";

const TIMEOUT_MS = 5_000;

export function signFeishu(secret: string, timestamp: number): string {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac("sha256", secret).update(stringToSign).digest();
  return Buffer.from(hmac).toString("base64");
}

export async function sendFeishu(
  cfg: NotifyChannelConfig,
  text: string,
): Promise<ChannelSendResult> {
  const start = Date.now();
  if (!cfg.webhook) {
    return {
      channelId: cfg.id, channelType: cfg.type, success: false,
      error: "webhook 为空", latencyMs: 0,
    };
  }
  const body: Record<string, unknown> = { msg_type: "text", content: { text } };
  if (cfg.secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = signFeishu(cfg.secret, ts);
  }
  try {
    const resp = await fetch(cfg.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text0 = await resp.text().catch(() => "");
    return {
      channelId: cfg.id,
      channelType: cfg.type,
      success: resp.ok,
      statusCode: resp.status,
      latencyMs: Date.now() - start,
      error: resp.ok ? undefined : `HTTP ${resp.status}: ${text0.slice(0, 200)}`,
    };
  } catch (e: any) {
    return {
      channelId: cfg.id, channelType: cfg.type, success: false,
      error: e?.message || String(e), latencyMs: Date.now() - start,
    };
  }
}
