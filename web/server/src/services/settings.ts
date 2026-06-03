/**
 * Settings 业务服务
 *
 * 关键设计:
 * - value 在 DB 里存 JSON 字符串
 * - 对外返回时,**API_KEY 类敏感字段做脱敏**(只回显后 4 位)
 * - 写入时必须由 admin role 完成(API 层 enforce)
 */
import { DatabaseClient } from "../db/database.js";
import type { Setting, SettingCategory, SettingVisibility, ApiKeyValue, AIConfigValue } from "../types/settings.js";

const MASK_LEN = 4;

/** 对 apiKey / token 类字段脱敏 */
function maskValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length <= MASK_LEN + 2) return "****";
    return "****" + value.slice(-MASK_LEN);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "string" && /(key|token|secret|password)/i.test(key)) {
        obj[key] = maskValue(v);
      } else if (typeof v === "object" && v !== null) {
        obj[key] = maskValue(v);
      }
    }
    return obj;
  }
  return value;
}

/** 脱敏后的设置 */
export type SafeSetting = Omit<Setting, "value"> & { value: unknown };

export class SettingsService {
  constructor(private db: DatabaseClient) {}

  /** 列出设置(默认脱敏) */
  list(opts: { category?: SettingCategory; visibility?: SettingVisibility; unmask?: boolean } = {}): SafeSetting[] {
    const items = this.db.listSettings(opts);
    return items.map((s) => ({
      ...s,
      value: opts.unmask ? s.value : maskValue(s.value),
    }));
  }

  get(key: string, opts: { unmask?: boolean } = {}): SafeSetting | null {
    const s = this.db.getSetting(key);
    if (!s) return null;
    return {
      ...s,
      value: opts.unmask ? s.value : maskValue(s.value),
    };
  }

  upsert(opts: {
    key: string;
    value: unknown;
    category: SettingCategory;
    visibility?: SettingVisibility;
    description?: string;
    updatedBy: string;
  }): SafeSetting {
    if (!opts.key) throw new Error("key 不能为空");
    if (!opts.value && opts.value !== false && opts.value !== 0) {
      throw new Error("value 不能为空");
    }
    const s = this.db.upsertSetting({
      key: opts.key,
      value: opts.value,
      category: opts.category,
      visibility: opts.visibility,
      description: opts.description,
      updatedBy: opts.updatedBy,
    });
    return { ...s, value: maskValue(s.value) };
  }

  delete(key: string): boolean {
    return this.db.deleteSetting(key);
  }

  /** 按 category 分组返回 */
  listGrouped(opts: { unmask?: boolean } = {}): Record<SettingCategory, SafeSetting[]> {
    const all = this.list({ unmask: opts.unmask });
    const out: Record<SettingCategory, SafeSetting[]> = {
      ai: [],
      apikey: [],
      system: [],
      user: [],
    };
    for (const s of all) {
      out[s.category].push(s);
    }
    return out;
  }

  /** 辅助:把 AIConfigValue 类型转回 raw value(用于内部存储) */
  buildAIConfig(input: Partial<AIConfigValue>): AIConfigValue {
    return {
      provider: input.provider || "openai",
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      defaultModel: input.defaultModel,
      enabled: input.enabled !== false,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    };
  }

  /** 辅助:把 ApiKeyValue 类型转回 raw value */
  buildApiKey(input: Partial<ApiKeyValue>): ApiKeyValue {
    return {
      service: input.service || "custom",
      label: input.label,
      apiKey: input.apiKey || "",
      baseUrl: input.baseUrl,
      enabled: input.enabled !== false,
    };
  }
}
