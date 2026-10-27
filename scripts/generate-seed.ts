/**
 * デモ用シード SQL を生成する。
 * 使い方: node scripts/generate-seed.ts [出力先 (既定: seed/seed.sql)]
 * 生成される人物・会社はすべて架空。
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BIOS,
  DEPT_SKILL_AFFINITY,
  FEMALE_NAMES,
  LOCATIONS,
  MALE_NAMES,
  ONE_ON_ONE_ACTIONS,
  ONE_ON_ONE_NOTES,
  ONE_ON_ONE_TOPICS,
  PREFS,
  QUALIFICATIONS,
  SKILLS,
  SURNAMES,
  TRAININGS,
  UNISEX_NAMES,
} from "./seed-data.ts";

export const DEMO_PASSWORD = "facette-demo";

// ───────── 乱数（再現性のため固定シード） ─────────
let state = 20261027;
function rand(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]!);
  return out;
}

// ───────── SQL 組み立て ─────────
const lines: string[] = [];
function q(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
function insert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  lines.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => q(row[c])).join(", ")});`);
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pw, salt, 100_000, 32, "sha256");
  return `pbkdf2_sha256$100000$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// ───────── 日付 ─────────
const TODAY = new Date();
const todayStr = TODAY.toISOString().slice(0, 10);
const thisYear = TODAY.getUTCFullYear();
const fmt = (d: Date) => d.toISOString().slice(0, 10);
function dateBetween(from: Date, to: Date): string {
  return fmt(new Date(from.getTime() + rand() * (to.getTime() - from.getTime())));
}
function addDays(d: string, n: number): string {
  return fmt(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000));
}
function sqlTs(daysAgo: number): string {
  const d = new Date(TODAY.getTime() - daysAgo * 86400000 - int(0, 36000) * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
/** 年度（4月始まり） */
const fiscalYear = TODAY.getUTCMonth() + 1 >= 4 ? thisYear : thisYear - 1;

// ───────── リセット ─────────
lines.push("PRAGMA defer_foreign_keys = ON;");
const TABLES = [
  "team_boards",
  "audit_logs",
  "change_requests",
  "dashboard_panels",
  "saved_charts",
  "announcements",
  "placement_moves",
  "placement_scenarios",
  "survey_answers",
  "survey_responses",
  "survey_targets",
  "survey_questions",
  "surveys",
  "evaluation_events",
  "evaluation_phase_comments",
  "evaluation_scores",
  "evaluation_goals",
  "evaluation_sheets",
  "evaluation_periods",
  "evaluation_template_items",
  "evaluation_templates",
  "one_on_ones",
  "job_position_requirements",
  "job_positions",
  "member_skills",
  "skills",
  "member_list_items",
  "member_lists",
  "sheet_records",
  "sheet_permissions",
  "sheet_fields",
  "sheets",
  "sessions",
  "users",
  "member_transfers",
  "member_photos",
  "members",
  "employment_types",
  "grades",
  "job_titles",
  "departments",
  "app_settings",
];
for (const t of TABLES) lines.push(`DELETE FROM ${t};`);
lines.push("DELETE FROM sqlite_sequence;");

insert("app_settings", { key: "company_name", value: "株式会社ハルカゼ" });

// ───────── 部署 ─────────
type Dept = { id: number; name: string; parent: number | null; code: string; level: number };
const depts: Dept[] = [];
function dept(name: string, parent: number | null, code: string): number {
  const id = depts.length + 1;
  const level = parent === null ? 0 : depts[parent - 1]!.level + 1;
  depts.push({ id, name, parent, code, level });
  insert("departments", { id, code, name, parent_id: parent, sort_order: id });
  return id;
}
const ROOT = dept("株式会社ハルカゼ", null, "D000");
const KEIEI = dept("経営企画本部", ROOT, "D100");
const KIKAKU = dept("経営企画部", KEIEI, "D110");
const KOHO = dept("広報部", KEIEI, "D120");
const KANRI = dept("管理本部", ROOT, "D200");
const JINJI = dept("人事部", KANRI, "D210");
const SOMU = dept("総務部", KANRI, "D220");
const KEIRI = dept("経理財務部", KANRI, "D230");
const EIGYO = dept("営業本部", ROOT, "D300");
const EIGYO1 = dept("第一営業部", EIGYO, "D310");
const EAST = dept("東日本営業課", EIGYO1, "D311");
const WEST = dept("西日本営業課", EIGYO1, "D312");
const EIGYO2 = dept("第二営業部", EIGYO, "D320");
const CS = dept("カスタマーサクセス部", EIGYO, "D330");
const KAIHATSU = dept("開発本部", ROOT, "D400");
const PROD = dept("プロダクト開発部", KAIHATSU, "D410");
const INFRA = dept("インフラ部", KAIHATSU, "D420");
const QA = dept("品質保証部", KAIHATSU, "D430");
const DESIGN = dept("デザイン部", KAIHATSU, "D440");
const MKT = dept("マーケティング本部", ROOT, "D500");
const MKT1 = dept("マーケティング部", MKT, "D510");
const DATA = dept("データ分析部", MKT, "D520");

// ───────── 役職・等級・雇用形態 ─────────
const JT = { ceo: 1, divHead: 2, deptHead: 3, manager: 4, leader: 5, staff: 6 };
insert("job_titles", { id: 1, name: "代表取締役", rank: 100, is_manager: 1 });
insert("job_titles", { id: 2, name: "本部長", rank: 80, is_manager: 1 });
insert("job_titles", { id: 3, name: "部長", rank: 60, is_manager: 1 });
insert("job_titles", { id: 4, name: "課長", rank: 40, is_manager: 1 });
insert("job_titles", { id: 5, name: "リーダー", rank: 20, is_manager: 0 });
insert("job_titles", { id: 6, name: "メンバー", rank: 0, is_manager: 0 });
const GRADES = ["J1", "J2", "S1", "S2", "S3", "M1", "M2"];
GRADES.forEach((g, i) => {
  insert("grades", { id: i + 1, name: g, rank: i + 1 });
});
const EMP = ["正社員", "契約社員", "パート・アルバイト", "業務委託", "嘱託"];
EMP.forEach((e, i) => {
  insert("employment_types", { id: i + 1, name: e, sort_order: i + 1 });
});

// ───────── 社員 ─────────
type Member = {
  id: number;
  code: string;
  last: [string, string, string];
  first: [string, string, string];
  gender: "male" | "female" | "other" | "unknown";
  birth: string;
  hire: string;
  leave: string | null;
  status: "active" | "leave" | "retired";
  dept: number;
  jt: number;
  grade: number;
  emp: number;
  location: string;
};
const members: Member[] = [];
const usedNames = new Set<string>();

