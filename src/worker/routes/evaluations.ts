import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_RANK_RULES, EVAL_STEP_LABELS, type EvalPhase, type EvalStep } from "../../shared/constants";
import { toCsv } from "../../shared/csv";
import { isIsoDate } from "../../shared/dates";
import {
  nextStep,
  phaseOfStep,
  previousStep,
  rankFor,
  totalScore,
  validateGoalWeights,
} from "../../shared/evaluation";
import type {
  EvaluationPeriod,
  EvaluationScoreEntry,
  EvaluationSheetDetail,
  EvaluationSheetSummary,
  EvaluationTemplate,
} from "../../shared/types";
import { audit } from "../lib/audit";
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
import { all, type Bindable, batchAtomic, first, insert, parseJson, run } from "../lib/db";
import { summariesByIds } from "../lib/members";
import { validate } from "../lib/validate";

// ───────── 型・読み込み ─────────
type TemplateRow = {
  id: number;
  name: string;
  description: string;
  scale_max: number;
  goal_weight: number;
  competency_weight: number;
  rank_rules: string;
  periods: number;
};
type ItemRow = {
  id: number;
  template_id: number;
  title: string;
  description: string;
  weight: number;
  sort_order: number;
};

async function loadTemplates(db: D1Database, id?: number): Promise<EvaluationTemplate[]> {
  const rows = await all<TemplateRow>(
    db,
    `SELECT t.*, (SELECT count(*) FROM evaluation_periods p WHERE p.template_id = t.id) AS periods
       FROM evaluation_templates t ${id ? "WHERE t.id = ?" : ""} ORDER BY t.id`,
    ...(id ? [id] : []),
  );
  const items = await all<ItemRow>(
    db,
    `SELECT * FROM evaluation_template_items ${id ? "WHERE template_id = ?" : ""} ORDER BY sort_order, id`,
    ...(id ? [id] : []),
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    scaleMax: t.scale_max,
    goalWeight: t.goal_weight,
    competencyWeight: t.competency_weight,
    rankRules: parseJson(t.rank_rules, DEFAULT_RANK_RULES),
    periodCount: t.periods,
    items: items
      .filter((i) => i.template_id === t.id)
      .map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        weight: i.weight,
        sortOrder: i.sort_order,
      })),
  }));
}

type SheetRow = {
  id: number;
  period_id: number;
  member_id: number;
  first_evaluator_id: number | null;
  second_evaluator_id: number | null;
  step: EvalStep;
  final_score: number | null;
  final_rank: string | null;
  updated_at: string;
  period_name: string;
  period_status: "draft" | "active" | "closed";
  template_id: number;
  use_second_step: number;
};

const SHEET_SELECT = `SELECT s.*, p.name AS period_name, p.status AS period_status, p.template_id, p.use_second_step
  FROM evaluation_sheets s JOIN evaluation_periods p ON p.id = s.period_id`;

function relation(a: AuthContext, s: SheetRow) {
  const me = a.user.memberId;
  const isEvaluatee = me !== null && s.member_id === me;
  return {
    isEvaluatee,
    isFirst: me !== null && s.first_evaluator_id === me,
    isSecond: me !== null && s.second_evaluator_id === me,
    // 人事でも自分自身の評価シートは本人として扱う（評価者の点数を見たり確定したりできない）
    isHr: a.caps.manageEvaluations && !isEvaluatee,
  };
}

/** 差し戻し先のステップを担当するのが閲覧者か */
function ownsStep(a: AuthContext, s: SheetRow, step: EvalStep): boolean {
  const r = relation(a, s);
  switch (step) {
    case "goal":
    case "self":
      return r.isEvaluatee;
    case "first":
      return r.isFirst;
    case "second":
      return r.isSecond;
    case "final":
      return r.isHr;
    default:
      return false;
  }
}

/** 自分自身の評価シートの設定を人事として変更させない */
function assertNotOwnSheet(a: AuthContext, s: SheetRow) {
  if (a.user.memberId !== null && s.member_id === a.user.memberId)
    forbid("自分自身の評価シートは変更できません。ほかの人事担当者に依頼してください");
}

/** 閲覧者が今入力できるフェーズ */
function editableFor(a: AuthContext, s: SheetRow): EvaluationSheetDetail["editable"] {
  if (s.period_status !== "active") return null;
  const r = relation(a, s);
  switch (s.step) {
    case "goal":
      return r.isEvaluatee ? "goal" : null;
    case "self":
      return r.isEvaluatee ? "self" : null;
    case "first":
      return r.isFirst || (r.isHr && s.first_evaluator_id === null) ? "first" : null;
    case "second":
      return r.isSecond || (r.isHr && s.second_evaluator_id === null) ? "second" : null;
    case "final":
      return r.isHr ? "final" : null;
    default:
      return null;
  }
}

