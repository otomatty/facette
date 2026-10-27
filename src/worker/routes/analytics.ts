import { Hono } from "hono";
import { z } from "zod";
import { GENDER_LABELS, MEMBER_STATUS_LABELS } from "../../shared/constants";
import { ageOn, tenureYears, todayJst } from "../../shared/dates";
import type {
  ChartConfig,
  ChartData,
  ChartDimension,
  DashboardPanel,
  FieldValue,
  Metric,
  MetricKey,
  SavedChart,
  Sheet,
} from "../../shared/types";
import {
  type AppContext,
  type AppEnv,
  type AuthContext,
  auth,
  badRequest,
  type DeptRow,
  forbid,
  loadDepartments,
  memberInScope,
  notFound,
  parseId,
  requireAuth,
  requireCap,
  subtreeIds,
} from "../lib/context";
import { all, type Bindable, first, insert, parseJson, placeholders, reorderRows, run } from "../lib/db";
import { MEMBER_SELECT, type MemberRow, toSummary } from "../lib/members";
import { loadSheets, sheetAccess, sheetVisibility } from "../lib/sheets";
import { validate } from "../lib/validate";

// ───────── 軸の定義 ─────────
const AGE_BANDS = [
  "〜24歳",
  "25〜29歳",
  "30〜34歳",
  "35〜39歳",
  "40〜44歳",
  "45〜49歳",
  "50〜54歳",
  "55〜59歳",
  "60歳〜",
];
const TENURE_BANDS = ["1年未満", "1〜3年", "3〜5年", "5〜10年", "10〜15年", "15〜20年", "20年以上"];

function ageBand(age: number | null): string | null {
  if (age === null) return null;
  if (age < 25) return AGE_BANDS[0]!;
  if (age >= 60) return AGE_BANDS[8]!;
  return AGE_BANDS[Math.floor((age - 25) / 5) + 1]!;
}

function tenureBand(t: number | null): string | null {
  if (t === null) return null;
  if (t < 1) return TENURE_BANDS[0]!;
  if (t < 3) return TENURE_BANDS[1]!;
  if (t < 5) return TENURE_BANDS[2]!;
  if (t < 10) return TENURE_BANDS[3]!;
  if (t < 15) return TENURE_BANDS[4]!;
  if (t < 20) return TENURE_BANDS[5]!;
  return TENURE_BANDS[6]!;
}

const BASE_DIMENSIONS: { key: ChartDimension; label: string; sensitive: boolean }[] = [
  { key: "division", label: "本部", sensitive: false },
  { key: "department", label: "部署", sensitive: false },
  { key: "jobTitle", label: "役職", sensitive: false },
  { key: "grade", label: "等級", sensitive: true },
  { key: "employmentType", label: "雇用形態", sensitive: true },
  { key: "gender", label: "性別", sensitive: true },
  { key: "ageBand", label: "年齢（5歳刻み）", sensitive: true },
  { key: "tenureBand", label: "勤続年数", sensitive: false },
  { key: "hireYear", label: "入社年", sensitive: false },
  { key: "workLocation", label: "勤務地", sensitive: false },
  { key: "status", label: "在籍状況", sensitive: false },
  { key: "evalRank", label: "評価ランク", sensitive: true },
];

type Ctx = {
  depts: DeptRow[];
  divisionOf: Map<number, DeptRow>;
  sheets: Sheet[];
  records: Map<string, Record<string, FieldValue>>; // `${sheetId}:${memberId}`
  evalRanks: Map<number, string>;
  masters: {
    jobTitles: { id: number; name: string; rank: number }[];
    grades: { id: number; name: string; rank: number }[];
    ets: { id: number; name: string }[];
  };
  today: string;
};

function divisionMap(depts: DeptRow[]): Map<number, DeptRow> {
  const byId = new Map(depts.map((d) => [d.id, d]));
  const root = depts.find((d) => d.parent_id === null);
  const out = new Map<number, DeptRow>();
  for (const d of depts) {
    let cur: DeptRow | undefined = d;
    while (cur && cur.parent_id !== null && cur.parent_id !== root?.id) cur = byId.get(cur.parent_id);
    if (cur && cur.parent_id === root?.id) out.set(d.id, cur);
    else if (cur && cur.id === root?.id) out.set(d.id, cur);
  }
  return out;
}

