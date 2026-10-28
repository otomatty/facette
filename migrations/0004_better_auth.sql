-- 認証を Better Auth の Google ログインに切り替える
-- users は Better Auth のユーザーとしてそのまま使い、パスワード関連の列を削除する。
-- ユーザーはシステム管理者だけが登録するため、登録済みのメールアドレスは確認済みとして扱う
-- （Google アカウントは、メールアドレスが一致する登録済みユーザーにだけひもづく）。
DROP TABLE sessions;

ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users DROP COLUMN failed_logins;
ALTER TABLE users DROP COLUMN locked_until;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN image TEXT;

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ログインに使う外部アカウント（Google）
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

-- OAuth の state など、一時的な検証用の値
CREATE TABLE verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_verifications_identifier ON verifications(identifier);