function visiblePhases(a: AuthContext, s: SheetRow): EvalPhase[] {
  const r = relation(a, s);
  const done = s.step === "done";
  if (r.isHr) return ["self", "first", "second", "final"];
  const out = new Set<EvalPhase>();
  if (r.isEvaluatee) {
    out.add("self");
    if (done) out.add("final");
  }
  if (r.isFirst) {
    out.add("self");
    out.add("first");
    if (done) {
      out.add("second");
      out.add("final");
    }
  }
  if (r.isSecond) {
    out.add("self");
    out.add("first");
    out.add("second");
    if (done) out.add("final");
  }
  return ["self", "first", "second", "final"].filter((p) => out.has(p as EvalPhase)) as EvalPhase[];
}

function canView(a: AuthContext, s: SheetRow): boolean {
  const r = relation(a, s);
  return r.isHr || r.isEvaluatee || r.isFirst || r.isSecond;
}

async function toSummaries(
  db: D1Database,
  a: AuthContext,
  rows: SheetRow[],
): Promise<EvaluationSheetSummary[]> {
  const map = await summariesByIds(
    db,
    a,
    rows.flatMap((r) => [r.member_id, r.first_evaluator_id, r.second_evaluator_id]),
  );
  return rows
    .filter((r) => map.has(r.member_id))
    .map((r) => {
      const r2 = relation(a, r);
      // 評価対象者本人には完了まで最終結果を見せない
      const showResult = r2.isHr || r.step === "done";
      return {
        id: r.id,
        periodId: r.period_id,
        periodName: r.period_name,
        periodStatus: r.period_status,
        member: map.get(r.member_id)!,
        firstEvaluator: r.first_evaluator_id ? (map.get(r.first_evaluator_id) ?? null) : null,
        secondEvaluator: r.second_evaluator_id ? (map.get(r.second_evaluator_id) ?? null) : null,
        step: r.step,
        finalScore: showResult ? r.final_score : null,
        finalRank: showResult ? r.final_rank : null,
        myTurn: editableFor(a, r) !== null,
        updatedAt: r.updated_at,
      };
    });
}

async function loadSheetRow(c: AppContext, id: number): Promise<SheetRow> {
  const row = await first<SheetRow>(c.env.DB, `${SHEET_SELECT} WHERE s.id = ?`, id);
  if (!row) notFound("評価シートが見つかりません");
  return row;
}

async function loadDetail(c: AppContext, a: AuthContext, s: SheetRow): Promise<EvaluationSheetDetail> {
  const db = c.env.DB;
  const [summary] = await toSummaries(db, a, [s]);
  const [template] = await loadTemplates(db, s.template_id);
  const goals = await all<{
    id: number;
    title: string;
    description: string;
    weight: number;
    sort_order: number;
  }>(db, "SELECT * FROM evaluation_goals WHERE sheet_id = ? ORDER BY sort_order, id", s.id);
  const phases = visiblePhases(a, s);
  const editable = editableFor(a, s);
  const scoreRows = await all<{
    phase: string;
    target_type: string;
    target_id: number;
    score: number | null;
    comment: string;
  }>(
    db,
    "SELECT phase, target_type, target_id, score, comment FROM evaluation_scores WHERE sheet_id = ?",
    s.id,
  );
  const commentRows = await all<{ phase: string; comment: string }>(
    db,
    "SELECT phase, comment FROM evaluation_phase_comments WHERE sheet_id = ?",
    s.id,
  );
  const visible = new Set<string>([...phases, ...(editable && editable !== "goal" ? [editable] : [])]);
  const scores: Record<string, Record<string, EvaluationScoreEntry>> = {};
  for (const r of scoreRows) {
    if (!visible.has(r.phase)) continue;
    if (!scores[r.phase]) scores[r.phase] = {};
    scores[r.phase]![`${r.target_type}:${r.target_id}`] = { score: r.score, comment: r.comment };
  }
  const phaseComments: Record<string, string> = {};
  for (const r of commentRows) if (visible.has(r.phase)) phaseComments[r.phase] = r.comment;
  const phaseTotals: Record<string, number | null> = {};
  for (const ph of visible) {
    const sc = scores[ph] ?? {};
    phaseTotals[ph] = totalScore({
      goals: goals.map((g) => ({ weight: g.weight, score: sc[`goal:${g.id}`]?.score ?? null })),
      items: template!.items.map((i) => ({ weight: i.weight, score: sc[`item:${i.id}`]?.score ?? null })),
      goalWeight: template!.goalWeight,
      competencyWeight: template!.competencyWeight,
    });
  }
  const events = await all<{
    id: number;
    action: "submit" | "remand" | "reopen";
    from_step: EvalStep;
    to_step: EvalStep;
    user_id: number | null;
    user_name: string | null;
    comment: string;
    created_at: string;
  }>(
    db,
    `SELECT e.*, u.display_name AS user_name FROM evaluation_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.sheet_id = ? ORDER BY e.created_at DESC, e.id DESC`,
    s.id,
  );
  const r = relation(a, s);
  return {
    ...summary!,
    template: template!,
    useSecondStep: s.use_second_step === 1,
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      weight: g.weight,
      sortOrder: g.sort_order,
    })),
    scores,
    phaseComments,
    phaseTotals,
    visiblePhases: [...visible],
    editable,
    canRemand: editable === "first" || editable === "second" || editable === "final",
    canReopen: r.isHr && s.step === "done" && s.period_status === "active",
    events: events.map((e) => {
      // コメントは、閲覧できるフェーズの提出・自分の操作・自分あての差し戻しのものだけ見せる
      const commentVisible =
        r.isHr ||
        e.user_id === a.user.id ||
        (e.action === "remand" && ownsStep(a, s, e.to_step)) ||
        (e.action === "submit" && visible.has(e.from_step));
      return {
        id: e.id,
        action: e.action,
        fromStep: e.from_step,
        toStep: e.to_step,
        userName: e.user_name,
        comment: commentVisible ? e.comment : "",
        createdAt: e.created_at,
      };
    }),
  };
}