function dimensionValues(dim: ChartDimension, m: MemberRow, ctx: Ctx): string[] {
  switch (dim) {
    case "department":
      return [m.department_name ?? "所属なし"];
    case "division":
      return [
        m.department_id !== null ? (ctx.divisionOf.get(m.department_id)?.name ?? "所属なし") : "所属なし",
      ];
    case "jobTitle":
      return [m.job_title_name ?? "未設定"];
    case "grade":
      return [m.grade_name ?? "未設定"];
    case "employmentType":
      return [m.employment_type_name ?? "未設定"];
    case "gender":
      return [GENDER_LABELS[m.gender]];
    case "ageBand":
      return [ageBand(ageOn(m.birth_date, ctx.today)) ?? "不明"];
    case "tenureBand":
      return [tenureBand(tenureYears(m.hire_date, ctx.today)) ?? "不明"];
    case "hireYear":
      return [m.hire_date ? `${m.hire_date.slice(0, 4)}年` : "不明"];
    case "workLocation":
      return [m.work_location ?? "未設定"];
    case "status":
      return [MEMBER_STATUS_LABELS[m.status]];
    case "evalRank":
      return [ctx.evalRanks.get(m.id) ?? "評価なし"];
    default: {
      const fieldId = Number(dim.slice(6));
      const sheet = ctx.sheets.find((s) => s.fields.some((f) => f.id === fieldId));
      const field = sheet?.fields.find((f) => f.id === fieldId);
      if (!sheet || !field) return ["不明"];
      const v = ctx.records.get(`${sheet.id}:${m.id}`)?.[String(fieldId)];
      if (field.type === "checkbox") return [v ? "はい" : "いいえ"];
      if (Array.isArray(v)) return v.length ? v.map(String) : ["未回答"];
      if (v === null || v === undefined || v === "") return ["未回答"];
      return [String(v)];
    }
  }
}

function labelOrder(dim: ChartDimension, ctx: Ctx, labels: Set<string>): string[] {
  let order: string[] = [];
  switch (dim) {
    case "department":
      order = ctx.depts.map((d) => d.name);
      break;
    case "division":
      order = ctx.depts
        .filter((d) => [...ctx.divisionOf.values()].some((x) => x.id === d.id))
        .map((d) => d.name);
      break;
    case "jobTitle":
      order = [...ctx.masters.jobTitles].sort((a, b) => b.rank - a.rank).map((j) => j.name);
      break;
    case "grade":
      order = [...ctx.masters.grades].sort((a, b) => b.rank - a.rank).map((g) => g.name);
      break;
    case "employmentType":
      order = ctx.masters.ets.map((e) => e.name);
      break;
    case "gender":
      order = Object.values(GENDER_LABELS);
      break;
    case "ageBand":
      order = [...AGE_BANDS, "不明"];
      break;
    case "tenureBand":
      order = [...TENURE_BANDS, "不明"];
      break;
    case "hireYear":
      order = [...labels].sort();
      break;
    case "status":
      order = Object.values(MEMBER_STATUS_LABELS);
      break;
    case "evalRank":
      order = ["S", "A", "B", "C", "D", "評価なし"];
      break;
    default: {
      if (dim.startsWith("field:")) {
        const fieldId = Number(dim.slice(6));
        const field = ctx.sheets.flatMap((s) => s.fields).find((f) => f.id === fieldId);
        if (field?.type === "checkbox") order = ["はい", "いいえ"];
        else order = [...(field?.options ?? []), "未回答"];
      }
    }
  }
  const known = order.filter((l) => labels.has(l));
  const rest = [...labels].filter((l) => !order.includes(l)).sort((a, b) => a.localeCompare(b, "ja"));
  return [
    ...known,
    ...rest.filter((l) => l !== "未設定" && l !== "所属なし"),
    ...rest.filter((l) => l === "未設定" || l === "所属なし"),
  ];
}

/** 閲覧者が扱える軸かを確認 */
function checkDimension(a: AuthContext, dim: ChartDimension, sheets: Sheet[]) {
  const base = BASE_DIMENSIONS.find((d) => d.key === dim);
  if (base) return;
  if (!dim.startsWith("field:")) badRequest("集計軸が正しくありません");
  const fieldId = Number(dim.slice(6));
  const sheet = sheets.find((s) => s.fields.some((f) => f.id === fieldId));
  const field = sheet?.fields.find((f) => f.id === fieldId);
  if (!sheet || !field) badRequest("集計軸の項目が見つかりません");
  if (sheet.kind !== "single") badRequest("複数レコードのシートは集計軸に使えません");
  if (!["select", "multiselect", "checkbox"].includes(field.type))
    badRequest("選択式・チェックの項目のみ集計軸に使えます");
  if (sheetVisibility(a, sheet) === "none") forbid("この項目を集計する権限がありません");
}

