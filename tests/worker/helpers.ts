import { env, SELF } from "cloudflare:test";
import { hashPassword } from "../../src/worker/lib/crypto";

export const PASSWORD = "correct-horse-battery";

let cachedHash: string | null = null;
async function pwHash(): Promise<string> {
  cachedHash ??= await hashPassword(PASSWORD);
  return cachedHash;
}

/**
 * テスト用の最小データ
 * 本社(1) ─ 開発部(2) ─ 開発1課(3)
 *        └ 営業部(4)
 */
export async function seedBasic(): Promise<void> {
  const db = env.DB;
  const hash = await pwHash();
  await db.batch([
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM users"),
    db.prepare("DELETE FROM sheet_records"),
    db.prepare("DELETE FROM sheet_permissions"),
    db.prepare("DELETE FROM sheet_fields"),
    db.prepare("DELETE FROM sheets"),
    db.prepare("DELETE FROM member_skills"),
    db.prepare("DELETE FROM skills"),
    db.prepare("DELETE FROM members"),
    db.prepare("DELETE FROM job_titles"),
    db.prepare("DELETE FROM grades"),
    db.prepare("DELETE FROM employment_types"),
    db.prepare("DELETE FROM departments"),
    db.prepare(
      "INSERT INTO departments (id, name, parent_id, sort_order, code) VALUES (1, '本社', NULL, 1, 'D0')",
    ),
    db.prepare(
      "INSERT INTO departments (id, name, parent_id, sort_order, code) VALUES (2, '開発部', 1, 2, 'D2')",
    ),
    db.prepare(
      "INSERT INTO departments (id, name, parent_id, sort_order, code) VALUES (3, '開発1課', 2, 3, 'D3')",
    ),
    db.prepare(
      "INSERT INTO departments (id, name, parent_id, sort_order, code) VALUES (4, '営業部', 1, 4, 'D4')",
    ),
    db.prepare(
      "INSERT INTO job_titles (id, name, rank, is_manager) VALUES (1, '部長', 60, 1), (2, 'メンバー', 0, 0)",
    ),
    db.prepare("INSERT INTO grades (id, name, rank) VALUES (1, 'G1', 1), (2, 'G2', 2)"),
    db.prepare(
      "INSERT INTO employment_types (id, name, sort_order) VALUES (1, '正社員', 1), (2, '契約社員', 2)",
    ),
    db.prepare(`INSERT INTO members (id, employee_code, last_name, first_name, last_name_kana, first_name_kana, gender, birth_date, hire_date, status, department_id, job_title_id, grade_id, employment_type_id, email)
      VALUES
      (1, 'E001', '人事', '花子', 'じんじ', 'はなこ', 'female', '1985-04-01', '2010-04-01', 'active', 1, 2, 2, 1, 'hr@test.jp'),
      (2, 'E002', '開発', '部長', 'かいはつ', 'ぶちょう', 'male', '1980-01-15', '2008-04-01', 'active', 2, 1, 2, 1, 'mgr@test.jp'),
      (3, 'E003', '山田', '太郎', 'やまだ', 'たろう', 'male', '1995-06-30', '2019-04-01', 'active', 3, 2, 1, 1, 'taro@test.jp'),
      (4, 'E004', '営業', '次郎', 'えいぎょう', 'じろう', 'male', '1990-12-01', '2015-10-01', 'active', 4, 2, 1, 2, 'jiro@test.jp'),
      (5, 'E005', '退職', '三郎', 'たいしょく', 'さぶろう', 'male', '1970-01-01', '2000-04-01', 'retired', 4, 2, 1, 1, NULL),
      (6, 'E006', '管理', '一郎', 'かんり', 'いちろう', 'male', '1975-01-01', '2001-04-01', 'active', 1, 2, 2, 1, 'admin@test.jp')`),
    db
      .prepare(`INSERT INTO users (id, email, display_name, password_hash, role, member_id, is_demo) VALUES
      (1, 'admin@test.jp', '管理 一郎', ?1, 'admin', 6, 1),
      (2, 'hr@test.jp', '人事 花子', ?1, 'hr', 1, 1),
      (3, 'mgr@test.jp', '開発 部長', ?1, 'manager', 2, 1),
      (4, 'taro@test.jp', '山田 太郎', ?1, 'member', 3, 0),
      (5, 'jiro@test.jp', '営業 次郎', ?1, 'member', 4, 0)`)
      .bind(hash),
    db.prepare(`INSERT INTO sheets (id, name, kind, sort_order, self_access) VALUES
      (1, '公開プロフィール', 'single', 1, 'edit'),
      (2, '人事情報', 'single', 2, 'view'),
      (3, 'タレント', 'single', 3, 'none'),
      (4, '資格', 'multi', 4, 'edit')`),
    db.prepare(`INSERT INTO sheet_permissions (sheet_id, role, access) VALUES
      (1, 'hr', 'edit'), (1, 'manager', 'view'), (1, 'member', 'view'),
      (2, 'hr', 'edit'), (2, 'manager', 'none'), (2, 'member', 'none'),
      (3, 'hr', 'edit'), (3, 'manager', 'edit'), (3, 'member', 'none'),
      (4, 'hr', 'edit'), (4, 'manager', 'view'), (4, 'member', 'view')`),
    db.prepare(`INSERT INTO sheet_fields (id, sheet_id, label, type, options, required, sort_order) VALUES
      (1, 1, '趣味', 'text', '[]', 0, 1),
      (2, 2, '居住地', 'select', '["東京都","大阪府"]', 0, 1),
      (3, 3, 'パフォーマンス', 'select', '["高","中","低"]', 0, 1),
      (4, 3, '後継者候補', 'checkbox', '[]', 0, 2),
      (5, 4, '資格名', 'text', '[]', 1, 1),
      (6, 4, '取得日', 'date', '[]', 0, 2)`),
    db.prepare(`INSERT INTO sheet_records (sheet_id, member_id, data) VALUES
      (3, 3, '{"3":"高","4":true}'),
      (3, 4, '{"3":"低","4":false}'),
      (2, 3, '{"2":"東京都"}')`),
    db.prepare(
      "INSERT INTO skills (id, name, category) VALUES (1, 'TypeScript', '技術'), (2, '営業', 'ビジネス')",
    ),
    db.prepare(
      "INSERT INTO member_skills (member_id, skill_id, level) VALUES (3, 1, 4), (4, 2, 3), (2, 1, 2)",
    ),
  ]);
}

export type Client = {
  cookie: string;
  fetch: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  get: <T = unknown>(path: string) => Promise<{ status: number; body: T }>;
  send: <T = unknown>(method: string, path: string, json?: unknown) => Promise<{ status: number; body: T }>;
};

const BASE = "https://facette.test";

function makeClient(cookie: string): Client {
  const doFetch = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    return SELF.fetch(`${BASE}${path}`, { ...init, headers, body });
  };
  return {
    cookie,
    fetch: doFetch,
    async get<T>(path: string) {
      const res = await doFetch(path);
      return { status: res.status, body: (await res.json()) as T };
    },
    async send<T>(method: string, path: string, json?: unknown) {
      const res = await doFetch(path, { method, json: json ?? {} });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}

export const anon = makeClient("");

export async function login(email: string, password = PASSWORD): Promise<Client> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]!;
  return makeClient(cookie);
}
