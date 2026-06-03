/**
 * SQLite 迁移
 */
import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'admin',
      description TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

    -- Iter 3: AI 调用日志
    CREATE TABLE IF NOT EXISTS api_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      provider TEXT NOT NULL,
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ok',
      error_type TEXT,
      error_msg TEXT,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      request_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_user ON api_call_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON api_call_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_status ON api_call_logs(status);

    -- Iter 4: AI 响应缓存
    CREATE TABLE IF NOT EXISTS ai_response_cache (
      cache_key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON ai_response_cache(expires_at);

    -- 告警通知(Iter 5):发送历史
    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      channels TEXT NOT NULL,
      results TEXT NOT NULL,
      dedup_key TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_event ON alert_history(event);
    CREATE INDEX IF NOT EXISTS idx_alert_created ON alert_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_alert_dedup ON alert_history(dedup_key, created_at);
  `);
}
