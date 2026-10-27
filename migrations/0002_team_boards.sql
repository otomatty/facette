-- チームキャンバス（顔を自由に並べてチーム編成を考えるボード）
CREATE TABLE team_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{"items":[],"groups":[],"notes":[]}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_team_boards_owner ON team_boards(owner_user_id);
