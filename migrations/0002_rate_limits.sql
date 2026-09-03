PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('state_put', 'mutation', 'read')),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  count INTEGER NOT NULL CHECK (count >= 1),
  expires_at INTEGER NOT NULL CHECK (expires_at > window_start),
  last_allowed INTEGER NOT NULL CHECK (last_allowed IN (0, 1)),
  PRIMARY KEY (user_id, scope)
);