async function buildCtx(
  c: AppContext,
  a: AuthContext,
  dims: ChartDimension[],
  members: MemberRow[],
  evalPeriodId?: number | null,
): Promise<Ctx> {
  const db = c.env.DB;
  const depts = await loadDepartments(c);
  const sheets = await loadSheets(db);
  const records = new Map<string, Record<string, FieldValue>>();
  const fieldSheets = new Set<number>();
  for (const d of dims) {
    if (!d.startsWith("field:")) continue;
    const s = sheets.find((x) => x.fields.some((f) => f.id === Number(d.slice(6))));
    if (s) fieldSheets.add(s.id);
  }
  if (fieldSheets.size) {
    const recs = await all<{ sheet_id: number; member_id: number; data: string }>(
      db,
      `SELECT sheet_id, member_id, data FROM sheet_records WHERE sheet_id IN (${placeholders(fieldSheets.size)})`,
      ...fieldSheets,
    );
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const r of recs) {
      const s = sheets.find((x) => x.id === r.sheet_id)!;
      const m = byId.get(r.member_id);
      // 個々の社員について閲覧権限がない値は集計に含めない
      if (!m || sheetAccess(a, s, m) === "none") continue;
      records.set(`${r.sheet_id}:${r.member_id}`, parseJson(r.data, {}));
    }
  }
  const evalRanks = new Map<number, string>();
  if (dims.includes("evalRank")) {
    let pid = evalPeriodId ?? null;
    if (!pid) {
      const latest = await first<{ id: number }>(
        db,
        "SELECT id FROM evaluation_periods WHERE status = 'closed' ORDER BY end_date DESC LIMIT 1",
      );
      pid = latest?.id ?? null;
    }
    if (pid) {
      const rows = await all<{ member_id: number; final_rank: string | null }>(
        db,
        "SELECT member_id, final_rank FROM evaluation_sheets WHERE period_id = ? AND step = 'done'",
        pid,
      );
      for (const r of rows) if (r.final_rank) evalRanks.set(r.member_id, r.final_rank);
    }
  }
  const [jobTitles, grades, ets] = await Promise.all([
    all<{ id: number; name: string; rank: number }>(db, "SELECT id, name, rank FROM job_titles"),
    all<{ id: number; name: string; rank: number }>(db, "SELECT id, name, rank FROM grades"),
    all<{ id: number; name: string }>(db, "SELECT id, name FROM employment_types ORDER BY sort_order"),
  ]);
  return {
    depts,
    divisionOf: divisionMap(depts),
    sheets,
    records,
    evalRanks,
    masters: { jobTitles, grades, ets },
    today: todayJst(),
  };
}

