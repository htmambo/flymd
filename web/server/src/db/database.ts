/**
 * 数据库客户端(better-sqlite3)
 *
 * 提供:users / sessions / settings 的 CRUD + 统计
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { env } from "../config/env.js";
import { runMigrations } from "./migrations.js";
import { hashPassword, newToken, hashToken, tokenExpiresAt, verifyPassword } from "../utils/crypto.js";
import type { PublicUser, UserRole, UserStatus, AdminOverview } from "../types/auth.js";
import type { Setting, SettingCategory, SettingVisibility } from "../types/settings.js";

type DbUser = {
  id: string;
  email: string;
  nickname: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: number;
  last_login_at: number | null;
};

type DbSession = {
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

type DbSetting = {
  key: string;
  value: string;
  category: SettingCategory;
  visibility: SettingVisibility;
  description: string | null;
  updated_at: number;
  updated_by: string | null;
};

export class DatabaseClient {
  readonly db: Database.Database;

  constructor() {
    fs.mkdirSync(env.dataDir, { recursive: true });
    const dbPath = path.join(env.dataDir, "flymd-web.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    runMigrations(this.db);
  }

  // ============================================================
  // User CRUD
  // ============================================================

  private mapUser(row: DbUser): PublicUser {
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    };
  }

  findUserByEmail(email: string): DbUser | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(String(email || "").toLowerCase()) as DbUser | undefined;
    return row || null;
  }

  findUserById(id: string): DbUser | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(String(id || "")) as DbUser | undefined;
    return row || null;
  }

  getPublicUserById(id: string): PublicUser | null {
    const u = this.findUserById(id);
    return u ? this.mapUser(u) : null;
  }

  listUsers(): PublicUser[] {
    const rows = this.db
      .prepare("SELECT * FROM users ORDER BY created_at DESC")
      .all() as DbUser[];
    return rows.map((r) => this.mapUser(r));
  }

  countOverview(): AdminOverview {
    const total = (this.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
    const active = (this.db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'")
      .get() as { c: number }).c;
    const disabled = (this.db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'disabled'")
      .get() as { c: number }).c;
    const settings = (this.db.prepare("SELECT COUNT(*) AS c FROM settings").get() as { c: number }).c;
    return { totalUsers: total, activeUsers: active, disabledUsers: disabled, totalSettings: settings };
  }

  createUser(opts: {
    email: string;
    password: string;
    nickname?: string;
    role?: UserRole;
  }): PublicUser {
    const email = String(opts.email).toLowerCase().trim();
    const id = "u_" + Math.random().toString(36).slice(2, 12);
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO users (id, email, nickname, password_hash, role, status, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)`,
      )
      .run(
        id,
        email,
        String(opts.nickname || email.split("@")[0]).slice(0, 255),
        hashPassword(opts.password),
        opts.role || "user",
        now,
      );
    const u = this.findUserById(id);
    if (!u) throw new Error("createUser failed");
    return this.mapUser(u);
  }

  ensureAdmin(email: string, passwordHash: string): void {
    const emailLc = email.toLowerCase();
    if (this.findUserByEmail(emailLc)) return;
    const id = "u_admin";
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO users (id, email, nickname, password_hash, role, status, created_at, last_login_at)
         VALUES (?, ?, ?, ?, 'admin', 'active', ?, NULL)`,
      )
      .run(id, emailLc, "Administrator", passwordHash, now);
  }

  updateUser(id: string, patch: { role?: UserRole; status?: UserStatus }): PublicUser | null {
    const u = this.findUserById(id);
    if (!u) return null;
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.role !== undefined) {
      sets.push("role = ?");
      args.push(patch.role);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      args.push(patch.status);
    }
    if (sets.length === 0) return this.mapUser(u);
    args.push(id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    const after = this.findUserById(id);
    return after ? this.mapUser(after) : null;
  }

  updatePassword(id: string, currentPassword: string, nextPassword: string): void {
    const u = this.findUserById(id);
    if (!u) throw new Error("用户不存在");
    if (!verifyPassword(currentPassword, u.password_hash)) {
      throw new Error("当前密码不正确");
    }
    this.db
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashPassword(nextPassword), id);
  }

  updateProfile(id: string, nickname: string): PublicUser {
    const u = this.findUserById(id);
    if (!u) throw new Error("用户不存在");
    const safe = String(nickname || "").trim().slice(0, 255);
    if (!safe) throw new Error("昵称不能为空");
    this.db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(safe, id);
    const after = this.findUserById(id);
    if (!after) throw new Error("用户不存在");
    return this.mapUser(after);
  }

  touchLastLogin(id: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, id);
  }

  purgeUserData(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    // 注:实际不删用户,只清 session / 设置(按 sync_server 模式)
  }

  // ============================================================
  // Session CRUD
  // ============================================================

  createSession(userId: string): { token: string; refreshToken: string; expiresAt: number } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = tokenExpiresAt(30);
    const token = newToken("acc");
    const refresh = newToken("ref");
    this.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(hashToken(token), userId, expiresAt, now);
    this.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(hashToken(refresh), userId, tokenExpiresAt(90), now);
    return { token, refreshToken: refresh, expiresAt };
  }

  authenticateBearerToken(token: string): { user: PublicUser; tokenHash: string } | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as DbSession | undefined;
    if (!row) return null;
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    const user = this.findUserById(row.user_id);
    if (!user || user.status !== "active") return null;
    return { user: this.mapUser(user), tokenHash };
  }

  refreshSession(refreshToken: string): { token: string; refreshToken: string; expiresAt: number } {
    const tokenHash = hashToken(refreshToken);
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as DbSession | undefined;
    if (!row) throw new Error("refresh token 无效");
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      throw new Error("refresh token 已过期");
    }
    const user = this.findUserById(row.user_id);
    if (!user || user.status !== "active") throw new Error("用户已禁用");
    // 删旧 + 发新
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return this.createSession(user.id);
  }

  revokeSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(String(tokenHash || ""));
  }

  // ============================================================
  // Settings CRUD
  // ============================================================

  private mapSetting(row: DbSetting): Setting {
    let value: unknown = null;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    return {
      key: row.key,
      value,
      category: row.category,
      visibility: row.visibility,
      description: row.description || undefined,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  listSettings(opts: { category?: SettingCategory; visibility?: SettingVisibility } = {}): Setting[] {
    let sql = "SELECT * FROM settings WHERE 1=1";
    const args: unknown[] = [];
    if (opts.category) {
      sql += " AND category = ?";
      args.push(opts.category);
    }
    if (opts.visibility) {
      sql += " AND visibility = ?";
      args.push(opts.visibility);
    }
    sql += " ORDER BY category, key";
    const rows = this.db.prepare(sql).all(...args) as DbSetting[];
    return rows.map((r) => this.mapSetting(r));
  }

  getSetting(key: string): Setting | null {
    const row = this.db
      .prepare("SELECT * FROM settings WHERE key = ?")
      .get(String(key || "")) as DbSetting | undefined;
    return row ? this.mapSetting(row) : null;
  }

  upsertSetting(opts: {
    key: string;
    value: unknown;
    category: SettingCategory;
    visibility?: SettingVisibility;
    description?: string;
    updatedBy: string | null;
  }): Setting {
    const key = String(opts.key || "").trim();
    if (!key) throw new Error("setting key 不能为空");
    const valueStr = JSON.stringify(opts.value ?? null);
    const visibility = opts.visibility || "admin";
    const description = opts.description || null;
    const updatedAt = Math.floor(Date.now() / 1000);
    const updatedBy = opts.updatedBy || null;

    const existing = this.getSetting(key);
    if (existing) {
      this.db
        .prepare(
          `UPDATE settings SET value = ?, category = ?, visibility = ?, description = ?,
           updated_at = ?, updated_by = ? WHERE key = ?`,
        )
        .run(valueStr, opts.category, visibility, description, updatedAt, updatedBy, key);
    } else {
      this.db
        .prepare(
          `INSERT INTO settings (key, value, category, visibility, description, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(key, valueStr, opts.category, visibility, description, updatedAt, updatedBy);
    }
    const after = this.getSetting(key);
    if (!after) throw new Error("upsertSetting failed");
    return after;
  }

  deleteSetting(key: string): boolean {
    const info = this.db.prepare("DELETE FROM settings WHERE key = ?").run(String(key || ""));
    return info.changes > 0;
  }

  // ============================================================
  // api_call_logs CRUD(Iter 3: 用量日志)
  // ============================================================

  logApiCall(entry: {
    userId: string | null;
    provider: string;
    protocol: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: "ok" | "error";
    errorType?: string;
    errorMsg?: string;
    cacheHit: boolean;
    requestId?: string;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO api_call_logs
           (user_id, provider, protocol, model, prompt_tokens, completion_tokens, total_tokens,
            latency_ms, status, error_type, error_msg, cache_hit, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.userId,
          entry.provider,
          entry.protocol,
          entry.model,
          entry.promptTokens,
          entry.completionTokens,
          entry.totalTokens,
          entry.latencyMs,
          entry.status,
          entry.errorType || null,
          entry.errorMsg || null,
          entry.cacheHit ? 1 : 0,
          entry.requestId || null,
          Math.floor(Date.now() / 1000),
        );
    } catch (e) {
      // 日志失败不抛
      console.error("[logApiCall] failed:", e);
    }
  }

  /** 聚合用量:总调用 / 错率 / 平均 latency / top users */
  aiUsageSummary(since: number = 0): {
    totalCalls: number;
    errorCount: number;
    avgLatencyMs: number;
    cacheHits: number;
    totalTokens: number;
    byUser: Array<{ userId: string; calls: number; tokens: number }>;
    byProvider: Array<{ provider: string; calls: number }>;
  } {
    const sinceSec = Math.floor(since / 1000);
    const params: any[] = sinceSec > 0 ? [sinceSec] : [];
    const where = sinceSec > 0 ? "WHERE created_at >= ?" : "";
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM api_call_logs ${where}`)
      .get(...params) as { c: number };
    const errRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM api_call_logs ${where ? where + " AND status = 'error'" : "WHERE status = 'error'"}`)
      .get(...(sinceSec > 0 ? [sinceSec] : [])) as { c: number };
    const latRow = this.db
      .prepare(`SELECT AVG(latency_ms) AS a FROM api_call_logs ${where}`)
      .get(...params) as { a: number | null };
    const cacheRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM api_call_logs ${where ? where + " AND cache_hit = 1" : "WHERE cache_hit = 1"}`)
      .get(...(sinceSec > 0 ? [sinceSec] : [])) as { c: number };
    const tokRow = this.db
      .prepare(`SELECT COALESCE(SUM(total_tokens),0) AS s FROM api_call_logs ${where}`)
      .get(...params) as { s: number };
    const byUser = this.db
      .prepare(
        `SELECT user_id AS userId, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS tokens
         FROM api_call_logs ${where} ${sinceSec > 0 ? "AND" : "WHERE"} user_id IS NOT NULL
         GROUP BY user_id ORDER BY calls DESC LIMIT 10`,
      )
      .all(...(sinceSec > 0 ? [sinceSec] : [])) as Array<{ userId: string; calls: number; tokens: number }>;
    const byProvider = this.db
      .prepare(
        `SELECT provider, COUNT(*) AS calls FROM api_call_logs ${where}
         GROUP BY provider ORDER BY calls DESC`,
      )
      .all(...params) as Array<{ provider: string; calls: number }>;
    return {
      totalCalls: totalRow.c,
      errorCount: errRow.c,
      avgLatencyMs: Math.round(latRow.a || 0),
      cacheHits: cacheRow.c,
      totalTokens: tokRow.s,
      byUser,
      byProvider,
    };
  }

  // ============================================================
  // ai_response_cache CRUD(Iter 4: 响应缓存)
  // ============================================================

  getCachedResponse(key: string): { responseJson: string; model: string; promptTokens: number; completionTokens: number } | null {
    const row = this.db
      .prepare(
        "SELECT response_json, model, prompt_tokens, completion_tokens FROM ai_response_cache WHERE cache_key = ? AND expires_at > ?",
      )
      .get(String(key || ""), Math.floor(Date.now() / 1000)) as
      | { response_json: string; model: string; prompt_tokens: number; completion_tokens: number }
      | undefined;
    if (!row) return null;
    return {
      responseJson: row.response_json,
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
    };
  }

  setCachedResponse(key: string, value: {
    model: string;
    promptHash: string;
    responseJson: string;
    promptTokens: number;
    completionTokens: number;
    ttlSeconds: number;
  }): void {
    try {
      const now = Math.floor(Date.now() / 1000);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ai_response_cache
           (cache_key, model, prompt_hash, response_json, prompt_tokens, completion_tokens, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          String(key || ""),
          value.model,
          value.promptHash,
          value.responseJson,
          value.promptTokens,
          value.completionTokens,
          now,
          now + value.ttlSeconds,
        );
    } catch (e) {
      console.error("[setCachedResponse] failed:", e);
    }
  }

  /** 清理过期缓存(可后台调用) */
  purgeExpiredCache(): number {
    const info = this.db
      .prepare("DELETE FROM ai_response_cache WHERE expires_at <= ?")
      .run(Math.floor(Date.now() / 1000));
    return info.changes;
  }

  // ============================================================
  // alert_history CRUD(告警通知)
  // ============================================================

  logAlert(entry: {
    event: string;
    severity: string;
    message: string;
    payload?: string;
    channels: string;
    results: string;
    dedupKey?: string;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO alert_history
           (event, severity, message, payload, channels, results, dedup_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.event,
          entry.severity,
          entry.message,
          entry.payload || null,
          entry.channels,
          entry.results,
          entry.dedupKey || null,
          Math.floor(Date.now() / 1000),
        );
    } catch (e) {
      console.error("[logAlert] failed:", e);
    }
  }

  /** 同 dedup_key 在 recentSeconds 内是否已有记录(用于去重) */
  hasRecentAlert(dedupKey: string, recentSeconds: number): boolean {
    const cutoff = Math.floor(Date.now() / 1000) - recentSeconds;
    const row = this.db
      .prepare("SELECT id FROM alert_history WHERE dedup_key = ? AND created_at >= ? LIMIT 1")
      .get(String(dedupKey || ""), cutoff) as { id: number } | undefined;
    return !!row;
  }

  /** 列出告警历史(分页) */
  listAlerts(opts: { event?: string; limit?: number; offset?: number } = {}): Array<{
    id: number;
    event: string;
    severity: string;
    message: string;
    payload: string | null;
    channels: string;
    results: string;
    dedupKey: string | null;
    createdAt: number;
  }> {
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    let sql = "SELECT * FROM alert_history WHERE 1=1";
    const args: unknown[] = [];
    if (opts.event) {
      sql += " AND event = ?";
      args.push(opts.event);
    }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);
    const rows = this.db.prepare(sql).all(...args) as Array<{
      id: number; event: string; severity: string; message: string;
      payload: string | null; channels: string; results: string;
      dedup_key: string | null; created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id, event: r.event, severity: r.severity, message: r.message,
      payload: r.payload, channels: r.channels, results: r.results,
      dedupKey: r.dedup_key, createdAt: r.created_at,
    }));
  }

  /** 清理超量历史(留最近 keep 行) */
  pruneAlerts(keep: number = 1000): number {
    const total = (this.db.prepare("SELECT COUNT(*) AS c FROM alert_history").get() as { c: number }).c;
    if (total <= keep) return 0;
    const info = this.db
      .prepare(
        `DELETE FROM alert_history WHERE id NOT IN
         (SELECT id FROM alert_history ORDER BY created_at DESC LIMIT ?)`,
      )
      .run(keep);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
