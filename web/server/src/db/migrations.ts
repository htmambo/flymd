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
  `);
}
