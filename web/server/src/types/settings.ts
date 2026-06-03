/**
 * 设置项类型
 *
 * 每个设置项用 key-value 存到 settings 表。
 * - key: 设置项标识(如 "ai.openai.api_key")
 * - value: JSON 序列化的字符串
 * - category: 分组(ai / apikey / user / system)
 * - visibility: 谁能读 / 谁能写
 * - updatedAt / updatedBy: 审计
 */

export type SettingCategory = "ai" | "apikey" | "system" | "user";
export type SettingVisibility = "admin" | "user" | "public";

export type Setting = {
  key: string;
  value: unknown;
  category: SettingCategory;
  visibility: SettingVisibility;
  description?: string;
  updatedAt: number;
  updatedBy: string | null;
};

/** 前端友好的"分组设置"结构(把同 category 的 key 合并) */
export type SettingGroup = {
  category: SettingCategory;
  items: Setting[];
};

/** 预设 AI 服务商配置 schema(写入 settings 表时用) */
export const AI_PROVIDERS = ["openai", "anthropic", "google", "ollama", "custom"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

/** 单个 AI 配置的形状(写在 settings.value 里) */
export type AIConfigValue = {
  provider: AIProvider;
  baseUrl?: string;
  apiKey?: string;       // 脱敏返回(只回显后 4 位)
  defaultModel?: string;
  enabled?: boolean;
  temperature?: number;
  maxTokens?: number;
};

/** 单个 API_KEY 配置(类似 AI,但独立分类,方便管理) */
export type ApiKeyValue = {
  service: string;       // "openai" | "github" | "anthropic" | ...
  label?: string;        // 显示名
  apiKey: string;        // 脱敏返回
  baseUrl?: string;
  enabled?: boolean;
};