/** 集計対象の社員（閲覧者の管轄範囲内） */
async function scopedMembers(
  c: AppContext,
  a: AuthContext,
  filters: ChartConfig["filters"] = {},
): Promise<MemberRow[]> {
  const where: string[] = [];
  const params: Bindable[] = [];
  const status = filters.status ?? "current";
  if (status === "current") where.push("m.status IN ('active', 'leave')");
  else if (status !== "all") {
    where.push("m.status = ?");
    params.push(status);
  }
  if (filters.departmentId) {
    const ids =
      filters.includeSub === false
        ? [filters.departmentId]
        : subtreeIds(await loadDepartments(c), filters.departmentId);
    where.push("m.department_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(ids));
  }
  const rows = await all<MemberRow>(
    c.env.DB,
    `${MEMBER_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    ...params,
  );
  return a.scope.all ? rows : rows.filter((r) => memberInScope(a, r));
}

export async function computeChart(c: AppContext, a: AuthContext, config: ChartConfig): Promise<ChartData> {
  const sheets = await loadSheets(c.env.DB);
  checkDimension(a, config.dimension, sheets);
  if (config.series) checkDimension(a, config.series, sheets);
  const members = await scopedMembers(c, a, config.filters);
  const dims = [config.dimension, ...(config.series ? [config.series] : [])];
  const ctx = await buildCtx(c, a, dims, members, config.evalPeriodId);
  const counts = new Map<string, Map<string, number>>();
  const xLabels = new Set<string>();
  const sLabels = new Set<string>();
  for (const m of members) {
    const xs = dimensionValues(config.dimension, m, ctx);
    const ss = config.series ? dimensionValues(config.series, m, ctx) : ["人数"];
    for (const x of xs) {
      xLabels.add(x);
      for (const s of ss) {
        sLabels.add(s);
        const row = counts.get(x) ?? new Map<string, number>();
        row.set(s, (row.get(s) ?? 0) + 1);
        counts.set(x, row);
      }
    }
  }
  const labels = labelOrder(config.dimension, ctx, xLabels);
  const seriesNames = config.series ? labelOrder(config.series, ctx, sLabels) : ["人数"];
  return {
    labels,
    series: seriesNames.map((s) => ({ name: s, values: labels.map((l) => counts.get(l)?.get(s) ?? 0) })),
    total: members.length,
  };
}

// ───────── 指標 ─────────
const METRIC_DEFS: Record<MetricKey, { label: string; unit: string; note: string }> = {
  headcount: { label: "従業員数", unit: "名", note: "在籍・休職者の合計" },
  averageAge: { label: "平均年齢", unit: "歳", note: "在籍・休職者" },
  averageTenure: { label: "平均勤続年数", unit: "年", note: "在籍・休職者" },
  femaleRatio: { label: "女性比率", unit: "%", note: "在籍・休職者に占める女性" },
  femaleManagerRatio: {
    label: "女性管理職比率",
    unit: "%",
    note: "管理職（役職に管理職フラグ）に占める女性",
  },
  managerRatio: { label: "管理職比率", unit: "%", note: "在籍者に占める管理職" },
  turnoverRate: { label: "離職率（12か月）", unit: "%", note: "直近12か月の退職者 ÷（現従業員数＋退職者）" },
  hiresThisYear: { label: "今年度の入社", unit: "名", note: "4月始まりの年度" },
  leaveCount: { label: "休職者", unit: "名", note: "" },
  surveyResponseRate: { label: "サーベイ回答率", unit: "%", note: "直近に配信したパルスサーベイ" },
};

export async function computeMetrics(c: AppContext, a: AuthContext, keys?: MetricKey[]): Promise<Metric[]> {
  const today = todayJst();
  const all_ = await scopedMembers(c, a, { status: "all" });
  const current = all_.filter((m) => m.status !== "retired");
  const managers = await all<{ id: number }>(c.env.DB, "SELECT id FROM job_titles WHERE is_manager = 1");
  const mgrIds = new Set(managers.map((m) => m.id));
  const mgrs = current.filter((m) => m.job_title_id !== null && mgrIds.has(m.job_title_id));
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const retired12 = all_.filter(
    (m) => m.status === "retired" && m.leave_date && m.leave_date >= yearAgo,
  ).length;
  const month = Number(today.slice(5, 7));
  const fyStart = `${month >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  };
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  let surveyRate: number | null = null;
  const pulse = await first<{ id: number }>(
    c.env.DB,
    "SELECT id FROM surveys WHERE kind = 'pulse' AND status <> 'draft' ORDER BY published_at DESC LIMIT 1",
  );
  if (pulse) {
    const t = await all<{ member_id: number; responded_at: string | null }>(
      c.env.DB,
      "SELECT member_id, responded_at FROM survey_targets WHERE survey_id = ?",
      pulse.id,
    );
    const ids = new Set(current.map((m) => m.id));
    const scoped = t.filter((x) => ids.has(x.member_id));
    surveyRate = pct(scoped.filter((x) => x.responded_at).length, scoped.length);
  }
  const values: Record<MetricKey, number | null> = {
    headcount: current.length,
    averageAge: avg(current.map((m) => ageOn(m.birth_date, today))),
    averageTenure: avg(current.map((m) => tenureYears(m.hire_date, today))),
    femaleRatio: pct(current.filter((m) => m.gender === "female").length, current.length),
    femaleManagerRatio: pct(mgrs.filter((m) => m.gender === "female").length, mgrs.length),
    managerRatio: pct(mgrs.length, current.length),
    turnoverRate: pct(retired12, current.length + retired12),
    hiresThisYear: current.filter((m) => m.hire_date && m.hire_date >= fyStart && m.hire_date <= today)
      .length,
    leaveCount: current.filter((m) => m.status === "leave").length,
    surveyResponseRate: surveyRate,
  };
  const list = keys ?? (Object.keys(METRIC_DEFS) as MetricKey[]);
  return list.map((k) => ({ key: k, ...METRIC_DEFS[k], value: values[k] }));
}

// ───────── スキーマ ─────────
const dimensionSchema = z
  .string()
  .regex(
    /^(division|department|jobTitle|grade|employmentType|gender|ageBand|tenureBand|hireYear|workLocation|status|evalRank|field:\d+)$/,
  ) as unknown as z.ZodType<ChartDimension>;
const chartConfigSchema = z.object({
  dimension: dimensionSchema,
  series: dimensionSchema.nullable().optional(),
  type: z.enum(["bar", "column", "donut", "stacked"]),
  filters: z
    .object({
      departmentId: z.number().int().positive().optional(),
      includeSub: z.boolean().optional(),
      status: z.enum(["active", "leave", "retired", "all", "current"]).optional(),
    })
    .optional(),
  evalPeriodId: z.number().int().positive().nullable().optional(),
}) as unknown as z.ZodType<ChartConfig>;

type ChartRow = {
  id: number;
  name: string;
  config: string;
  owner_user_id: number;
  shared: number;
  owner_name: string;
  updated_at: string;
};

function toSaved(a: AuthContext, r: ChartRow): SavedChart {
  return {
    id: r.id,
    name: r.name,
    config: parseJson<ChartConfig>(r.config, { dimension: "department", type: "bar" }),
    shared: r.shared === 1,
    isOwner: r.owner_user_id === a.user.id || a.user.role === "admin",
    ownerName: r.owner_name,
    updatedAt: r.updated_at,
  };
}

async function loadSavedChart(c: AppContext, a: AuthContext, id: number): Promise<SavedChart> {
  const r = await first<ChartRow>(
    c.env.DB,
    "SELECT sc.*, u.display_name AS owner_name FROM saved_charts sc JOIN users u ON u.id = sc.owner_user_id WHERE sc.id = ?",
    id,
  );
  if (!r || (r.owner_user_id !== a.user.id && r.shared !== 1)) notFound("グラフが見つかりません");
  return toSaved(a, r);
}

export const analyticsRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("viewAnalytics"))
  .get("/dimensions", async (c) => {
    const a = auth(c);
    const sheets = await loadSheets(c.env.DB);
    const fields = sheets
      .filter((s) => s.kind === "single" && sheetVisibility(a, s) !== "none")
      .flatMap((s) =>
        s.fields
          .filter((f) => ["select", "multiselect", "checkbox"].includes(f.type))
          .map((f) => ({
            key: `field:${f.id}` as ChartDimension,
            label: `${s.name}：${f.label}`,
            sheetId: s.id,
            fieldId: f.id,
            options: f.type === "checkbox" ? ["はい", "いいえ"] : f.options,
          })),
      );
    return c.json({
      base: BASE_DIMENSIONS.map(({ key, label }) => ({ key, label })),
      fields,
    });
  })
  .post("/chart", validate("json", chartConfigSchema), async (c) => {
    const a = auth(c);
    return c.json(await computeChart(c, a, c.req.valid("json")));
  })
  .get("/metrics", async (c) => {
    const a = auth(c);
    return c.json({ items: await computeMetrics(c, a) });
  })
  .get("/charts", async (c) => {
    const a = auth(c);
    const rows = await all<ChartRow>(
      c.env.DB,
      `SELECT sc.*, u.display_name AS owner_name FROM saved_charts sc JOIN users u ON u.id = sc.owner_user_id
        WHERE sc.owner_user_id = ? OR sc.shared = 1 ORDER BY sc.updated_at DESC`,
      a.user.id,
    );
    return c.json({ items: rows.map((r) => toSaved(a, r)) });
  })
  .post(
    "/charts",
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1, "グラフ名を入力してください").max(60),
        config: chartConfigSchema,
        shared: z.boolean().default(false),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const v = c.req.valid("json");
      const id = await insert(
        c.env.DB,
        "INSERT INTO saved_charts (name, config, owner_user_id, shared) VALUES (?, ?, ?, ?)",
        v.name,
        JSON.stringify(v.config),
        a.user.id,
        v.shared,
      );
      return c.json({ id }, 201);
    },
  )
  .patch(
    "/charts/:id",
    validate(
      "json",
      z.object({ name: z.string().trim().min(1).max(60), config: chartConfigSchema, shared: z.boolean() }),
    ),
    async (c) => {
      const a = auth(c);
      const chart = await loadSavedChart(c, a, parseId(c.req.param("id")));
      if (!chart.isOwner) forbid("グラフを編集できるのは作成者のみです");
      const v = c.req.valid("json");
      await run(
        c.env.DB,
        "UPDATE saved_charts SET name = ?, config = ?, shared = ?, updated_at = datetime('now') WHERE id = ?",
        v.name,
        JSON.stringify(v.config),
        v.shared,
        chart.id,
      );
      return c.json({ ok: true });
    },
  )
  .delete("/charts/:id", async (c) => {
    const a = auth(c);
    const chart = await loadSavedChart(c, a, parseId(c.req.param("id")));
    if (!chart.isOwner) forbid("グラフを削除できるのは作成者のみです");
    await run(c.env.DB, "DELETE FROM saved_charts WHERE id = ?", chart.id);
    await run(
      c.env.DB,
      "DELETE FROM dashboard_panels WHERE kind = 'chart' AND json_extract(config, '$.chartId') = ?",
      chart.id,
    );
    return c.json({ ok: true });
  })
  // 配置バランス図
  .get(
    "/balance",
    validate(
      "query",
      z.object({
        x: dimensionSchema,
        y: dimensionSchema,
        departmentId: z.coerce.number().int().positive().optional(),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const q = c.req.valid("query");
      const sheets = await loadSheets(c.env.DB);
      checkDimension(a, q.x, sheets);
      checkDimension(a, q.y, sheets);
      const members = await scopedMembers(c, a, { departmentId: q.departmentId, status: "active" });
      const ctx = await buildCtx(c, a, [q.x, q.y], members);
      const cells = new Map<string, number[]>();
      const xs = new Set<string>();
      const ys = new Set<string>();
      for (const m of members) {
        const x = dimensionValues(q.x, m, ctx)[0]!;
        const y = dimensionValues(q.y, m, ctx)[0]!;
        xs.add(x);
        ys.add(y);
        const key = `${x}\u0000${y}`;
        cells.set(key, [...(cells.get(key) ?? []), m.id]);
      }
      // 選択肢がある軸は空の区分も表示する
      const withOptions = (dim: ChartDimension, set: Set<string>) => {
        if (dim.startsWith("field:")) {
          const f = sheets.flatMap((s) => s.fields).find((x) => x.id === Number(dim.slice(6)));
          if (f?.type === "select") for (const o of f.options) set.add(o);
          if (f?.type === "checkbox") for (const o of ["はい", "いいえ"]) set.add(o);
        }
        if (dim === "evalRank") for (const o of ["S", "A", "B", "C", "D"]) set.add(o);
        return labelOrder(dim, ctx, set);
      };
      const editable = (dim: ChartDimension) => {
        if (!dim.startsWith("field:")) return null;
        const fieldId = Number(dim.slice(6));
        const sheet = sheets.find((s) => s.fields.some((f) => f.id === fieldId));
        const field = sheet?.fields.find((f) => f.id === fieldId);
        if (!sheet || !field || (field.type !== "select" && field.type !== "checkbox")) return null;
        return { sheetId: sheet.id, fieldId, type: field.type };
      };
      return c.json({
        xLabels: withOptions(q.x, xs),
        yLabels: withOptions(q.y, ys),
        cells: [...cells.entries()].map(([k, ids]) => {
          const [x, y] = k.split("\u0000");
          return { x, y, memberIds: ids };
        }),
        members: members.map((m) => toSummary(a, m)),
        // メンバーごとに軸の値を変更できるか（ドラッグで更新）
        editableX: editable(q.x),
        editableY: editable(q.y),
        editableMemberIds: members
          .filter((m) => {
            const ex = editable(q.x);
            const ey = editable(q.y);
            const chk = (e: ReturnType<typeof editable>) => {
              if (!e) return true;
              const s = sheets.find((x) => x.id === e.sheetId)!;
              return sheetAccess(a, s, m) === "edit";
            };
            return (ex || ey) && chk(ex) && chk(ey);
          })
          .map((m) => m.id),
      });
    },
  );

// ───────── ダッシュボード ─────────
const panelConfig = z.object({
  metric: z
    .enum([
      "headcount",
      "averageAge",
      "averageTenure",
      "femaleRatio",
      "femaleManagerRatio",
      "managerRatio",
      "turnoverRate",
      "hiresThisYear",
      "leaveCount",
      "surveyResponseRate",
    ])
    .optional(),
  chartId: z.number().int().positive().optional(),
  title: z.string().max(60).optional(),
});

export const dashboardRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("viewAnalytics"))
  .get("/", async (c) => {
    const a = auth(c);
    const rows = await all<{
      id: number;
      kind: "metric" | "chart";
      config: string;
      width: 1 | 2;
      sort_order: number;
    }>(c.env.DB, "SELECT * FROM dashboard_panels WHERE user_id = ? ORDER BY sort_order, id", a.user.id);
    const panels: (DashboardPanel & {
      metric?: Metric;
      chart?: SavedChart;
      data?: ChartData;
      error?: string;
    })[] = [];
    const metricKeys = rows
      .filter((r) => r.kind === "metric")
      .map((r) => parseJson<{ metric?: MetricKey }>(r.config, {}).metric)
      .filter((k): k is MetricKey => !!k);
    const metrics = metricKeys.length ? await computeMetrics(c, a, [...new Set(metricKeys)]) : [];
    for (const r of rows) {
      const config = parseJson<DashboardPanel["config"]>(r.config, {});
      const base: DashboardPanel = {
        id: r.id,
        kind: r.kind,
        config,
        width: r.width,
        sortOrder: r.sort_order,
      };
      if (r.kind === "metric") {
        panels.push({ ...base, metric: metrics.find((m) => m.key === config.metric) });
      } else if (config.chartId) {
        try {
          const chart = await loadSavedChart(c, a, config.chartId);
          panels.push({ ...base, chart, data: await computeChart(c, a, chart.config) });
        } catch (e) {
          panels.push({ ...base, error: e instanceof Error ? e.message : "グラフを表示できません" });
        }
      }
    }
    return c.json({ panels });
  })
  .post(
    "/panels",
    validate(
      "json",
      z.object({
        kind: z.enum(["metric", "chart"]),
        config: panelConfig,
        width: z.union([z.literal(1), z.literal(2)]).default(1),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const v = c.req.valid("json");
      if (v.kind === "metric" && !v.config.metric) badRequest("指標を選んでください");
      if (v.kind === "chart") {
        if (!v.config.chartId) badRequest("グラフを選んでください");
        await loadSavedChart(c, a, v.config.chartId);
      }
      const max = await first<{ n: number | null }>(
        c.env.DB,
        "SELECT max(sort_order) AS n FROM dashboard_panels WHERE user_id = ?",
        a.user.id,
      );
      const id = await insert(
        c.env.DB,
        "INSERT INTO dashboard_panels (user_id, kind, config, width, sort_order) VALUES (?, ?, ?, ?, ?)",
        a.user.id,
        v.kind,
        JSON.stringify(v.config),
        v.width,
        (max?.n ?? 0) + 1,
      );
      return c.json({ id }, 201);
    },
  )
  .patch(
    "/panels/:id",
    validate("json", z.object({ width: z.union([z.literal(1), z.literal(2)]) })),
    async (c) => {
      const a = auth(c);
      await run(
        c.env.DB,
        "UPDATE dashboard_panels SET width = ? WHERE id = ? AND user_id = ?",
        c.req.valid("json").width,
        parseId(c.req.param("id")),
        a.user.id,
      );
      return c.json({ ok: true });
    },
  )
  .delete("/panels/:id", async (c) => {
    const a = auth(c);
    await run(
      c.env.DB,
      "DELETE FROM dashboard_panels WHERE id = ? AND user_id = ?",
      parseId(c.req.param("id")),
      a.user.id,
    );
    return c.json({ ok: true });
  })
  .post(
    "/reorder",
    validate("json", z.object({ ids: z.array(z.number().int().positive()).max(100) })),
    async (c) => {
      const a = auth(c);
      const { ids } = c.req.valid("json");
      await reorderRows(c.env.DB, "dashboard_panels", ids, { column: "user_id", value: a.user.id });
      return c.json({ ok: true });
    },
  );
