/**
 * NotifyService — 告警通知入口
 *
 * 职责:
 *  1. 接收业务事件(alert({event, severity, message, detail}))
 *  2. 去重(5min 同 key 不重发)
 *  3. 限流(每 channel 10/min)
 *  4. 读所有 enabled 通道 + 路由到对应 channel.send()
 *  5. 记录 alert_history
 *  6. 失败不抛业务,只 log warning
 */
import type { DatabaseClient } from "../../db/database.js";
import type { SettingsService } from "../settings.js";
import { listChannelConfigs, channelsForEvent } from "./store.js";
import { NotifyDedup, NotifyRateLimiter } from "./dedup.js";
import { sendFeishu } from "./feishu.js";
import { sendDingtalk } from "./dingtalk.js";
import { sendTelegram } from "./telegram.js";
import { sendWecom } from "./wecom.js";
import type {
  AlertPayload, AlertDispatchResult, ChannelSendResult, NotifyChannelConfig,
} from "./types.js";

export class NotifyService {
  private dedup: NotifyDedup;
  private limiter: NotifyRateLimiter;

  constructor(
    private db: DatabaseClient,
    private settings: SettingsService,
    opts: { dedupSeconds?: number; rpmPerChannel?: number } = {},
  ) {
    this.dedup = new NotifyDedup(db, { dedupSeconds: opts.dedupSeconds });
    this.limiter = new NotifyRateLimiter(opts.rpmPerChannel);
  }

  /** 暴露给测试/单点使用 */
  getDedup(): NotifyDedup { return this.dedup; }
  getLimiter(): NotifyRateLimiter { return this.limiter; }

  /** 列出所有通道(脱敏) */
  listChannels(): NotifyChannelConfig[] {
    return listChannelConfigs(this.settings);
  }

  /** 发送告警(主入口) */
  async alert(payload: AlertPayload): Promise<AlertDispatchResult> {
    const dedupKey = payload.dedupKey || this.dedup.key(payload.event, payload.message, payload.detail);
    // 1) 去重
    const claim = this.dedup.claim(dedupKey);
    if (!claim.isNew) {
      return {
        dispatchedAt: Date.now(),
        event: payload.event,
        severity: payload.severity,
        dedupKey,
        suppressed: true,
        results: [],
        attempted: 0,
        succeeded: 0,
        failed: 0,
      };
    }
    // 2) 找订阅此事件的通道
    const channels = listChannelConfigs(this.settings);
    const targets = channelsForEvent(channels, payload.event);
    if (targets.length === 0) {
      // 没有任何通道订阅,记一行历史(suppressedBy="no-channel")
      this.db.logAlert({
        event: payload.event,
        severity: payload.severity,
        message: payload.message,
        payload: payload.detail ? JSON.stringify(payload.detail) : undefined,
        channels: "[]",
        results: "[]",
        dedupKey,
      });
      return {
        dispatchedAt: Date.now(), event: payload.event, severity: payload.severity, dedupKey,
        suppressed: false, results: [], attempted: 0, succeeded: 0, failed: 0,
      };
    }
    // 3) 构造消息
    const text = this.formatMessage(payload);
    // 4) 并行发(每 channel 过限流)
    const sendPromises = targets.map((cfg) => this.sendToChannel(cfg, text));
    const results = await Promise.all(sendPromises);
    // 5) 记历史
    const attempted = results.length;
    const succeeded = results.filter((r) => r.success).length;
    const failed = attempted - succeeded;
    this.db.logAlert({
      event: payload.event,
      severity: payload.severity,
      message: payload.message,
      payload: payload.detail ? JSON.stringify(payload.detail) : undefined,
      channels: JSON.stringify(targets.map((c) => c.id)),
      results: JSON.stringify(results),
      dedupKey,
    });
    return {
      dispatchedAt: Date.now(), event: payload.event, severity: payload.severity,
      dedupKey, suppressed: false, results, attempted, succeeded, failed,
    };
  }

  private async sendToChannel(cfg: NotifyChannelConfig, text: string): Promise<ChannelSendResult> {
    // 限流
    const r = this.limiter.hit(cfg.id);
    if (!r.allowed) {
      return {
        channelId: cfg.id, channelType: cfg.type, success: false,
        error: `rate_limited(10/min)`, latencyMs: 0,
      };
    }
    try {
      switch (cfg.type) {
        case "feishu": return await sendFeishu(cfg, text);
        case "dingtalk": return await sendDingtalk(cfg, text);
        case "telegram": return await sendTelegram(cfg, text);
        case "wecom": return await sendWecom(cfg, text);
        default: return {
          channelId: cfg.id, channelType: cfg.type, success: false,
          error: `unknown channel type: ${cfg.type}`, latencyMs: 0,
        };
      }
    } catch (e: any) {
      return {
        channelId: cfg.id, channelType: cfg.type, success: false,
        error: e?.message || String(e), latencyMs: 0,
      };
    }
  }

  private formatMessage(p: AlertPayload): string {
    const icon = p.severity === "critical" ? "🔥"
      : p.severity === "error" ? "❌"
      : p.severity === "warn" ? "⚠️"
      : "ℹ️";
    const lines: string[] = [];
    lines.push(`${icon} [flymd-web] ${p.severity.toUpperCase()} · ${p.event}`);
    lines.push(p.message);
    if (p.detail) {
      try {
        const s = JSON.stringify(p.detail, null, 2);
        if (s.length < 500) lines.push("```\n" + s + "\n```");
        else lines.push("```\n" + s.slice(0, 500) + "...\n```");
      } catch {}
    }
    lines.push(`时间: ${new Date().toISOString()}`);
    return lines.join("\n");
  }
}