// ───────── 評価者の自動設定 ─────────
type EvalMember = {
  id: number;
  department_id: number | null;
  is_manager: number;
  rank: number;
  status: string;
};

export function resolveEvaluators(depts: DeptRow[], members: EvalMember[]) {
  const parent = new Map(depts.map((d) => [d.id, d.parent_id]));
  const heads = new Map<number, EvalMember>();
  for (const m of members) {
    if (m.status !== "active" || m.is_manager !== 1 || m.department_id === null) continue;
    const cur = heads.get(m.department_id);
    if (!cur || m.rank > cur.rank) heads.set(m.department_id, m);
  }
  const bossOf = (m: { id: number; department_id: number | null }): EvalMember | null => {
    let d = m.department_id;
    const seen = new Set<number>();
    while (d !== null && d !== undefined && !seen.has(d)) {
      seen.add(d);
      const h = heads.get(d);
      if (h && h.id !== m.id) return h;
      d = parent.get(d) ?? null;
    }
    return null;
  };
  return (m: { id: number; department_id: number | null }) => {
    const first = bossOf(m);
    const second = first ? bossOf(first) : null;
    return { first: first?.id ?? null, second: second?.id ?? null };
  };
}

async function createSheets(c: AppContext, periodId: number, memberIds: number[]) {
  const depts = await loadDepartments(c);
  const members = await all<EvalMember>(
    c.env.DB,
    `SELECT m.id, m.department_id, coalesce(jt.is_manager, 0) AS is_manager, coalesce(jt.rank, 0) AS rank, m.status
       FROM members m LEFT JOIN job_titles jt ON jt.id = m.job_title_id`,
  );
  const resolve = resolveEvaluators(depts, members);
  const byId = new Map(members.map((m) => [m.id, m]));
  const stmts: D1PreparedStatement[] = [];
  for (const id of memberIds) {
    const m = byId.get(id);
    if (!m) continue;
    const ev = resolve(m);
    stmts.push(
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO evaluation_sheets (period_id, member_id, first_evaluator_id, second_evaluator_id, step) VALUES (?, ?, ?, ?, 'goal')",
      ).bind(periodId, id, ev.first, ev.second),
    );
  }
  // INSERT OR IGNORE で既存の対象者は数えないよう、実際に追加された件数を返す
  let created = 0;
  for (let i = 0; i < stmts.length; i += 80) {
    const results = await c.env.DB.batch(stmts.slice(i, i + 80));
    for (const r of results) created += r.meta.changes ?? 0;
  }
  return created;
}

// ───────── 入力スキーマ ─────────
const templateInput = z
  .object({
    name: z.string().trim().min(1, "テンプレート名を入力してください").max(60),
    description: z.string().trim().max(1000).default(""),
    scaleMax: z.number().int().min(3).max(10).default(5),
    goalWeight: z.number().int().min(0).max(100),
    competencyWeight: z.number().int().min(0).max(100),
    rankRules: z
      .array(z.object({ rank: z.string().trim().min(1).max(4), min: z.number().min(0).max(10) }))
      .min(1)
      .max(10),
    items: z
      .array(
        z.object({
          id: z.number().int().positive().optional(),
          title: z.string().trim().min(1, "評価項目名を入力してください").max(60),
          description: z.string().trim().max(400).default(""),
          weight: z.number().int().min(1).max(10).default(1),
        }),
      )
      .max(30),
  })
  .refine((v) => v.goalWeight + v.competencyWeight === 100, {
    message: "目標と行動の配分の合計を100%にしてください",
    path: ["goalWeight"],
  })
  .refine((v) => v.competencyWeight === 0 || v.items.length > 0, {
    message: "行動評価の項目を1つ以上登録してください",
    path: ["items"],
  });

const periodInput = z
  .object({
    name: z.string().trim().min(1, "評価期間名を入力してください").max(60),
    templateId: z.number().int().positive(),
    startDate: z.string().refine(isIsoDate, "開始日を正しく入力してください"),
    endDate: z.string().refine(isIsoDate, "終了日を正しく入力してください"),
    useSecondStep: z.boolean().default(true),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "終了日は開始日以降にしてください",
    path: ["endDate"],
  });

