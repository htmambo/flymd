/**
 * 告警通知 共享类型
 */

export type NotifyChannelType = "feishu" | "dingtalk" | "telegram" | "wecom";

export const NOTIFY_CHANNEL_TYPES: NotifyChannelType[] = ["feishu", "dingtalk", "telegram", "wecom"];

/** 单个通道配置(从 settings 反序列化) */
export type NotifyChannelConfig = {
  id: string;
  type: NotifyChannelType;
  name?: string;
  enabled: boolean;
  /** 飞书 / 钉钉 / 企业微信 共用 webhook URL */
  webhook?: string;
  /** 飞书 / 钉钉 加签 secret */
  secret?: string;
  /** Telegram bot token(与 webhook 互斥) */
  botToken?: string;
  /** Telegram chat id */
  chatId?: string;
  /** 订阅的事件(空数组 = 全部) */
  events: string[];
};

export type AlertSeverity = "info" | "warn" | "error" | "critical";

export type AlertPayload = {
  /** 事件名,如 "ai_error" / "server_error" / "rate_limit" */
  event: string;
  severity: AlertSeverity;
  /** 简短消息(<= 200 字符) */
  message: string;
  /** 详细信息(可序列化对象) */
  detail?: Record<string, unknown>;
  /** 去重 key(可选,默认从 event + message 派生) */
  dedupKey?: string;
};

export type ChannelSendResult = {
  channelId: string;
  channelType: NotifyChannelType;
  success: boolean;
  error?: string;
  latencyMs: number;
  statusCode?: number;
};

export type AlertDispatchResult = {
  dispatchedAt: number;
  event: string;
  severity: AlertSeverity;
  dedupKey: string;
  suppressed: boolean;
  results: ChannelSendResult[];
  attempted: number;
  succeeded: number;
  failed: number;
};