function newMember(
  deptId: number,
  jt: number,
  opts: Partial<Member> & { ageMin?: number; ageMax?: number } = {},
) {
  const id = members.length + 1;
  let gender: Member["gender"] = opts.gender ?? (chance(0.54) ? "male" : chance(0.96) ? "female" : "other");
  if (gender === "other" && chance(0.5)) gender = "unknown";
  let last: [string, string, string];
  let first: [string, string, string];
  do {
    last = pick(SURNAMES);
    first =
      gender === "male"
        ? pick(MALE_NAMES)
        : gender === "female"
          ? pick(FEMALE_NAMES)
          : pick(chance(0.5) ? UNISEX_NAMES : FEMALE_NAMES);
  } while (usedNames.has(last[0] + first[0]));
  usedNames.add(last[0] + first[0]);

  const ageByJt: Record<number, [number, number]> = {
    1: [50, 58],
    2: [45, 56],
    3: [38, 52],
    4: [33, 46],
    5: [28, 40],
    6: [22, 45],
  };
  const [amin, amax] = [opts.ageMin ?? ageByJt[jt]![0], opts.ageMax ?? ageByJt[jt]![1]];
  const age = int(amin, amax);
  const birth = dateBetween(
    new Date(Date.UTC(thisYear - age - 1, TODAY.getUTCMonth(), TODAY.getUTCDate() + 1)),
    new Date(Date.UTC(thisYear - age, TODAY.getUTCMonth(), TODAY.getUTCDate())),
  );
  const maxTenure = Math.max(0, age - 22);
  const tenure = Math.min(maxTenure, jt <= 3 ? int(6, 18) : jt === 4 ? int(4, 14) : int(0, 12));
  const hireYear = thisYear - tenure;
  let hire = `${hireYear}-${pick(["04-01", "04-01", "04-01", "07-01", "10-01", "01-06", "06-01", "09-01"])}`;
  if (hire > todayStr) hire = `${hireYear - 1}-10-01`;
  const gradeByJt: Record<number, number[]> = {
    1: [7],
    2: [7],
    3: [6, 7],
    4: [5, 6],
    5: [3, 4, 5],
    6: [1, 2, 3, 4],
  };
  const m: Member = {
    id,
    code: `E${String(1000 + id).padStart(5, "0")}`,
    last,
    first,
    gender,
    birth,
    hire,
    leave: null,
    status: "active",
    dept: deptId,
    jt,
    grade: pick(gradeByJt[jt]!),
    emp: jt <= 5 ? 1 : pick([1, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5]),
    location: pick(LOCATIONS),
    ...opts,
  };
  if (m.emp === 5) m.grade = 3;
  members.push(m);
  return m;
}

// 幹部
const ceo = newMember(ROOT, JT.ceo, { gender: "male", location: "東京本社" });
const divHeads: Record<number, Member> = {};
for (const d of [KEIEI, KANRI, EIGYO, KAIHATSU, MKT])
  divHeads[d] = newMember(d, JT.divHead, { location: "東京本社" });

// 部門ごとの構成: [部署, 長の役職, 人数]
const plan: [number, number, number][] = [
  [KIKAKU, JT.deptHead, 6],
  [KOHO, JT.manager, 4],
  [JINJI, JT.deptHead, 8],
  [SOMU, JT.deptHead, 6],
  [KEIRI, JT.deptHead, 6],
  [EIGYO1, JT.deptHead, 3],
  [EAST, JT.manager, 11],
  [WEST, JT.manager, 9],
  [EIGYO2, JT.deptHead, 12],
  [CS, JT.deptHead, 10],
  [PROD, JT.deptHead, 16],
  [INFRA, JT.manager, 7],
  [QA, JT.manager, 6],
  [DESIGN, JT.manager, 6],
  [MKT1, JT.deptHead, 9],
  [DATA, JT.manager, 6],
];
const heads: Record<number, Member> = {};
for (const [d, headJt, size] of plan) {
  heads[d] = newMember(d, headJt);
  for (let i = 0; i < size; i++) {
    const jt = i < Math.ceil(size / 5) ? JT.leader : JT.staff;
    newMember(d, jt, d === WEST ? { location: "大阪支社" } : {});
  }
}
// 新入社員（今年度・今月）
for (const d of [PROD, EIGYO2, CS, MKT1]) {
  const m = newMember(d, JT.staff, { ageMin: 22, ageMax: 23 });
  m.hire = `${fiscalYear}-04-01`;
  m.grade = 1;
}
const thisMonthHire = fmt(new Date(Date.UTC(thisYear, TODAY.getUTCMonth(), 1)));
for (const d of [INFRA, JINJI]) {
  const m = newMember(d, JT.staff, { ageMin: 26, ageMax: 34 });
  m.hire = thisMonthHire;
}
// 休職・退職
for (const m of sample(
  members.filter((x) => x.jt === JT.staff),
  4,
)) {
  m.status = "leave";
}
for (const m of sample(
  members.filter((x) => x.jt === JT.staff && x.status === "active" && x.hire < `${thisYear - 1}-01-01`),
  7,
)) {
  m.status = "retired";
  m.leave = dateBetween(new Date(Date.UTC(thisYear - 1, 3, 1)), new Date(TODAY.getTime() - 20 * 86400000));
}

// デモ用に役割を固定
const demoManager = heads[PROD]!; // プロダクト開発部 部長
const demoMember = members.find((m) => m.dept === PROD && m.jt === JT.staff && m.status === "active")!;
demoMember.hire = `${thisYear - 3}-04-01`;
const demoHr = heads[JINJI]!;
const demoAdmin = members.find((m) => m.dept === SOMU && m.jt === JT.leader)!;

const bioMap = new Map<number, string>();
for (const m of members) {
  const email = `${m.first[2]}.${m.last[2]}${m.id}@example.com`;
  const bio = pick(BIOS);
  bioMap.set(m.id, bio);
  insert("members", {
    id: m.id,
    employee_code: m.code,
    last_name: m.last[0],
    first_name: m.first[0],
    last_name_kana: m.last[1],
    first_name_kana: m.first[1],
    email,
    gender: m.gender,
    birth_date: m.birth,
    hire_date: m.hire,
    leave_date: m.leave,
    status: m.status,
    department_id: m.dept,
    job_title_id: m.jt,
    grade_id: m.grade,
    employment_type_id: m.emp,
    phone: `内線 ${2000 + m.id}`,
    work_location: m.location,
    bio,
    // 最下位ビット = 髪型の系統（1: 長め）。性別に応じて偏らせる
    avatar_seed: int(1, 1_000_000_000) * 2 + ((m.gender === "male" ? chance(0.08) : chance(0.85)) ? 1 : 0),
    created_at: sqlTs(400),
    updated_at: sqlTs(int(1, 120)),
  });
}

