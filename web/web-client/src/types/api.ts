/** API 类型定义(与 web/server/src/types/* 同步) */

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export type PublicUser = {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
};

export type AuthPayload = {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user: PublicUser;
};

export type AdminOverview = {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  totalSettings: number;
};

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

export type SettingGroup = {
  category: SettingCategory;
  items: Setting[];
};

export type AIProvider = "openai" | "anthropic" | "google" | "ollama" | "custom";

export type AIConfigValue = {
  provider: AIProvider;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  enabled?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type ApiKeyValue = {
  service: string;
  label?: string;
  apiKey: string;
  baseUrl?: string;
  enabled?: boolean;
};

export type ApiResponse<T> = {
  data: T;
};

export type ApiErrorBody = {
  error: { message: string };
};
