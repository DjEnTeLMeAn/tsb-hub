-- Backend-only D1 schema. All timestamps are UTC ISO-8601 strings.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  access_sub TEXT NOT NULL UNIQUE CHECK (length(access_sub) BETWEEN 1 AND 512),
  email TEXT CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 320 AND email = lower(email))),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  last_seen_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at) = last_seen_at)
);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('user.created', 'state.updated')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256 AND request_id NOT GLOB '*[^A-Za-z0-9._:-]*')
);

CREATE INDEX IF NOT EXISTS idx_users_access_sub ON users(access_sub);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_events(request_id);