// 異動履歴（一部の社員）
for (const m of members) {
  if (m.jt === JT.ceo || !chance(0.35)) continue;
  const from = pick(depts.filter((d) => d.level >= 2 && d.id !== m.dept));
  const date = dateBetween(new Date(`${m.hire}T00:00:00Z`), TODAY);
  if (date <= m.hire) continue;
  insert("member_transfers", {
    member_id: m.id,
    effective_date: date,
    from_department_id: from.id,
    to_department_id: m.dept,
    from_job_title_id: m.jt === JT.staff ? JT.staff : Math.min(JT.staff, m.jt + 1),
    to_job_title_id: m.jt,
    note: pick(["定期異動", "組織改編に伴う異動", "本人希望による異動", "昇格に伴う異動"]),
  });
}

// ───────── ユーザー（デモアカウント） ─────────
const pw = hashPassword(DEMO_PASSWORD);
const users = [
  { id: 1, email: "admin@example.com", role: "admin", m: demoAdmin },
  { id: 2, email: "hr@example.com", role: "hr", m: demoHr },
  { id: 3, email: "manager@example.com", role: "manager", m: demoManager },
  { id: 4, email: "member@example.com", role: "member", m: demoMember },
];
for (const u of users) {
  insert("users", {
    id: u.id,
    email: u.email,
    display_name: `${u.m.last[0]} ${u.m.first[0]}`,
    password_hash: pw,
    role: u.role,
    member_id: u.m.id,
    is_demo: 1,
    last_login_at: sqlTs(int(0, 5)),
  });
}

// ───────── シート ─────────
type FieldDef = { label: string; type: string; options?: string[]; required?: boolean; help?: string };
let fieldId = 0;
const sheetFields: Record<string, Record<string, number>> = {};
function sheet(
  id: number,
  name: string,
  kind: "single" | "multi",
  description: string,
  perms: { hr: string; manager: string; member: string; self: string },
  fields: FieldDef[],
) {
  insert("sheets", { id, name, description, kind, sort_order: id, self_access: perms.self });
  for (const role of ["hr", "manager", "member"] as const) {
    insert("sheet_permissions", { sheet_id: id, role, access: perms[role] });
  }
  sheetFields[name] = {};
  fields.forEach((f, i) => {
    fieldId++;
    sheetFields[name]![f.label] = fieldId;
    insert("sheet_fields", {
      id: fieldId,
      sheet_id: id,
      label: f.label,
      type: f.type,
      options: f.options ?? [],
      required: f.required ? 1 : 0,
      help_text: f.help ?? "",
      sort_order: i + 1,
    });
  });
}

sheet(
  1,
  "自己紹介",
  "single",
  "全社に公開されるプロフィールです。本人が自由に編集できます。",
  { hr: "edit", manager: "view", member: "view", self: "edit" },
  [
    { label: "呼ばれたい名前", type: "text" },
    { label: "趣味", type: "text" },
    { label: "得意なこと", type: "textarea" },
    {
      label: "相談に乗れること",
      type: "textarea",
      help: "社内の誰かが困ったときに頼れるように書いておきましょう",
    },
  ],
);
sheet(
  2,
  "人事基本情報",
  "single",
  "人事が管理する基本情報。本人は閲覧と変更申請ができます。",
  { hr: "edit", manager: "none", member: "none", self: "view" },
  [
    { label: "入社経路", type: "select", options: ["新卒", "中途", "リファラル", "その他"] },
    { label: "前職", type: "text" },
    { label: "最終学歴", type: "select", options: ["高校", "専門学校", "短期大学", "大学", "大学院"] },
    { label: "居住地（都道府県）", type: "select", options: PREFS },
    { label: "通勤手段", type: "multiselect", options: ["電車", "バス", "自転車", "徒歩", "自動車"] },
    { label: "緊急連絡先", type: "text", help: "続柄と電話番号" },
  ],
);
sheet(
  3,
  "キャリア志向",
  "single",
  "本人のキャリアの希望。マネージャーは面談前に確認できます。",
  { hr: "edit", manager: "view", member: "none", self: "edit" },
  [
    { label: "異動希望", type: "select", options: ["現部署で継続", "異動を希望", "どちらでもない"] },
    { label: "希望する職種", type: "text" },
    { label: "挑戦したいこと", type: "textarea" },
    { label: "転勤", type: "select", options: ["可", "条件付きで可", "不可"] },
  ],
);
sheet(
  4,
  "タレント評価",
  "single",
  "人事とマネージャーによる人材の見立て。本人には表示されません。配置バランス図の軸に使えます。",
  { hr: "edit", manager: "edit", member: "none", self: "none" },
  [
    { label: "パフォーマンス", type: "select", options: ["高", "中", "低"] },
    { label: "ポテンシャル", type: "select", options: ["高", "中", "低"] },
    { label: "後継者候補", type: "checkbox" },
    { label: "離職リスク", type: "select", options: ["高", "中", "低"] },
    { label: "タレントメモ", type: "textarea" },
  ],
);
sheet(
  5,
  "資格・免許",
  "multi",
  "保有している資格や免許。",
  { hr: "edit", manager: "view", member: "view", self: "edit" },
  [
    { label: "資格名", type: "text", required: true },
    { label: "取得日", type: "date" },
    { label: "認定団体", type: "text" },
  ],
);
sheet(
  6,
  "研修受講履歴",
  "multi",
  "社内外の研修の受講記録。",
  { hr: "edit", manager: "view", member: "none", self: "view" },
  [
    { label: "研修名", type: "text", required: true },
    { label: "受講日", type: "date" },
    { label: "区分", type: "select", options: ["必須", "選択", "外部"] },
    { label: "修了", type: "checkbox" },
  ],
);
sheet(
  7,
  "勤務状況",
  "single",
  "勤怠システムから月次で取り込む想定の数値。",
  { hr: "edit", manager: "view", member: "none", self: "view" },
  [
    { label: "月平均残業時間", type: "number", help: "直近3か月の平均（時間）" },
    { label: "有給取得日数", type: "number", help: "今年度の取得日数" },
    { label: "健康診断判定", type: "select", options: ["A", "B", "C", "D"] },
  ],
);
const ENNEAGRAM = [
  "1 改革する人",
  "2 人を助ける人",
  "3 達成する人",
  "4 個性的な人",
  "5 調べる人",
  "6 忠実な人",
  "7 熱中する人",
  "8 挑戦する人",
  "9 平和をもたらす人",
];
const STRENGTHS = ["分析力", "発想力", "実行力", "調整力", "傾聴力", "説明力", "粘り強さ", "学習意欲"];
sheet(
  8,
  "パーソナリティ",
  "single",
  "性格タイプ（エニアグラム）と強み。チームづくりや配置の検討に使います。",
  { hr: "edit", manager: "view", member: "view", self: "edit" },
  [
    {
      label: "性格タイプ（エニアグラム）",
      type: "select",
      options: ENNEAGRAM,
      help: "診断結果のタイプを選んでください",
    },
    { label: "強み", type: "multiselect", options: STRENGTHS },
    { label: "仕事で大切にしていること", type: "textarea" },
  ],
);

