/**
 * 企业微信 自定义机器人 webhook
 *
 * 协议:
 *  - URL:https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>
 *  - POST JSON:{ msgtype: "text", text: { content: "..." } }
 *  - 也支持 markdown / text 类型
 *  - 成功返 {errcode:0, errmsg:"ok"}
 */
import type { ChannelSendResult, NotifyChannelConfig } from "./types.js";

const TIMEOUT_MS = 5_000;

export async function sendWecom(
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
  const body = { msgtype: "text", text: { content: text } };
  try {
    const resp = await fetch(cfg.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const txt = await resp.text().catch(() => "");
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
        // 非 JSON 不算失败
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
    }
  }
}
