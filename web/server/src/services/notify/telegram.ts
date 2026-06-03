/**
 * Telegram Bot 通知
 *
 * 协议:
 *  - URL: https://api.telegram.org/bot<botToken>/sendMessage
 *  - POST JSON:{ chat_id, text, parse_mode: "HTML" | "Markdown" | undefined }
 *  - 成功返 {ok:true, result:{...}}
 *  - parse_mode 默认不用(Markdown 易踩坑)
 */
import type { ChannelSendResult, NotifyChannelConfig } from "./types.js";

const TIMEOUT_MS = 5_000;

export async function sendTelegram(
  cfg: NotifyChannelConfig,
  text: string,
): Promise<ChannelSendResult> {
  const start = Date.now();
  if (!cfg.botToken || !cfg.chatId) {
    return {
      channelId: cfg.id, channelType: cfg.type, success: false,
      error: "botToken 或 chatId 为空", latencyMs: 0,
    };
  }
  const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`;
  const body = { chat_id: cfg.chatId, text };
  try {
    const resp = await fetch(url, {
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
        if (j.ok === false) {
          success = false;
          errMsg = j.description || `telegram ok=false`;
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
    };
  }
}