let recordId = 0;
function record(sheetId: number, memberId: number, data: Record<string, unknown>, sort = 0) {
  recordId++;
  insert("sheet_records", {
    id: recordId,
    sheet_id: sheetId,
    member_id: memberId,
    data,
    sort_order: sort,
    updated_at: sqlTs(int(1, 200)),
  });
}
const F = (sheetName: string, label: string) => String(sheetFields[sheetName]![label]);
const talent = new Map<number, { perf: string; pot: string }>();

for (const m of members) {
  if (chance(0.8)) {
    record(1, m.id, {
      [F("自己紹介", "呼ばれたい名前")]: chance(0.5) ? `${m.first[0]}さん` : `${m.last[0]}さん`,
      [F("自己紹介", "趣味")]: pick([
        "料理",
        "登山",
        "読書",
        "映画鑑賞",
        "ランニング",
        "写真",
        "ボードゲーム",
        "旅行",
        "サウナ",
        "釣り",
      ]),
      [F("自己紹介", "得意なこと")]: pick([
        "資料を短くまとめること",
        "初対面の人とすぐ打ち解けること",
        "細かい数字のチェック",
        "段取りを組むこと",
        "Excel の関数",
      ]),
      [F("自己紹介", "相談に乗れること")]: pick([
        "子育てと仕事の両立",
        "社内ツールの使い方",
        "英語の学習方法",
        "キャリアの悩み",
        "",
      ]),
    });
  }
  const isNew = m.hire >= `${thisYear - 4}-01-01`;
  record(2, m.id, {
    [F("人事基本情報", "入社経路")]:
      m.hire.slice(5) === "04-01" && chance(0.7) ? "新卒" : pick(["中途", "中途", "リファラル"]),
    [F("人事基本情報", "前職")]: chance(0.5)
      ? pick(["メーカー", "SIer", "広告代理店", "小売", "金融", "コンサルティング"])
      : "",
    [F("人事基本情報", "最終学歴")]: pick(["大学", "大学", "大学", "大学院", "専門学校", "高校", "短期大学"]),
    [F("人事基本情報", "居住地（都道府県）")]:
      m.location === "大阪支社"
        ? pick(["大阪府", "兵庫県", "京都府"])
        : m.location === "福岡オフィス"
          ? "福岡県"
          : pick(PREFS.slice(0, 4)),
    [F("人事基本情報", "通勤手段")]:
      m.location === "リモート" ? [] : sample(["電車", "バス", "自転車", "徒歩"], int(1, 2)),
    [F("人事基本情報", "緊急連絡先")]:
      `${pick(["配偶者", "父", "母", "兄弟"])} 090-0000-${String(1000 + m.id).slice(-4)}`,
  });
  if (chance(0.75)) {
    record(3, m.id, {
      [F("キャリア志向", "異動希望")]: pick(["現部署で継続", "現部署で継続", "異動を希望", "どちらでもない"]),
      [F("キャリア志向", "希望する職種")]: pick([
        "マネジメント",
        "スペシャリスト",
        "企画職",
        "現職を継続",
        "",
      ]),
      [F("キャリア志向", "挑戦したいこと")]: pick([
        "新規事業の立ち上げに関わりたい",
        "海外拠点との仕事に挑戦したい",
        "後輩の育成に力を入れたい",
        "専門性を深めて社外にも発信したい",
        "",
      ]),
      [F("キャリア志向", "転勤")]: pick(["可", "条件付きで可", "不可", "不可"]),
    });
  }
  // タレント評価（役職者ほど高め）
  const perfRoll = rand() + (m.jt <= 4 ? 0.25 : 0) - (isNew ? 0.1 : 0);
  const potRoll = rand() + (m.hire > `${thisYear - 5}-01-01` ? 0.15 : -0.05);
  const level = (r: number) => (r > 0.8 ? "高" : r > 0.35 ? "中" : "低");
  const perf = level(perfRoll);
  const pot = level(potRoll);
  talent.set(m.id, { perf, pot });
  if (m.status !== "retired") {
    record(4, m.id, {
      [F("タレント評価", "パフォーマンス")]: perf,
      [F("タレント評価", "ポテンシャル")]: pot,
      [F("タレント評価", "後継者候補")]: perf === "高" && pot === "高",
      [F("タレント評価", "離職リスク")]: pick(["低", "低", "低", "中", "中", "高"]),
      [F("タレント評価", "タレントメモ")]:
        perf === "高" ? "安定して成果を出している。次の役割を検討したい。" : "",
    });
  }
  const quals = sample(QUALIFICATIONS, chance(0.6) ? int(1, 3) : 0);
  quals.forEach(([name, org], i) => {
    record(
      5,
      m.id,
      {
        [F("資格・免許", "資格名")]: name,
        [F("資格・免許", "取得日")]: dateBetween(
          new Date(Date.UTC(Number(m.birth.slice(0, 4)) + 20, 0, 1)),
          TODAY,
        ),
        [F("資格・免許", "認定団体")]: org,
      },
      i,
    );
  });
  sample(TRAININGS, int(1, 4)).forEach((t, i) => {
    record(
      6,
      m.id,
      {
        [F("研修受講履歴", "研修名")]: t,
        [F("研修受講履歴", "受講日")]: dateBetween(new Date(`${m.hire}T00:00:00Z`), TODAY),
        [F("研修受講履歴", "区分")]:
          t.includes("研修") && !t.includes("英語") ? pick(["必須", "選択"]) : "外部",
        [F("研修受講履歴", "修了")]: chance(0.9),
      },
      i,
    );
  });
  if (m.status === "active") {
    record(7, m.id, {
      [F("勤務状況", "月平均残業時間")]: Math.round(rand() * (m.jt <= 4 ? 40 : 30) * 10) / 10,
      [F("勤務状況", "有給取得日数")]: int(2, 15),
      [F("勤務状況", "健康診断判定")]: pick(["A", "A", "A", "B", "B", "C", "D"]),
    });
  }
  if (m.status !== "retired" && chance(0.7)) {
    record(8, m.id, {
      [F("パーソナリティ", "性格タイプ（エニアグラム）")]: pick(ENNEAGRAM),
      [F("パーソナリティ", "強み")]: sample(STRENGTHS, int(1, 3)),
      [F("パーソナリティ", "仕事で大切にしていること")]: pick([
        "相手の立場で考えること",
        "約束した期日を守ること",
        "小さな改善を積み重ねること",
        "チームで成果を出すこと",
        "",
      ]),
    });
  }
}

