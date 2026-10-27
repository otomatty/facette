-- Facette 初期スキーマ

-- ───────── マスタ ─────────
CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_departments_parent ON departments(parent_id);

CREATE TABLE job_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL DEFAULT 0,
  is_manager INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE employment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ───────── 社員 ─────────
CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT NOT NULL UNIQUE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name_kana TEXT NOT NULL DEFAULT '',
  first_name_kana TEXT NOT NULL DEFAULT '',
  email TEXT,
  gender TEXT NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'other', 'unknown')),
  birth_date TEXT,
  hire_date TEXT,
  leave_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'retired')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  job_title_id INTEGER REFERENCES job_titles(id) ON DELETE SET NULL,
  grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  employment_type_id INTEGER REFERENCES employment_types(id) ON DELETE SET NULL,
  phone TEXT,
  work_location TEXT,
  bio TEXT NOT NULL DEFAULT '',
  photo_updated_at TEXT,
  avatar_seed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_members_department ON members(department_id);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_kana ON members(last_name_kana, first_name_kana);

CREATE TABLE member_photos (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 異動履歴
CREATE TABLE member_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,
  from_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  to_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  from_job_title_id INTEGER REFERENCES job_titles(id) ON DELETE SET NULL,
  to_job_title_id INTEGER REFERENCES job_titles(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_transfers_member ON member_transfers(member_id, effective_date);

-- ───────── 認証 ─────────
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'hr', 'manager', 'member')),
  member_id INTEGER UNIQUE REFERENCES members(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ───────── シート（カスタム項目） ─────────
CREATE TABLE sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('single', 'multi')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  self_access TEXT NOT NULL DEFAULT 'view' CHECK (self_access IN ('none', 'view', 'edit')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sheet_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url')),
  options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  help_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sheet_fields_sheet ON sheet_fields(sheet_id, sort_order);

CREATE TABLE sheet_permissions (
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('hr', 'manager', 'member')),
  access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
  PRIMARY KEY (sheet_id, role)
);

CREATE TABLE sheet_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sheet_records_member ON sheet_records(member_id, sheet_id);
CREATE INDEX idx_sheet_records_sheet ON sheet_records(sheet_id);

-- ───────── 社員リスト ─────────
CREATE TABLE member_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'ai',
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE member_list_items (
  list_id INTEGER NOT NULL REFERENCES member_lists(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, member_id)
);

-- ───────── スキル ─────────
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'その他',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE member_skills (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (member_id, skill_id)
);
CREATE INDEX idx_member_skills_skill ON member_skills(skill_id, level);

-- ───────── ポジション管理 ─────────
CREATE TABLE job_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  mission TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  headcount INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_position_requirements (
  position_id INTEGER NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  min_level INTEGER NOT NULL DEFAULT 3 CHECK (min_level BETWEEN 1 AND 5),
  weight INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (position_id, skill_id)
);

-- ───────── 1on1・面談記録 ─────────
CREATE TABLE one_on_ones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  interviewer_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  held_on TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  next_actions TEXT NOT NULL DEFAULT '',
  condition INTEGER CHECK (condition BETWEEN 1 AND 5),
  shared_with_member INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_one_on_ones_member ON one_on_ones(member_id, held_on);

-- ───────── 評価 ─────────
CREATE TABLE evaluation_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scale_max INTEGER NOT NULL DEFAULT 5,
  goal_weight INTEGER NOT NULL DEFAULT 60,
  competency_weight INTEGER NOT NULL DEFAULT 40,
  rank_rules TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE evaluation_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES evaluation_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE evaluation_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES evaluation_templates(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  use_second_step INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE evaluation_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  first_evaluator_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  second_evaluator_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  step TEXT NOT NULL DEFAULT 'goal' CHECK (step IN ('goal', 'self', 'first', 'second', 'final', 'done')),
  final_score REAL,
  final_rank TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period_id, member_id)
);
CREATE INDEX idx_eval_sheets_first ON evaluation_sheets(first_evaluator_id);
CREATE INDEX idx_eval_sheets_second ON evaluation_sheets(second_evaluator_id);
CREATE INDEX idx_eval_sheets_member ON evaluation_sheets(member_id);

CREATE TABLE evaluation_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES evaluation_sheets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE evaluation_scores (
  sheet_id INTEGER NOT NULL REFERENCES evaluation_sheets(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('self', 'first', 'second', 'final')),
  target_type TEXT NOT NULL CHECK (target_type IN ('goal', 'item')),
  target_id INTEGER NOT NULL,
  score REAL,
  comment TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (sheet_id, phase, target_type, target_id)
);

CREATE TABLE evaluation_phase_comments (
  sheet_id INTEGER NOT NULL REFERENCES evaluation_sheets(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('self', 'first', 'second', 'final')),
  comment TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (sheet_id, phase)
);

CREATE TABLE evaluation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES evaluation_sheets(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('submit', 'remand', 'reopen')),
  from_step TEXT NOT NULL,
  to_step TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────── アンケート ─────────
CREATE TABLE surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'survey' CHECK (kind IN ('survey', 'pulse')),
  anonymous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  closes_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE survey_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multi', 'scale', 'nps', 'text')),
  text TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE survey_targets (
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  responded_at TEXT,
  PRIMARY KEY (survey_id, member_id)
);
CREATE INDEX idx_survey_targets_member ON survey_targets(member_id);

CREATE TABLE survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);

CREATE TABLE survey_answers (
  response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (response_id, question_id)
);

-- ───────── 配置シミュレーション ─────────
CREATE TABLE placement_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied')),
  effective_date TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE placement_moves (
  scenario_id INTEGER NOT NULL REFERENCES placement_scenarios(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  to_department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  to_job_title_id INTEGER REFERENCES job_titles(id) ON DELETE SET NULL,
  PRIMARY KEY (scenario_id, member_id)
);

-- ───────── お知らせ ─────────
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────── 分析 ─────────
CREATE TABLE saved_charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dashboard_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('metric', 'chart')),
  config TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1 CHECK (width IN (1, 2)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_dashboard_panels_user ON dashboard_panels(user_id, sort_order);

-- ───────── 申請ワークフロー ─────────
CREATE TABLE change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  record_id INTEGER REFERENCES sheet_records(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX idx_change_requests_status ON change_requests(status, created_at);

-- ───────── 操作ログ・設定 ─────────
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