const scoreInput = z.object({
  phase: z.enum(["self", "first", "second", "final"]),
  scores: z.record(
    z.string().regex(/^(goal|item):\d+$/),
    z.object({ score: z.number().min(0).max(10).nullable(), comment: z.string().max(2000).default("") }),
  ),
  comment: z.string().max(4000).default(""),
});

// ───────── ルート ─────────
export const evaluationRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  // テンプレート
  .get("/templates", async (c) => {
    auth(c);
    return c.json({ items: await loadTemplates(c.env.DB) });
  })
  .get("/templates/:id", async (c) => {
    auth(c);
    const [t] = await loadTemplates(c.env.DB, parseId(c.req.param("id")));
    if (!t) notFound("テンプレートが見つかりません");
    return c.json(t);
  })
  .post("/templates", requireCap("manageEvaluations"), validate("json", templateInput), async (c) => {
    const v = c.req.valid("json");
    const id = await insert(
      c.env.DB,
      `INSERT INTO evaluation_templates (name, description, scale_max, goal_weight, competency_weight, rank_rules)
       VALUES (?, ?, ?, ?, ?, ?)`,
      v.name,
      v.description,
      v.scaleMax,
      v.goalWeight,
      v.competencyWeight,
      JSON.stringify(v.rankRules),
    );
    await c.env.DB.batch(
      v.items.map((it, i) =>
        c.env.DB.prepare(
          "INSERT INTO evaluation_template_items (template_id, title, description, weight, sort_order) VALUES (?, ?, ?, ?, ?)",
        ).bind(id, it.title, it.description, it.weight, i + 1),
      ),
    );
    await audit(c, "evaluation.template.create", `評価テンプレート「${v.name}」を作成しました`, {
      type: "evaluation_template",
      id,
    });
    return c.json({ id }, 201);
  })
  .patch("/templates/:id", requireCap("manageEvaluations"), validate("json", templateInput), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    const [t] = await loadTemplates(c.env.DB, id);
    if (!t) notFound("テンプレートが見つかりません");
    const used = await first<{ n: number }>(
      c.env.DB,
      "SELECT count(*) AS n FROM evaluation_periods WHERE template_id = ? AND status <> 'draft'",
      id,
    );
    const keepIds = new Set(v.items.map((i) => i.id).filter(Boolean));
    if (used?.n && t.items.some((i) => !keepIds.has(i.id))) {
      badRequest(
        "実施中・終了した評価期間で使われているため、評価項目は削除できません（名称や説明の変更はできます）",
      );
    }
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE evaluation_templates SET name = ?, description = ?, scale_max = ?, goal_weight = ?, competency_weight = ?,
           rank_rules = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(
        v.name,
        v.description,
        v.scaleMax,
        v.goalWeight,
        v.competencyWeight,
        JSON.stringify(v.rankRules),
        id,
      ),
    ];
    for (const old of t.items) {
      if (!keepIds.has(old.id))
        stmts.push(c.env.DB.prepare("DELETE FROM evaluation_template_items WHERE id = ?").bind(old.id));
    }
    v.items.forEach((it, i) => {
      if (it.id && t.items.some((o) => o.id === it.id)) {
        stmts.push(
          c.env.DB.prepare(
            "UPDATE evaluation_template_items SET title = ?, description = ?, weight = ?, sort_order = ? WHERE id = ? AND template_id = ?",
          ).bind(it.title, it.description, it.weight, i + 1, it.id, id),
        );
      } else {
        stmts.push(
          c.env.DB.prepare(
            "INSERT INTO evaluation_template_items (template_id, title, description, weight, sort_order) VALUES (?, ?, ?, ?, ?)",
          ).bind(id, it.title, it.description, it.weight, i + 1),
        );
      }
    });
    await c.env.DB.batch(stmts);
    await audit(c, "evaluation.template.update", `評価テンプレート「${v.name}」を更新しました`, {
      type: "evaluation_template",
      id,
    });
    return c.json({ ok: true });
  })
  .delete("/templates/:id", requireCap("manageEvaluations"), async (c) => {
    const id = parseId(c.req.param("id"));
    const used = await first<{ n: number }>(
      c.env.DB,
      "SELECT count(*) AS n FROM evaluation_periods WHERE template_id = ?",
      id,
    );
    if (used?.n) badRequest("評価期間で使われているテンプレートは削除できません");
    await run(c.env.DB, "DELETE FROM evaluation_templates WHERE id = ?", id);
    return c.json({ ok: true });
  })

  // 評価期間
  .get("/periods", async (c) => {
    const a = auth(c);
    // 期間の一覧と進捗件数は運用担当と分析の利用者のみ（分析の評価ランク軸で期間を選ぶため）
    if (!a.caps.manageEvaluations && !a.caps.viewAnalytics) forbid();
    const rows = await all<{
      id: number;
      name: string;
      template_id: number;
      template_name: string;
      start_date: string;
      end_date: string;
      status: "draft" | "active" | "closed";
      use_second_step: number;
    }>(
      c.env.DB,
      `SELECT p.*, t.name AS template_name FROM evaluation_periods p JOIN evaluation_templates t ON t.id = p.template_id
        ORDER BY p.start_date DESC, p.id DESC`,
    );
    const counts = await all<{ period_id: number; step: EvalStep; n: number }>(
      c.env.DB,
      "SELECT period_id, step, count(*) AS n FROM evaluation_sheets GROUP BY period_id, step",
    );
    const items: EvaluationPeriod[] = rows.map((p) => {
      const stepCounts: Partial<Record<EvalStep, number>> = {};
      let total = 0;
      for (const cnt of counts.filter((x) => x.period_id === p.id)) {
        stepCounts[cnt.step] = cnt.n;
        total += cnt.n;
      }
      return {
        id: p.id,
        name: p.name,
        templateId: p.template_id,
        templateName: p.template_name,
        startDate: p.start_date,
        endDate: p.end_date,
        status: p.status,
        useSecondStep: p.use_second_step === 1,
        sheetCount: total,
        doneCount: stepCounts.done ?? 0,
        stepCounts,
      };
    });
    return c.json({ items });
  })
  .post(
    "/periods",
    requireCap("manageEvaluations"),
    validate(
      "json",
      z.intersection(
        periodInput,
        z.object({
          targetDepartmentIds: z.array(z.number().int().positive()).max(200).default([]),
          includeLeave: z.boolean().default(false),
        }),
      ),
    ),
    async (c) => {
      const v = c.req.valid("json");
      const tpl = await first(c.env.DB, "SELECT id FROM evaluation_templates WHERE id = ?", v.templateId);
      if (!tpl) badRequest("テンプレートが見つかりません");
      const id = await insert(
        c.env.DB,
        "INSERT INTO evaluation_periods (name, template_id, start_date, end_date, status, use_second_step) VALUES (?, ?, ?, ?, 'draft', ?)",
        v.name,
        v.templateId,
        v.startDate,
        v.endDate,
        v.useSecondStep,
      );
      // 対象者：指定部署（配下含む）または全社の在籍者。経営トップ（上長なし）も対象に含める
      const depts = await loadDepartments(c);
      const deptIds = v.targetDepartmentIds.length
        ? [...new Set(v.targetDepartmentIds.flatMap((d) => subtreeIds(depts, d)))]
        : [];
      const statuses = v.includeLeave ? "('active', 'leave')" : "('active')";
      const params: Bindable[] = [];
      let where = `m.status IN ${statuses}`;
      if (deptIds.length) {
        where += " AND m.department_id IN (SELECT value FROM json_each(?))";
        params.push(JSON.stringify(deptIds));
      }
      const targets = await all<{ id: number }>(
        c.env.DB,
        `SELECT m.id FROM members m WHERE ${where}`,
        ...params,
      );
      const created = await createSheets(
        c,
        id,
        targets.map((t) => t.id),
      );
      await audit(c, "evaluation.period.create", `評価期間「${v.name}」を作成しました（対象 ${created}名）`, {
        type: "evaluation_period",
        id,
      });
      return c.json({ id, created }, 201);
    },
  )
  .get("/periods/:id", requireCap("manageEvaluations"), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const rows = await all<SheetRow>(c.env.DB, `${SHEET_SELECT} WHERE s.period_id = ? ORDER BY s.id`, id);
    const sheets = await toSummaries(c.env.DB, a, rows);
    return c.json({ sheets });
  })
  .patch(
    "/periods/:id",
    requireCap("manageEvaluations"),
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        startDate: z.string().refine(isIsoDate).optional(),
        endDate: z.string().refine(isIsoDate).optional(),
        status: z.enum(["draft", "active", "closed"]).optional(),
        useSecondStep: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const id = parseId(c.req.param("id"));
      const v = c.req.valid("json");
      const p = await first<{ name: string; status: string; use_second_step: number }>(
        c.env.DB,
        "SELECT name, status, use_second_step FROM evaluation_periods WHERE id = ?",
        id,
      );
      if (!p) notFound("評価期間が見つかりません");
      if (v.status === "draft" && p.status !== "draft") badRequest("開始した評価期間は準備中に戻せません");
      if (v.useSecondStep === false && p.use_second_step === 1) {
        // 二次評価待ちのシートは最終確定へ進める
        await run(
          c.env.DB,
          "UPDATE evaluation_sheets SET step = 'final' WHERE period_id = ? AND step = 'second'",
          id,
        );
      }
      await run(
        c.env.DB,
        `UPDATE evaluation_periods SET name = coalesce(?, name), start_date = coalesce(?, start_date), end_date = coalesce(?, end_date),
           status = coalesce(?, status), use_second_step = coalesce(?, use_second_step), updated_at = datetime('now') WHERE id = ?`,
        v.name ?? null,
        v.startDate ?? null,
        v.endDate ?? null,
        v.status ?? null,
        v.useSecondStep === undefined ? null : v.useSecondStep,
        id,
      );
      const label = { draft: "準備中に", active: "開始", closed: "終了" } as const;
      if (v.status && v.status !== p.status) {
        await audit(c, "evaluation.period.status", `評価期間「${p.name}」を${label[v.status]}しました`, {
          type: "evaluation_period",
          id,
        });
      }
      return c.json({ ok: true });
    },
  )
  .delete("/periods/:id", requireCap("manageEvaluations"), async (c) => {
    const id = parseId(c.req.param("id"));
    const p = await first<{ name: string; status: string }>(
      c.env.DB,
      "SELECT name, status FROM evaluation_periods WHERE id = ?",
      id,
    );
    if (!p) notFound("評価期間が見つかりません");
    if (p.status !== "draft") badRequest("削除できるのは準備中の評価期間のみです");
    await run(c.env.DB, "DELETE FROM evaluation_periods WHERE id = ?", id);
    await audit(c, "evaluation.period.delete", `評価期間「${p.name}」を削除しました`, {
      type: "evaluation_period",
      id,
    });
    return c.json({ ok: true });
  })
  .post(
    "/periods/:id/sheets",
    requireCap("manageEvaluations"),
    validate("json", z.object({ memberIds: z.array(z.number().int().positive()).min(1).max(1000) })),
    async (c) => {
      const id = parseId(c.req.param("id"));
      const p = await first<{ status: string }>(
        c.env.DB,
        "SELECT status FROM evaluation_periods WHERE id = ?",
        id,
      );
      if (!p) notFound("評価期間が見つかりません");
      if (p.status === "closed") badRequest("終了した評価期間には対象者を追加できません");
      const n = await createSheets(c, id, c.req.valid("json").memberIds);
      return c.json({ created: n });
    },
  )
  .get("/periods/:id/export", requireCap("manageEvaluations"), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const p = await first<{ name: string }>(c.env.DB, "SELECT name FROM evaluation_periods WHERE id = ?", id);
    if (!p) notFound("評価期間が見つかりません");
    const rows = await all<SheetRow>(c.env.DB, `${SHEET_SELECT} WHERE s.period_id = ? ORDER BY s.id`, id);
    const sheets = await toSummaries(c.env.DB, a, rows);
    const csv = toCsv([
      ["社員番号", "氏名", "部署", "役職", "一次評価者", "二次評価者", "ステップ", "総合点", "ランク"],
      ...sheets.map((s) => [
        s.member.employeeCode,
        `${s.member.lastName} ${s.member.firstName}`,
        s.member.departmentName,
        s.member.jobTitleName,
        s.firstEvaluator ? `${s.firstEvaluator.lastName} ${s.firstEvaluator.firstName}` : "",
        s.secondEvaluator ? `${s.secondEvaluator.lastName} ${s.secondEvaluator.firstName}` : "",
        EVAL_STEP_LABELS[s.step],
        s.finalScore,
        s.finalRank,
      ]),
    ]);
    return c.json({ filename: `評価結果_${p.name}.csv`, csv });
  })

  // 自分に関係する評価シート
  .get("/my", async (c) => {
    const a = auth(c);
    const me = a.user.memberId ?? -1;
    const own = await all<SheetRow>(
      c.env.DB,
      `${SHEET_SELECT} WHERE s.member_id = ? AND p.status <> 'draft' ORDER BY p.start_date DESC`,
      me,
    );
    const evaluator = await all<SheetRow>(
      c.env.DB,
      `${SHEET_SELECT} WHERE (s.first_evaluator_id = ? OR s.second_evaluator_id = ?) AND p.status <> 'draft'
        ORDER BY p.start_date DESC, s.id`,
      me,
      me,
    );
    return c.json({
      own: await toSummaries(c.env.DB, a, own),
      evaluator: await toSummaries(c.env.DB, a, evaluator),
    });
  })

  // 評価シート
  .get("/sheets/:id", async (c) => {
    const a = auth(c);
    const s = await loadSheetRow(c, parseId(c.req.param("id")));
    if (!canView(a, s)) notFound("評価シートが見つかりません");
    return c.json(await loadDetail(c, a, s));
  })
  .patch(
    "/sheets/:id/evaluators",
    requireCap("manageEvaluations"),
    validate(
      "json",
      z.object({
        firstEvaluatorId: z.number().int().positive().nullable(),
        secondEvaluatorId: z.number().int().positive().nullable(),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const s = await loadSheetRow(c, id);
      assertNotOwnSheet(a, s);
      const v = c.req.valid("json");
      if (v.firstEvaluatorId === s.member_id || v.secondEvaluatorId === s.member_id) {
        badRequest("本人を評価者にはできません");
      }
      if (v.firstEvaluatorId !== null && v.firstEvaluatorId === v.secondEvaluatorId) {
        badRequest("一次評価者と二次評価者には別の人を設定してください");
      }
      await run(
        c.env.DB,
        "UPDATE evaluation_sheets SET first_evaluator_id = ?, second_evaluator_id = ?, updated_at = datetime('now') WHERE id = ?",
        v.firstEvaluatorId,
        v.secondEvaluatorId,
        id,
      );
      return c.json({ ok: true });
    },
  )
  .delete("/sheets/:id", requireCap("manageEvaluations"), async (c) => {
    const s = await loadSheetRow(c, parseId(c.req.param("id")));
    assertNotOwnSheet(auth(c), s);
    if (s.period_status === "closed") badRequest("終了した評価期間のシートは削除できません");
    await run(c.env.DB, "DELETE FROM evaluation_sheets WHERE id = ?", s.id);
    await audit(c, "evaluation.sheet.delete", `評価シート（${s.period_name}）を対象から外しました`, {
      type: "evaluation_sheet",
      id: s.id,
    });
    return c.json({ ok: true });
  })
  .put(
    "/sheets/:id/goals",
    validate(
      "json",
      z.object({
        goals: z
          .array(
            z.object({
              title: z.string().trim().min(1, "目標を入力してください").max(200),
              description: z.string().trim().max(2000).default(""),
              weight: z.number().int().min(0).max(100),
            }),
          )
          .max(10),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const s = await loadSheetRow(c, parseId(c.req.param("id")));
      if (!canView(a, s)) notFound("評価シートが見つかりません");
      if (editableFor(a, s) !== "goal") forbid("目標を編集できるのは目標設定中の本人のみです");
      const { goals } = c.req.valid("json");
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM evaluation_goals WHERE sheet_id = ?").bind(s.id),
        ...goals.map((g, i) =>
          c.env.DB.prepare(
            "INSERT INTO evaluation_goals (sheet_id, title, description, weight, sort_order) VALUES (?, ?, ?, ?, ?)",
          ).bind(s.id, g.title, g.description, g.weight, i + 1),
        ),
        c.env.DB.prepare("UPDATE evaluation_sheets SET updated_at = datetime('now') WHERE id = ?").bind(s.id),
      ]);
      return c.json(await loadDetail(c, a, await loadSheetRow(c, s.id)));
    },
  )
  .put("/sheets/:id/scores", validate("json", scoreInput), async (c) => {
    const a = auth(c);
    const s = await loadSheetRow(c, parseId(c.req.param("id")));
    if (!canView(a, s)) notFound("評価シートが見つかりません");
    const v = c.req.valid("json");
    if (editableFor(a, s) !== v.phase) forbid("このフェーズを入力する権限がありません");
    const [template] = await loadTemplates(c.env.DB, s.template_id);
    const goals = await all<{ id: number }>(
      c.env.DB,
      "SELECT id FROM evaluation_goals WHERE sheet_id = ?",
      s.id,
    );
    const validKeys = new Set([
      ...goals.map((g) => `goal:${g.id}`),
      ...template!.items.map((i) => `item:${i.id}`),
    ]);
    const stmts: D1PreparedStatement[] = [];
    for (const [key, entry] of Object.entries(v.scores)) {
      if (!validKeys.has(key)) continue;
      if (entry.score !== null && (entry.score < 1 || entry.score > template!.scaleMax)) {
        badRequest(`点数は1〜${template!.scaleMax}で入力してください`);
      }
      const [type, tid] = key.split(":");
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO evaluation_scores (sheet_id, phase, target_type, target_id, score, comment) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(sheet_id, phase, target_type, target_id) DO UPDATE SET score = excluded.score, comment = excluded.comment`,
        ).bind(s.id, v.phase, type!, Number(tid), entry.score, entry.comment),
      );
    }
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO evaluation_phase_comments (sheet_id, phase, comment) VALUES (?, ?, ?)
         ON CONFLICT(sheet_id, phase) DO UPDATE SET comment = excluded.comment`,
      ).bind(s.id, v.phase, v.comment),
      c.env.DB.prepare("UPDATE evaluation_sheets SET updated_at = datetime('now') WHERE id = ?").bind(s.id),
    );
    await batchAtomic(c.env.DB, stmts);
    return c.json(await loadDetail(c, a, await loadSheetRow(c, s.id)));
  })
  .post(
    "/sheets/:id/submit",
    validate("json", z.object({ comment: z.string().max(1000).default("") })),
    async (c) => {
      const a = auth(c);
      const s = await loadSheetRow(c, parseId(c.req.param("id")));
      if (!canView(a, s)) notFound("評価シートが見つかりません");
      const editable = editableFor(a, s);
      if (!editable) forbid("このシートを提出する権限がありません");
      const [template] = await loadTemplates(c.env.DB, s.template_id);
      const goals = await all<{ id: number; weight: number }>(
        c.env.DB,
        "SELECT id, weight FROM evaluation_goals WHERE sheet_id = ?",
        s.id,
      );
      if (editable === "goal") {
        if (template!.goalWeight > 0) {
          const err = validateGoalWeights(goals.map((g) => g.weight));
          if (err) badRequest(err);
        }
      } else {
        const phase = phaseOfStep(s.step)!;
        const rows = await all<{ target_type: string; target_id: number; score: number | null }>(
          c.env.DB,
          "SELECT target_type, target_id, score FROM evaluation_scores WHERE sheet_id = ? AND phase = ?",
          s.id,
          phase,
        );
        const scoreOf = (k: string) =>
          rows.find((r) => `${r.target_type}:${r.target_id}` === k)?.score ?? null;
        const missing = [
          ...goals.map((g) => `goal:${g.id}`),
          ...template!.items.map((i) => `item:${i.id}`),
        ].filter((k) => scoreOf(k) === null);
        if (missing.length)
          badRequest(`未入力の評価が${missing.length}件あります。すべての項目に点数をつけてください`);
        if (editable === "final") {
          const total = totalScore({
            goals: goals.map((g) => ({ weight: g.weight, score: scoreOf(`goal:${g.id}`) })),
            items: template!.items.map((i) => ({ weight: i.weight, score: scoreOf(`item:${i.id}`) })),
            goalWeight: template!.goalWeight,
            competencyWeight: template!.competencyWeight,
          });
          await run(
            c.env.DB,
            "UPDATE evaluation_sheets SET final_score = ?, final_rank = ? WHERE id = ?",
            total,
            rankFor(total, template!.rankRules),
            s.id,
          );
        }
      }
      const to = nextStep(s.step, s.use_second_step === 1);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE evaluation_sheets SET step = ?, updated_at = datetime('now') WHERE id = ?",
        ).bind(to, s.id),
        c.env.DB.prepare(
          "INSERT INTO evaluation_events (sheet_id, action, from_step, to_step, user_id, comment) VALUES (?, 'submit', ?, ?, ?, ?)",
        ).bind(s.id, s.step, to, a.user.id, c.req.valid("json").comment),
      ]);
      await audit(
        c,
        "evaluation.submit",
        `評価シート（${s.period_name}）の${EVAL_STEP_LABELS[s.step]}を提出しました`,
        {
          type: "evaluation_sheet",
          id: s.id,
        },
      );
      return c.json(await loadDetail(c, a, await loadSheetRow(c, s.id)));
    },
  )
  .post(
    "/sheets/:id/remand",
    validate(
      "json",
      z.object({ comment: z.string().trim().min(1, "差し戻しの理由を入力してください").max(1000) }),
    ),
    async (c) => {
      const a = auth(c);
      const s = await loadSheetRow(c, parseId(c.req.param("id")));
      if (!canView(a, s)) notFound("評価シートが見つかりません");
      const editable = editableFor(a, s);
      if (editable !== "first" && editable !== "second" && editable !== "final") forbid("差し戻しできません");
      const to = previousStep(s.step, s.use_second_step === 1)!;
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE evaluation_sheets SET step = ?, updated_at = datetime('now') WHERE id = ?",
        ).bind(to, s.id),
        c.env.DB.prepare(
          "INSERT INTO evaluation_events (sheet_id, action, from_step, to_step, user_id, comment) VALUES (?, 'remand', ?, ?, ?, ?)",
        ).bind(s.id, s.step, to, a.user.id, c.req.valid("json").comment),
      ]);
      await audit(
        c,
        "evaluation.remand",
        `評価シート（${s.period_name}）を${EVAL_STEP_LABELS[to]}へ差し戻しました`,
        {
          type: "evaluation_sheet",
          id: s.id,
        },
      );
      return c.json(await loadDetail(c, a, await loadSheetRow(c, s.id)));
    },
  )
  .post("/sheets/:id/reopen", requireCap("manageEvaluations"), async (c) => {
    const a = auth(c);
    const s = await loadSheetRow(c, parseId(c.req.param("id")));
    assertNotOwnSheet(a, s);
    if (s.step !== "done" || s.period_status !== "active")
      badRequest("再開できるのは実施中の期間の完了済みシートのみです");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE evaluation_sheets SET step = 'final', final_score = NULL, final_rank = NULL, updated_at = datetime('now') WHERE id = ?",
      ).bind(s.id),
      c.env.DB.prepare(
        "INSERT INTO evaluation_events (sheet_id, action, from_step, to_step, user_id, comment) VALUES (?, 'reopen', 'done', 'final', ?, '')",
      ).bind(s.id, a.user.id),
    ]);
    return c.json(await loadDetail(c, a, await loadSheetRow(c, s.id)));
  })
  /** 社員の評価履歴（プロフィール用） */
  .get("/history/:memberId", async (c) => {
    const a = auth(c);
    const memberId = parseId(c.req.param("memberId"));
    const rows = await all<SheetRow>(
      c.env.DB,
      `${SHEET_SELECT} WHERE s.member_id = ? AND p.status <> 'draft' ORDER BY p.start_date DESC`,
      memberId,
    );
    const member = await first<{ id: number; department_id: number | null }>(
      c.env.DB,
      "SELECT id, department_id FROM members WHERE id = ?",
      memberId,
    );
    // 管轄内のマネージャーは完了した評価結果のみ参照できる
    const managerView = a.user.role === "manager" && member !== null && memberInScope(a, member);
    const visible = rows.filter((r) => canView(a, r) || (managerView && r.step === "done"));
    return c.json({ items: await toSummaries(c.env.DB, a, visible) });
  });