// ───────── スキル ─────────
SKILLS.forEach((s, i) => {
  insert("skills", { id: i + 1, name: s.name, category: s.category });
});
const skillId = (name: string) => SKILLS.findIndex((s) => s.name === name) + 1;
for (const m of members) {
  const dName = depts[m.dept - 1]!.name;
  const parentName = depts[m.dept - 1]!.parent ? depts[depts[m.dept - 1]!.parent! - 1]!.name : "";
  const aff = DEPT_SKILL_AFFINITY.find(([re]) => re.test(dName) || re.test(parentName))?.[1] ?? [];
  const chosen = new Set<string>(sample(aff, Math.min(aff.length, int(2, 4))));
  for (const s of sample(SKILLS, int(1, 3))) chosen.add(s.name);
  if (m.jt <= 4) {
    chosen.add("ピープルマネジメント");
    if (chance(0.6)) chosen.add("コーチング");
  }
  const seniority = Math.min(2, (thisYear - Number(m.hire.slice(0, 4))) / 6);
  for (const name of chosen) {
    const base = aff.includes(name) ? 2.2 : 1.3;
    const level = Math.max(1, Math.min(5, Math.round(base + seniority + rand() * 1.6 - 0.5)));
    insert("member_skills", {
      member_id: m.id,
      skill_id: skillId(name),
      level,
      updated_at: sqlTs(int(1, 300)),
    });
  }
}

// ───────── ポジション ─────────
const positions = [
  {
    name: "テックリード",
    dept: PROD,
    mission: "プロダクトの技術的な意思決定をリードし、開発チームの生産性を高める",
    desc: "アーキテクチャ設計、コードレビュー、メンバーの技術的な育成を担う。",
    headcount: 2,
    reqs: [
      ["TypeScript", 4, 3],
      ["React", 4, 2],
      ["AWS", 3, 1],
      ["ピープルマネジメント", 2, 1],
    ],
  },
  {
    name: "SRE",
    dept: INFRA,
    mission: "サービスの信頼性を設計し、運用の自動化を進める",
    desc: "監視・障害対応の仕組みづくりと、インフラのコード化を担う。",
    headcount: 1,
    reqs: [
      ["AWS", 4, 3],
      ["Kubernetes", 3, 2],
      ["Go", 3, 1],
    ],
  },
  {
    name: "データアナリスト",
    dept: DATA,
    mission: "データに基づく意思決定を全社に広げる",
    desc: "KPI の設計、分析基盤の整備、各部署からの分析依頼への対応。",
    headcount: 2,
    reqs: [
      ["SQL", 4, 3],
      ["データ分析", 4, 3],
      ["Python", 3, 1],
    ],
  },
  {
    name: "エンタープライズ営業マネージャー",
    dept: EIGYO2,
    mission: "大手企業向けの営業組織を率いて売上を伸ばす",
    desc: "大型案件の提案・交渉と、チームメンバーの育成を担う。",
    headcount: 1,
    reqs: [
      ["法人営業", 4, 3],
      ["交渉", 4, 2],
      ["ピープルマネジメント", 3, 2],
      ["提案書作成", 3, 1],
    ],
  },
  {
    name: "採用担当（エンジニア採用）",
    dept: JINJI,
    mission: "開発組織の拡大を採用面から支える",
    desc: "採用計画の立案、候補者とのコミュニケーション、面接官トレーニング。",
    headcount: 1,
    reqs: [
      ["採用", 3, 3],
      ["プレゼンテーション", 3, 1],
      ["TypeScript", 1, 1],
    ],
  },
];
positions.forEach((p, i) => {
  insert("job_positions", {
    id: i + 1,
    name: p.name,
    department_id: p.dept,
    mission: p.mission,
    description: p.desc,
    headcount: p.headcount,
    status: i === 4 ? "closed" : "open",
  });
  for (const [s, min, w] of p.reqs as [string, number, number][]) {
    insert("job_position_requirements", {
      position_id: i + 1,
      skill_id: skillId(s),
      min_level: min,
      weight: w,
    });
  }
});

// ───────── 上長の解決 ─────────
function bossOf(m: Member): Member | null {
  let d: number | null = m.dept;
  // 自部署の長（自分自身なら親部署へ）
  while (d !== null) {
    const head: Member | undefined = heads[d] ?? divHeads[d] ?? (d === ROOT ? ceo : undefined);
    if (head && head.id !== m.id && head.status === "active") return head;
    d = depts[d - 1]!.parent;
  }
  return null;
}

// ───────── 評価 ─────────
insert("evaluation_templates", {
  id: 1,
  name: "総合評価（目標＋行動）",
  description: "期初に立てた目標の達成度と、行動指針に沿った行動を5段階で評価します。",
  scale_max: 5,
  goal_weight: 60,
  competency_weight: 40,
  rank_rules: [
    { rank: "S", min: 4.5 },
    { rank: "A", min: 3.75 },
    { rank: "B", min: 2.75 },
    { rank: "C", min: 1.75 },
    { rank: "D", min: 0 },
  ],
});
const items1 = ["主体性", "チームワーク", "顧客志向", "専門性の向上", "改善・創意工夫"];
const itemDesc: Record<string, string> = {
  主体性: "指示を待たず、自ら課題を見つけて行動したか",
  チームワーク: "周囲と協力し、チームの成果に貢献したか",
  顧客志向: "顧客や利用者の立場で考え、価値を届けたか",
  専門性の向上: "業務に必要な知識・技能を高めたか",
  "改善・創意工夫": "やり方を見直し、より良い方法を取り入れたか",
};
items1.forEach((t, i) => {
  insert("evaluation_template_items", {
    id: i + 1,
    template_id: 1,
    title: t,
    description: itemDesc[t],
    weight: 1,
    sort_order: i + 1,
  });
});
insert("evaluation_templates", {
  id: 2,
  name: "管理職評価",
  description: "組織成果と、マネジメント行動を評価します。",
  scale_max: 5,
  goal_weight: 50,
  competency_weight: 50,
  rank_rules: [
    { rank: "S", min: 4.5 },
    { rank: "A", min: 3.75 },
    { rank: "B", min: 2.75 },
    { rank: "C", min: 1.75 },
    { rank: "D", min: 0 },
  ],
});
["リーダーシップ", "部下育成", "戦略思考", "意思決定"].forEach((t, i) => {
  insert("evaluation_template_items", {
    id: 10 + i,
    template_id: 2,
    title: t,
    description: "",
    weight: i === 1 ? 2 : 1,
    sort_order: i + 1,
  });
});

const prevPeriodName = `${fiscalYear - 1}年度 下期`;
const curPeriodName = `${fiscalYear}年度 上期`;
insert("evaluation_periods", {
  id: 1,
  name: prevPeriodName,
  template_id: 1,
  start_date: `${fiscalYear - 1}-10-01`,
  end_date: `${fiscalYear}-03-31`,
  status: "closed",
  use_second_step: 1,
});
insert("evaluation_periods", {
  id: 2,
  name: curPeriodName,
  template_id: 1,
  start_date: `${fiscalYear}-04-01`,
  end_date: `${fiscalYear}-09-30`,
  status: "active",
  use_second_step: 1,
});

