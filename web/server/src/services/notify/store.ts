/**
 * 通道配置 store
 *
 * 从 settings 表读 `notify.channels.<id>.*` 键,组装成 NotifyChannelConfig[]。
 * 不直接操作 settings,委托给 SettingsService(保持脱敏语义)。
 */
import type { SettingsService } from "../settings.js";
import type { NotifyChannelConfig, NotifyChannelType } from "./types.js";
import { NOTIFY_CHANNEL_TYPES } from "./types.js";

const ID_REGEX = /^[\w\-]{1,64}$/;
const KEY_PREFIX = "notify.channels.";

/** 校验通道 ID(字母数字下划线连字符,1-64) */
export function isValidChannelId(id: string): boolean {
  return ID_REGEX.test(String(id || ""));
}

/** 从裸 settings 数组(已 unmask)构造 — 便于测试 */
export function listChannelsFromSettings(settings: Array<{ key: string; value: unknown }>): NotifyChannelConfig[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const s of settings) {
    if (!s.key.startsWith(KEY_PREFIX)) continue;
    const rest = s.key.slice(KEY_PREFIX.length);
    const dot = rest.indexOf(".");
    if (dot < 0) continue;
    const id = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    if (!isValidChannelId(id)) continue;
    if (!map.has(id)) map.set(id, {});
    (map.get(id) as any)[field] = s.value;
  }
  const out: NotifyChannelConfig[] = [];
  for (const [id, fields] of map) {
    const type = String(fields.type || "") as NotifyChannelType;
    if (!NOTIFY_CHANNEL_TYPES.includes(type)) continue;
    out.push({
      id,
      type,
      name: fields.name as string | undefined,
      enabled: fields.enabled !== false,
      webhook: fields.webhook as string | undefined,
      secret: fields.secret as string | undefined,
      botToken: fields.botToken as string | undefined,
      chatId: fields.chatId as string | undefined,
      events: Array.isArray(fields.events) ? (fields.events as string[]).map(String) : [],
    });
  }
  return out;
}

/** 列出所有通道(从 settings 表读,需要 unmask 因为我们要发请求) */
export function listChannelConfigs(settings: SettingsService): NotifyChannelConfig[] {
  // 走 system category(unmask 拿真值,内部用,响应时由路由层脱敏)
  const all = settings.list({ category: "system", unmask: true });
  return listChannelsFromSettings(all);
}

/** 写一个通道(逐字段 upsert) */
export function writeChannel(
  settings: SettingsService,
  id: string,
  patch: Partial<NotifyChannelConfig>,
  updatedBy: string,
): void {
  if (!isValidChannelId(id)) throw new Error("ID 非法(仅字母数字 _-)");
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    settings.upsert({
      key: `${KEY_PREFIX}${id}.${k}`,
      value: v as any,
      category: "system",
      visibility: "admin",
      updatedBy,
    });
  }
}

/** 删一个通道(全部字段) */
export function deleteChannel(settings: SettingsService, id: string): number {
  if (!isValidChannelId(id)) return 0;
  const all = settings.list({ category: "system", unmask: true });
  let n = 0;
  for (const s of all) {
    if (s.key.startsWith(`${KEY_PREFIX}${id}.`)) {
      settings.delete(s.key);
      n++;
    }
  }
  return n;
}

/** 找单个通道 */
export function findChannel(channels: NotifyChannelConfig[], id: string): NotifyChannelConfig | null {
  return channels.find((c) => c.id === id) || null;
}

/** 哪些通道订阅了指定事件 */
export function channelsForEvent(channels: NotifyChannelConfig[], event: string): NotifyChannelConfig[] {
  return channels.filter(
    (c) => c.enabled && (c.events.length === 0 || c.events.includes(event)),
  );
}

/** 把 config 转成对外响应(脱敏 secret / webhook) */
export function maskChannel(c: NotifyChannelConfig): NotifyChannelConfig {
  return {
    ...c,
    webhook: c.webhook ? maskTrailing(c.webhook, 8) : undefined,
    secret: c.secret ? `${"*".repeat(Math.max(0, c.secret.length - 4))}${c.secret.slice(-4)}` : undefined,
    botToken: c.botToken ? `${"*".repeat(Math.max(0, c.botToken.length - 4))}${c.botToken.slice(-4)}` : undefined,
  };
}

function maskTrailing(s: string, show: number): string {
  if (s.length <= show + 4) return "****";
  return "*".repeat(s.length - show) + s.slice(-show);
}
