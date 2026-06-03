/**
 * 钉钉 自定义机器人 webhook
 *
 * 协议:
 *  - URL:https://oapi.dingtalk.com/robot/send?access_token=<token>
 *  - 加签模式(可选):URL 拼 ?access_token=<token>
 *    sign 算法:
 *      string_to_sign_base = (currentMs + "\n" + secret)
 *      hmac = HMAC-SHA256(secret_bytes, string_to_sign_base)
 *      base64_encode(hmac) → URL-encode → 加 &timestamp=<ms>&sign=<encoded>
 *  - body:{ msgtype: "text", text: { content: "..." } }
 *  - 支持 atMobiles / atAll
 */
import crypto from "node:crypto";
import type { ChannelSendResult, NotifyChannelConfig } from "./types.js";

const TIMEOUT_MS = 5_000;

export function signDingtalk(secret: string, timestampMs: number): string {
  const stringToSign = `${timestampMs}\n${secret}`;
  const hmac = crypto.createHmac("sha256", secret).update(stringToSign).digest();
  // 钉钉要求对 base64 再 URL encode
  return Buffer.from(hmac).toString("base64");
}

export function appendDingtalkSign(webhook: string, secret: string, ts: number): string {
  const sign = encodeURIComponent(signDingtalk(secret, ts));
  const sep = webhook.includes("?") ? "&" : "?";
  return `${webhook}${sep}timestamp=${ts}&sign=${sign}`;
}

export async function sendDingtalk(
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
  let url = cfg.webhook;
  if (cfg.secret) {
    url = appendDingtalkSign(url, cfg.secret, Date.now());
  }
  const body = { msgtype: "text", text: { content: text } };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const txt = await resp.text().catch(() => "");
    // 钉钉成功返 {errcode:0,errmsg:"ok"};非 0 视为失败
    let success = resp.ok;
    let errMsg: string | undefined;
    if (success) {
      try {
        const j = JSON.parse(txt);
        if (j.errcode !== undefined && j.errcode !== 0) {
          success = false;
          errMsg = `errcode=${j.errcode}: ${j.errmsg || ""}`;
        }
      } catch {
        // 非 JSON 不算失败(可能不是钉钉)
      }
    } else {
      errMsg = `HTTP ${resp.status}: ${txt.slice(0, 200)}`;
    }
    return {
      channelId: cfg.id, channelType: cfg.type, success,
      statusCode: resp.status, latencyMs: Date.now() - start,
      error: errMsg,
    };
  } catch (e: any) {
    return {
      channelId: cfg.id, channelType: cfg.type, success: false,
      error: e?.message || String(e), latencyMs: Date.now() - start,
    };
  }
}