const GOAL_TITLES = [
  ["担当領域の売上目標を達成する", "四半期ごとの進捗を確認し、未達の場合は対策を立てる"],
  ["主要機能をリリースする", "品質基準を満たした状態で期日までにリリースする"],
  ["業務プロセスを改善し工数を削減する", "現状の作業時間を計測し、20%削減を目指す"],
  ["後輩の育成", "OJT 担当として週1回の振り返りを行う"],
  ["顧客満足度の向上", "アンケートのスコアを前期比で改善する"],
  ["新しい技術・知識の習得", "社内勉強会で1回以上発表する"],
  ["チーム横断のプロジェクトを推進する", "関係者を巻き込み、計画どおりに進める"],
];

let sheetSeq = 0;
let goalSeq = 0;
const PHASES = ["self", "first", "second", "final"] as const;
const stepOrder = ["goal", "self", "first", "second", "final", "done"];
const finalRanks = new Map<number, string>();

function evalSheet(periodId: number, m: Member, step: string) {
  sheetSeq++;
  const sid = sheetSeq;
  const first = bossOf(m);
  const second = first ? bossOf(first) : null;
  const goals = sample(GOAL_TITLES, int(2, 3));
  const weights = goals.length === 2 ? [60, 40] : [40, 30, 30];
  const goalIds: number[] = [];
  const talentInfo = talent.get(m.id);
  const bias = talentInfo?.perf === "高" ? 0.7 : talentInfo?.perf === "低" ? -0.7 : 0;
  // 目標
  const stepIdx = stepOrder.indexOf(step);
  if (stepIdx >= 1 || chance(0.5)) {
    goals.forEach(([title, desc], i) => {
      goalSeq++;
      goalIds.push(goalSeq);
      insert("evaluation_goals", {
        id: goalSeq,
        sheet_id: sid,
        title,
        description: desc,
        weight: weights[i],
        sort_order: i + 1,
      });
    });
  }
  // 完了済みフェーズのスコア
  let finalScore: number | null = null;
  const base = 3.3 + bias + (rand() - 0.5);
  for (const phase of PHASES) {
    const phaseIdx = stepOrder.indexOf(phase);
    if (phaseIdx >= stepIdx) break; // まだこのフェーズに到達していない
    const shift = phase === "self" ? 0.3 : 0;
    const scores: { w: number; s: number }[] = [];
    const goalScores: number[] = [];
    goalIds.forEach((gid, i) => {
      const s = Math.max(1, Math.min(5, Math.round(base + shift + (rand() - 0.5) * 1.4)));
      goalScores.push(s);
      scores.push({ w: weights[i]!, s });
      insert("evaluation_scores", {
        sheet_id: sid,
        phase,
        target_type: "goal",
        target_id: gid,
        score: s,
        comment:
          phase === "self"
            ? pick(["計画どおり進められた", "後半で巻き返した", "想定以上の成果が出た", "一部未達だった"])
            : "",
      });
    });
    const itemScores: number[] = [];
    items1.forEach((_, i) => {
      const s = Math.max(1, Math.min(5, Math.round(base + shift + (rand() - 0.5) * 1.6)));
      itemScores.push(s);
      insert("evaluation_scores", {
        sheet_id: sid,
        phase,
        target_type: "item",
        target_id: i + 1,
        score: s,
        comment: "",
      });
    });
    insert("evaluation_phase_comments", {
      sheet_id: sid,
      phase,
      comment:
        phase === "self"
          ? "今期は担当範囲が広がり、学びの多い半期でした。"
          : pick([
              "期待どおりの成果。次期はより広い範囲を任せたい。",
              "着実に成長している。",
              "周囲への良い影響が大きかった。",
            ]),
    });
    const gAvg = goalScores.length
      ? scores.reduce((a, b) => a + b.w * b.s, 0) / scores.reduce((a, b) => a + b.w, 0)
      : null;
    const iAvg = itemScores.reduce((a, b) => a + b, 0) / itemScores.length;
    const total = gAvg === null ? iAvg : (gAvg * 60 + iAvg * 40) / 100;
    if (phase === "final") finalScore = Math.round(total * 100) / 100;
  }
  let finalRank: string | null = null;
  if (finalScore !== null) {
    finalRank =
      finalScore >= 4.5
        ? "S"
        : finalScore >= 3.75
          ? "A"
          : finalScore >= 2.75
            ? "B"
            : finalScore >= 1.75
              ? "C"
              : "D";
    if (periodId === 1) finalRanks.set(m.id, finalRank);
  }
  insert("evaluation_sheets", {
    id: sid,
    period_id: periodId,
    member_id: m.id,
    first_evaluator_id: first?.id ?? null,
    second_evaluator_id: second?.id ?? null,
    step,
    final_score: finalScore,
    final_rank: finalRank,
    updated_at: sqlTs(int(1, 40)),
  });
  // 履歴
  for (let i = 0; i < stepIdx; i++) {
    insert("evaluation_events", {
      sheet_id: sid,
      action: "submit",
      from_step: stepOrder[i],
      to_step: stepOrder[i + 1],
      user_id: null,
      comment: "",
      created_at: sqlTs(60 - i * 8),
    });
  }
}

const activeMembers = members.filter((m) => m.status !== "retired" && m.jt !== JT.ceo);
for (const m of members.filter(
  (x) => x.jt !== JT.ceo && (x.status !== "retired" || (x.leave ?? "") > `${fiscalYear}-04-01`),
)) {
  evalSheet(1, m, "done");
}
for (const m of activeMembers) {
  if (m.status === "leave") continue;
  let step: string;
  if (m.id === demoMember.id) step = "self";
  else if (m.dept === PROD && m.jt === JT.staff && chance(0.6))
    step = "first"; // デモマネージャーの一次評価待ち
  else step = pick(["goal", "self", "self", "first", "first", "second", "final", "done", "done"]);
  evalSheet(2, m, step);
}

