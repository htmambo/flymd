/**
 * API 服务:统一封装 fetch + Bearer + 错误处理
 */
import type {
  AdminOverview,
  ApiResponse,
  AuthPayload,
  PublicUser,
  Setting,
  SettingCategory,
} from "@/types/api";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type RequestOptions = RequestInit & { token?: string };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  let payload: ApiResponse<T> | { error: { message: string } } | null = null;
  try {
    payload = (await response.json()) as any;
  } catch {
    /* 空 body / 非 JSON */
  }

  if (!response.ok) {
    const errMsg =
      (payload as any)?.error?.message ?? `请求失败 (${response.status})`;
    throw new ApiError(errMsg, response.status);
  }
  return (payload as ApiResponse<T>)?.data as T;
}

function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}

export const api = {
  health() {
    return request<{ status: string; service: string; timestamp: string }>("/health");
  },

  // === Auth ===
  register(email: string, password: string, nickname?: string) {
    return request<AuthPayload>("/api/v1/auth/register", {
      method: "POST",
      body: jsonBody({ email, password, nickname }),
    });
  },
  login(email: string, password: string) {
    return request<AuthPayload>("/api/v1/auth/login", {
      method: "POST",
      body: jsonBody({ email, password }),
    });
  },
  me(token: string) {
    return request<PublicUser>("/api/v1/auth/me", { token });
  },
  refresh(refreshToken: string) {
    return request<AuthPayload>("/api/v1/auth/refresh", {
      method: "POST",
      body: jsonBody({ refreshToken }),
    });
  },
  logout(token: string) {
    return request<{ success: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      token,
    });
  },
  changePassword(token: string, currentPassword: string, nextPassword: string) {
    return request<{ success: boolean }>("/api/v1/auth/change-password", {
      method: "POST",
      token,
      body: jsonBody({ currentPassword, nextPassword }),
    });
  },
  updateProfile(token: string, nickname: string) {
    return request<PublicUser>("/api/v1/auth/profile", {
      method: "PATCH",
      token,
      body: jsonBody({ nickname }),
    });
  },

  // === Admin ===
  adminOverview(token: string) {
    return request<AdminOverview>("/api/v1/admin/overview", { token });
  },
  adminUsers(token: string) {
    return request<PublicUser[]>("/api/v1/admin/users", { token });
  },
  adminUpdateUser(
    token: string,
    id: string,
    patch: { role?: "admin" | "user"; status?: "active" | "disabled" },
  ) {
    return request<PublicUser>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: jsonBody(patch),
    });
  },
  adminPurgeUserData(token: string, id: string) {
    return request<{ success: boolean }>(
      `/api/v1/admin/users/${encodeURIComponent(id)}/data`,
      { method: "DELETE", token },
    );
  },

  // === Settings ===
  adminSettings(token: string, opts: { category?: SettingCategory; unmask?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opts.category) params.set("category", opts.category);
    if (opts.unmask) params.set("unmask", "true");
    const qs = params.toString();
    return request<Setting[]>(`/api/v1/admin/settings${qs ? "?" + qs : ""}`, { token });
  },
  adminSettingsGrouped(token: string, opts: { unmask?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opts.unmask) params.set("unmask", "true");
    const qs = params.toString();
    return request<Record<SettingCategory, Setting[]>>(
      `/api/v1/admin/settings/grouped${qs ? "?" + qs : ""}`,
      { token },
    );
  },
  adminUpsertSetting(
    token: string,
    body: {
      key: string;
      value: unknown;
      category: SettingCategory;
      visibility?: "admin" | "user" | "public";
      description?: string;
    },
  ) {
    return request<Setting>("/api/v1/admin/settings", {
      method: "PUT",
      token,
      body: jsonBody(body),
    });
  },
  adminDeleteSetting(token: string, key: string) {
    return request<{ success: boolean }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      { method: "DELETE", token },
    );
  },
  adminGetSetting(token: string, key: string, opts: { unmask?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opts.unmask) params.set("unmask", "true");
    const qs = params.toString();
    return request<Setting>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}${qs ? "?" + qs : ""}`,
      { token },
    );
  },
};
