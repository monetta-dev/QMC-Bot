PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, line_user_id TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
 name TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, following INTEGER NOT NULL DEFAULT 1,
 archived INTEGER NOT NULL DEFAULT 0, event_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
 line_user_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('owner','editor')), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, line_user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
 state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS group_links (
 code TEXT PRIMARY KEY, admin_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
 group_id TEXT, group_name TEXT, group_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS schedules (
 month TEXT PRIMARY KEY, draft TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 0,
 published_id TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS publications (
 id TEXT PRIMARY KEY, month TEXT NOT NULL, revision INTEGER NOT NULL,
 snapshot TEXT NOT NULL, payload TEXT NOT NULL, group_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','failed','expired')),
 created_at INTEGER NOT NULL, accepted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT,
 UNIQUE(month, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS publication_pending ON publications(month) WHERE status='pending';
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, member_id TEXT NOT NULL,
 publication_id TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','failed','skipped')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, accepted_at INTEGER, error TEXT,
 UNIQUE(date, member_id)
);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL
);