// ───────── アンケート ─────────
insert("surveys", {
  id: 1,
  title: `${thisYear}年${TODAY.getUTCMonth() + 1}月 パルスサーベイ`,
  description: "毎月のコンディション確認です。回答は匿名で集計され、個人が特定される形では共有されません。",
  kind: "pulse",
  anonymous: 1,
  status: "open",
  closes_at: addDays(todayStr, 10),
  created_by: 2,
  published_at: sqlTs(5),
});
const pulseQs: [string, string, string[]][] = [
  ["scale", "今の仕事にやりがいを感じていますか", []],
  ["scale", "上司と十分にコミュニケーションが取れていますか", []],
  ["scale", "心身ともに良いコンディションで働けていますか", []],
  ["nps", "この職場を親しい友人や知人に勧めたいと思いますか", []],
  ["text", "最近の困りごとや、会社に伝えたいことがあれば教えてください", []],
];
pulseQs.forEach(([type, text, options], i) => {
  insert("survey_questions", {
    id: i + 1,
    survey_id: 1,
    type,
    text,
    options,
    required: type === "text" ? 0 : 1,
    sort_order: i + 1,
  });
});
insert("surveys", {
  id: 2,
  title: "働き方に関するアンケート",
  description: "出社とリモートワークの組み合わせについて、今後の制度設計の参考にします。",
  kind: "survey",
  anonymous: 0,
  status: "closed",
  closes_at: addDays(todayStr, -20),
  created_by: 2,
  published_at: sqlTs(40),
});
const wsQs: [string, string, string[]][] = [
  ["single", "週あたりの出社日数として最も働きやすいのはどれですか", ["0日", "1日", "2日", "3日", "4日以上"]],
  [
    "multi",
    "リモートワークで困っていることを選んでください",
    ["雑談が減った", "相談しづらい", "自宅の作業環境", "運動不足", "特にない"],
  ],
  ["scale", "現在の働き方にどの程度満足していますか", []],
  ["text", "制度への要望があれば自由に書いてください", []],
];
wsQs.forEach(([type, text, options], i) => {
  insert("survey_questions", {
    id: 10 + i,
    survey_id: 2,
    type,
    text,
    options,
    required: type === "text" ? 0 : 1,
    sort_order: i + 1,
  });
});
insert("surveys", {
  id: 3,
  title: "年末イベントの企画アンケート",
  description: "年末の社内イベントの内容を決めるためのアンケートです。",
  kind: "survey",
  anonymous: 0,
  status: "draft",
  created_by: 2,
});
insert("survey_questions", {
  id: 20,
  survey_id: 3,
  type: "single",
  text: "参加したい企画はどれですか",
  options: ["立食パーティー", "スポーツ大会", "ボードゲーム大会", "オンライン企画"],
  required: 1,
  sort_order: 1,
});

let respSeq = 0;
const pulseTexts = [
  "会議が多く、集中する時間が取りにくい",
  "チームの雰囲気が良くなってきた",
  "評価の基準をもう少し明確にしてほしい",
  "新しいツールの導入で効率が上がった",
  "繁忙期の人員配置を見直してほしい",
];
const currentMembers = members.filter((m) => m.status !== "retired");
for (const m of currentMembers) {
  // パルス：デモ一般社員は未回答のまま
  const respondPulse = m.id !== demoMember.id && chance(0.68);
  insert("survey_targets", {
    survey_id: 1,
    member_id: m.id,
    responded_at: respondPulse ? sqlTs(int(0, 4)) : null,
  });
  if (respondPulse) {
    respSeq++;
    const t = talent.get(m.id);
    const mood = 3 + (t?.perf === "高" ? 0.5 : 0) + (rand() - 0.5) * 2.4;
    insert("survey_responses", {
      id: respSeq,
      survey_id: 1,
      member_id: null,
      department_id: m.dept,
      submitted_at: sqlTs(int(0, 4)),
    });
    [1, 2, 3].forEach((qid) => {
      insert("survey_answers", {
        response_id: respSeq,
        question_id: qid,
        value: Math.max(1, Math.min(5, Math.round(mood + (rand() - 0.5)))),
      });
    });
    insert("survey_answers", {
      response_id: respSeq,
      question_id: 4,
      value: Math.max(0, Math.min(10, Math.round(mood * 2 + (rand() - 0.3) * 3))),
    });
    if (chance(0.3))
      insert("survey_answers", { response_id: respSeq, question_id: 5, value: pick(pulseTexts) });
  }
  const respondWs = chance(0.82);
  insert("survey_targets", {
    survey_id: 2,
    member_id: m.id,
    responded_at: respondWs ? sqlTs(int(21, 35)) : null,
  });
  if (respondWs) {
    respSeq++;
    insert("survey_responses", {
      id: respSeq,
      survey_id: 2,
      member_id: m.id,
      department_id: m.dept,
      submitted_at: sqlTs(int(21, 35)),
    });
    insert("survey_answers", {
      response_id: respSeq,
      question_id: 10,
      value: pick(["0日", "1日", "2日", "2日", "3日", "3日", "4日以上"]),
    });
    insert("survey_answers", {
      response_id: respSeq,
      question_id: 11,
      value: sample(["雑談が減った", "相談しづらい", "自宅の作業環境", "運動不足"], int(0, 2)).concat(
        chance(0.2) ? ["特にない"] : [],
      ),
    });
    insert("survey_answers", { response_id: respSeq, question_id: 12, value: int(2, 5) });
    if (chance(0.25))
      insert("survey_answers", {
        response_id: respSeq,
        question_id: 13,
        value: pick([
          "出社日の調整をチーム単位でできるとよい",
          "在宅勤務手当を検討してほしい",
          "今のままで満足している",
        ]),
      });
  }
}

// ───────── 1on1 ─────────
for (const m of members.filter((x) => x.status === "active" && x.jt !== JT.ceo)) {
  const boss = bossOf(m);
  if (!boss) continue;
  const n = m.id === demoMember.id ? 4 : chance(0.55) ? int(1, 3) : 0;
  for (let i = 0; i < n; i++) {
    const held = addDays(todayStr, -(i * int(14, 30) + int(1, 10)));
    insert("one_on_ones", {
      member_id: m.id,
      interviewer_member_id: boss.id,
      held_on: held,
      title: pick(ONE_ON_ONE_TOPICS),
      notes: pick(ONE_ON_ONE_NOTES),
      next_actions: pick(ONE_ON_ONE_ACTIONS),
      condition: int(2, 5),
      shared_with_member: chance(0.85) ? 1 : 0,
      created_by: boss.id === demoManager.id ? 3 : null,
      created_at: `${held} 10:00:00`,
      updated_at: `${held} 10:30:00`,
    });
  }
}

// ───────── 配置シミュレーション ─────────
insert("placement_scenarios", {
  id: 1,
  name: `${thisYear + 1}年4月 組織改編案`,
  description: "開発本部の体制強化と、営業本部の東西バランスを見直す案。",
  status: "draft",
  effective_date: `${thisYear + 1}-04-01`,
  created_by: 2,
  created_at: sqlTs(12),
  updated_at: sqlTs(2),
});
const moveCandidates = sample(
  members.filter((m) => m.status === "active" && m.jt >= JT.leader),
  6,
);
const targetDepts = [PROD, INFRA, DATA, WEST, CS, DESIGN];
moveCandidates.forEach((m, i) => {
  const to = targetDepts[i]! === m.dept ? QA : targetDepts[i]!;
  insert("placement_moves", { scenario_id: 1, member_id: m.id, to_department_id: to, to_job_title_id: null });
});
insert("placement_scenarios", {
  id: 2,
  name: "新規事業チーム立ち上げ（検討用）",
  description: "データ分析部とプロダクト開発部から兼務メンバーを選ぶための叩き台。",
  status: "draft",
  created_by: 3,
  created_at: sqlTs(4),
  updated_at: sqlTs(4),
});

// ───────── お知らせ ─────────
insert("announcements", {
  title: `${curPeriodName}の評価を開始しました`,
  body: "各自の評価シートから自己評価を入力し、期日までに提出してください。評価者の方は、提出された評価シートの一次評価をお願いします。",
  pinned: 1,
  created_by: 2,
  published_at: sqlTs(9),
});
insert("announcements", {
  title: "パルスサーベイへの回答をお願いします",
  body: "今月のパルスサーベイを配信しました。所要時間は1分ほどです。回答は匿名で集計されます。",
  pinned: 0,
  created_by: 2,
  published_at: sqlTs(5),
});
insert("announcements", {
  title: "プロフィールの「自己紹介」を更新しましょう",
  body: "自己紹介シートは全社に公開されます。趣味や相談に乗れることを書いておくと、他部署の人とも話すきっかけになります。",
  pinned: 0,
  created_by: 1,
  published_at: sqlTs(20),
});

// ───────── 社員リスト ─────────
insert("member_lists", {
  id: 1,
  name: "次世代リーダー候補",
  description: "タレント評価でパフォーマンス・ポテンシャルともに高いメンバー",
  color: "yamabuki",
  owner_user_id: 2,
  shared: 0,
});
for (const m of members
  .filter((x) => talent.get(x.id)?.perf === "高" && talent.get(x.id)?.pot !== "低" && x.status === "active")
  .slice(0, 14)) {
  insert("member_list_items", { list_id: 1, member_id: m.id });
}
insert("member_lists", {
  id: 2,
  name: "社内勉強会スピーカー",
  description: "過去に社内勉強会で登壇したメンバー",
  color: "wakaba",
  owner_user_id: 3,
  shared: 1,
});
for (const m of sample(
  members.filter((x) => x.status === "active"),
  9,
)) {
  insert("member_list_items", { list_id: 2, member_id: m.id });
}

// ───────── チームキャンバス ─────────
{
  const pick3 = (deptId: number, n: number) =>
    sample(
      members.filter((m) => m.dept === deptId && m.status === "active"),
      n,
    );
  const teamA = [...pick3(PROD, 3), ...pick3(DESIGN, 1), ...pick3(DATA, 1)];
  const teamB = [...pick3(EIGYO2, 2), ...pick3(CS, 2), ...pick3(MKT1, 1)];
  const place = (list: Member[], gx: number, gy: number) =>
    list.map((m, i) => ({
      memberId: m.id,
      x: gx + 24 + (i % 3) * 112,
      y: gy + 56 + Math.floor(i / 3) * 128,
    }));
  insert("team_boards", {
    name: "新規事業プロジェクトの体制案",
    description: "プロダクトとセールスの混成チームを2つ立ち上げる案。",
    owner_user_id: 3,
    shared: 1,
    data: {
      items: [...place(teamA, 40, 40), ...place(teamB, 480, 40)],
      groups: [
        { id: "g1", label: "プロダクトチーム", x: 40, y: 40, w: 400, h: 340, color: "ai" },
        { id: "g2", label: "セールスチーム", x: 480, y: 40, w: 400, h: 340, color: "wakaba" },
      ],
      notes: [{ id: "n1", text: "リーダーは来週の面談で本人の意向を確認する", x: 920, y: 60 }],
    },
  });
}

// ───────── 申請 ─────────
const reqMembers = sample(
  members.filter((x) => x.status === "active" && x.id !== demoMember.id),
  3,
);
reqMembers.forEach((m, i) => {
  insert("change_requests", {
    member_id: m.id,
    requester_user_id: null,
    sheet_id: 2,
    payload: {
      [F("人事基本情報", "居住地（都道府県）")]: pick(PREFS),
      [F("人事基本情報", "通勤手段")]: ["電車"],
    },
    reason: "引っ越しのため",
    status: i === 2 ? "approved" : "pending",
    reviewer_user_id: i === 2 ? 2 : null,
    review_comment: i === 2 ? "確認しました" : "",
    created_at: sqlTs(int(1, 6)),
    reviewed_at: i === 2 ? sqlTs(1) : null,
  });
});

// ───────── 分析（保存グラフ・ダッシュボード） ─────────
const charts = [
  { name: "部署別人数", config: { dimension: "division", type: "bar", series: null } },
  { name: "年齢構成（男女別）", config: { dimension: "ageBand", type: "stacked", series: "gender" } },
  { name: "等級分布", config: { dimension: "grade", type: "column", series: null } },
  { name: "雇用形態の内訳", config: { dimension: "employmentType", type: "donut", series: null } },
  {
    name: "前期評価ランク分布",
    config: { dimension: "evalRank", type: "column", series: null, evalPeriodId: 1 },
  },
];
charts.forEach((ch, i) => {
  insert("saved_charts", { id: i + 1, name: ch.name, config: ch.config, owner_user_id: 2, shared: 1 });
});
for (const uid of [1, 2, 3]) {
  const panels: [string, unknown, number][] = [
    ["metric", { metric: "headcount" }, 1],
    ["metric", { metric: "averageAge" }, 1],
    ["metric", { metric: "averageTenure" }, 1],
    ["metric", { metric: "femaleManagerRatio" }, 1],
    ["metric", { metric: "turnoverRate" }, 1],
    ["metric", { metric: "surveyResponseRate" }, 1],
    ["chart", { chartId: 1 }, 2],
    ["chart", { chartId: 2 }, 2],
    ["chart", { chartId: 4 }, 1],
    ["chart", { chartId: 5 }, 1],
  ];
  panels.forEach(([kind, config, width], i) => {
    insert("dashboard_panels", { user_id: uid, kind, config, width, sort_order: i + 1 });
  });
}

// ───────── 操作ログ ─────────
const logSamples: [number, string, string, string][] = [
  [2, "member.update", "社員情報を更新しました", "member"],
  [2, "evaluation.period.create", `評価期間「${curPeriodName}」を作成しました`, "evaluation_period"],
  [2, "survey.publish", "アンケートを配信しました", "survey"],
  [1, "sheet.update", "シート「タレント評価」の項目を変更しました", "sheet"],
  [3, "placement.create", "配置シミュレーションを作成しました", "placement"],
];
logSamples.forEach(([uid, action, summary, type], i) => {
  const u = users.find((x) => x.id === uid)!;
  insert("audit_logs", {
    user_id: uid,
    user_name: `${u.m.last[0]} ${u.m.first[0]}`,
    action,
    target_type: type,
    summary,
    created_at: sqlTs(20 - i * 3),
  });
});

// ───────── 出力 ─────────
const out = resolve(process.argv[2] ?? new URL("../seed/seed.sql", import.meta.url).pathname);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(
  `seed: ${members.length} members, ${depts.length} departments, ${lines.length} statements -> ${out}\n` +
    `demo users: admin/hr/manager/member@example.com (password: ${DEMO_PASSWORD})`,
);
