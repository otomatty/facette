import { Hono } from "hono";
import { z } from "zod";
import { SURVEY_QUESTION_TYPES } from "../../shared/constants";
import { toCsv } from "../../shared/csv";
import { isIsoDate, todayJst } from "../../shared/dates";
import type { Survey, SurveyQuestion, SurveyQuestionResult, SurveyResults } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppContext,
  type AppEnv,
  type AuthContext,
  auth,
  badRequest,
  forbid,
  loadDepartments,
  notFound,
  parseId,
  requireAuth,
  requireCap,
  subtreeIds,
} from "../lib/context";
import { all, type Bindable, batchChunks, first, insert, parseJson, placeholders, run } from "../lib/db";
import { validate } from "../lib/validate";

/** 匿名アンケートで部署別などの内訳を出すときの最小人数 */
export const ANONYMITY_THRESHOLD = 3;

type SurveyRow = {
  id: number;
  title: string;
  description: string;
  kind: "survey" | "pulse";
  anonymous: number;
  status: "draft" | "open" | "closed";
  closes_at: string | null;
  published_at: string | null;
  created_at: string;
  targets: number;
  responses: number;
  is_target: number;
  responded: number;
};
type QuestionRow = {
  id: number;
  survey_id: number;
  type: SurveyQuestion["type"];
  text: string;
  options: string;
  required: number;
  sort_order: number;
};

function toQuestion(q: QuestionRow): SurveyQuestion {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    options: parseJson<string[]>(q.options, []),
    required: q.required === 1,
    sortOrder: q.sort_order,
  };
}

/** 締切日（日本時間）を過ぎた受付中のアンケートを締め切る */
export async function closeOverdueSurveys(db: D1Database): Promise<void> {
  await run(
    db,
    "UPDATE surveys SET status = 'closed', updated_at = datetime('now') WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at < ?",
    todayJst(),
  );
}

async function loadSurveys(c: AppContext, a: AuthContext, id?: number): Promise<Survey[]> {
  await closeOverdueSurveys(c.env.DB);
  const me = a.user.memberId ?? -1;
  const where: string[] = [];
  const params: Bindable[] = [me, me];
  if (id) {
    where.push("s.id = ?");
    params.push(id);
  }
  if (!a.caps.manageSurveys) {
    where.push(
      "s.status <> 'draft' AND EXISTS (SELECT 1 FROM survey_targets t WHERE t.survey_id = s.id AND t.member_id = ?)",
    );
    params.push(me);
  }
  const rows = await all<SurveyRow>(
    c.env.DB,
    `SELECT s.*,
       (SELECT count(*) FROM survey_targets t WHERE t.survey_id = s.id) AS targets,
       (SELECT count(*) FROM survey_targets t WHERE t.survey_id = s.id AND t.responded_at IS NOT NULL) AS responses,
       EXISTS (SELECT 1 FROM survey_targets t WHERE t.survey_id = s.id AND t.member_id = ?) AS is_target,
       EXISTS (SELECT 1 FROM survey_targets t WHERE t.survey_id = s.id AND t.member_id = ? AND t.responded_at IS NOT NULL) AS responded
     FROM surveys s ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE s.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, coalesce(s.published_at, s.created_at) DESC`,
    ...params,
  );
  if (!rows.length) return [];
  const qs = await all<QuestionRow>(
    c.env.DB,
    "SELECT * FROM survey_questions WHERE survey_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order, id",
    JSON.stringify(rows.map((r) => r.id)),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    kind: r.kind,
    anonymous: r.anonymous === 1,
    status: r.status,
    closesAt: r.closes_at,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    questions: qs.filter((q) => q.survey_id === r.id).map(toQuestion),
    targetCount: r.targets,
    responseCount: r.responses,
    isTarget: r.is_target === 1,
    responded: r.responded === 1,
  }));
}

async function loadOne(c: AppContext, a: AuthContext, id: number): Promise<Survey> {
  const [s] = await loadSurveys(c, a, id);
  if (!s) notFound("アンケートが見つかりません");
  return s;
}

const questionInput = z
  .object({
    type: z.enum(SURVEY_QUESTION_TYPES),
    text: z.string().trim().min(1, "質問文を入力してください").max(400),
    options: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    required: z.boolean().default(true),
  })
  .refine((q) => !(q.type === "single" || q.type === "multi") || q.options.length >= 2, {
    message: "選択式の質問には選択肢を2つ以上入力してください",
    path: ["options"],
  });

const closesAtInput = z
  .string()
  .nullable()
  .optional()
  .refine((s) => !s || isIsoDate(s), "締切日を正しく入力してください");

const surveyInput = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください").max(100),
  description: z.string().trim().max(2000).default(""),
  kind: z.enum(["survey", "pulse"]).default("survey"),
  anonymous: z.boolean().default(false),
  closesAt: closesAtInput,
  questions: z.array(questionInput).min(1, "質問を1つ以上追加してください").max(50),
});
/** 配信後は質問を変更できないため、質問は省略できる */
const surveyPatchInput = surveyInput.extend({
  questions: z.array(questionInput).min(1, "質問を1つ以上追加してください").max(50).optional(),
});

const PAST_DEADLINE = "締切日に過去の日付は指定できません";

function validateAnswer(
  q: SurveyQuestion,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const empty =
    value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty)
    return q.required ? { ok: false, error: `「${q.text}」に回答してください` } : { ok: true, value: null };
  switch (q.type) {
    case "single":
      return typeof value === "string" && q.options.includes(value)
        ? { ok: true, value }
        : { ok: false, error: `「${q.text}」の回答が選択肢にありません` };
    case "multi":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && q.options.includes(v))
        ? { ok: true, value: [...new Set(value)] }
        : { ok: false, error: `「${q.text}」の回答が選択肢にありません` };
    case "scale":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5
        ? { ok: true, value }
        : { ok: false, error: `「${q.text}」は1〜5で回答してください` };
    case "nps":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10
        ? { ok: true, value }
        : { ok: false, error: `「${q.text}」は0〜10で回答してください` };
    case "text":
      return typeof value === "string" && value.length <= 4000
        ? { ok: true, value: value.trim() }
        : { ok: false, error: `「${q.text}」は4000文字以内で回答してください` };
  }
}

export async function computeResults(c: AppContext, a: AuthContext, survey: Survey): Promise<SurveyResults> {
  const db = c.env.DB;
  const answers = await all<{
    question_id: number;
    value: string;
    member_id: number | null;
    member_name: string | null;
  }>(
    db,
    `SELECT sa.question_id, sa.value, r.member_id, m.last_name || ' ' || m.first_name AS member_name
       FROM survey_answers sa JOIN survey_responses r ON r.id = sa.response_id
       LEFT JOIN members m ON m.id = r.member_id WHERE r.survey_id = ?`,
    survey.id,
  );
  const questions: SurveyQuestionResult[] = survey.questions.map((q) => {
    const vals = answers
      .filter((x) => x.question_id === q.id)
      .map((x) => ({ ...x, v: parseJson<unknown>(x.value, null) }));
    const base = {
      questionId: q.id,
      type: q.type,
      text: q.text,
      answered: vals.filter((x) => x.v !== null).length,
    };
    if (q.type === "single" || q.type === "multi") {
      const counts = q.options.map((o) => ({
        label: o,
        count: vals.filter((x) => (Array.isArray(x.v) ? x.v.includes(o) : x.v === o)).length,
      }));
      return { ...base, counts };
    }
    if (q.type === "scale") {
      const nums = vals.map((x) => Number(x.v)).filter((n) => Number.isFinite(n));
      const counts = [1, 2, 3, 4, 5].map((n) => ({
        label: String(n),
        count: nums.filter((x) => x === n).length,
      }));
      return {
        ...base,
        counts,
        average: nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null,
      };
    }
    if (q.type === "nps") {
      const nums = vals.map((x) => Number(x.v)).filter((n) => Number.isFinite(n));
      const promoters = nums.filter((n) => n >= 9).length;
      const detractors = nums.filter((n) => n <= 6).length;
      const passives = nums.length - promoters - detractors;
      const counts = Array.from({ length: 11 }, (_, n) => ({
        label: String(n),
        count: nums.filter((x) => x === n).length,
      }));
      return {
        ...base,
        counts,
        average: nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null,
        nps: nums.length
          ? {
              score: Math.round(((promoters - detractors) / nums.length) * 100),
              promoters,
              passives,
              detractors,
            }
          : null,
      };
    }
    const texts = vals
      .filter((x) => typeof x.v === "string" && x.v)
      .map((x) => ({
        text: String(x.v),
        respondent: survey.anonymous ? null : x.member_name,
        respondentId: survey.anonymous ? null : x.member_id,
      }));
    // 匿名の場合は回答順からも推測されないよう並びを入れ替える
    if (survey.anonymous) texts.sort(() => Math.random() - 0.5);
    return { ...base, texts };
  });
  const depts = await loadDepartments(c);
  const targetsByDept = await all<{ department_id: number | null; targets: number; responses: number }>(
    db,
    `SELECT m.department_id, count(*) AS targets, sum(t.responded_at IS NOT NULL) AS responses
       FROM survey_targets t JOIN members m ON m.id = t.member_id WHERE t.survey_id = ? GROUP BY m.department_id`,
    survey.id,
  );
  void a;
  return {
    survey,
    questions,
    byDepartment: targetsByDept
      .map((r) => ({
        departmentId: r.department_id,
        departmentName: depts.find((d) => d.id === r.department_id)?.name ?? "所属なし",
        targets: r.targets,
        responses: r.responses,
      }))
      .sort(
        (x, y) =>
          (depts.findIndex((d) => d.id === x.departmentId) ?? 0) -
          (depts.findIndex((d) => d.id === y.departmentId) ?? 0),
      ),
  };
}

export const surveyRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    const a = auth(c);
    return c.json({ items: await loadSurveys(c, a) });
  })
  .post("/", requireCap("manageSurveys"), validate("json", surveyInput), async (c) => {
    const a = auth(c);
    const v = c.req.valid("json");
    if (v.closesAt && v.closesAt < todayJst()) badRequest(PAST_DEADLINE);
    const id = await insert(
      c.env.DB,
      "INSERT INTO surveys (title, description, kind, anonymous, status, closes_at, created_by) VALUES (?, ?, ?, ?, 'draft', ?, ?)",
      v.title,
      v.description,
      v.kind,
      v.anonymous,
      v.closesAt ?? null,
      a.user.id,
    );
    await c.env.DB.batch(
      v.questions.map((q, i) =>
        c.env.DB.prepare(
          "INSERT INTO survey_questions (survey_id, type, text, options, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(id, q.type, q.text, JSON.stringify(q.options), q.required, i + 1),
      ),
    );
    await audit(c, "survey.create", `アンケート「${v.title}」を作成しました`, { type: "survey", id });
    return c.json({ id }, 201);
  })
  .get("/:id", async (c) => {
    const a = auth(c);
    return c.json(await loadOne(c, a, parseId(c.req.param("id"))));
  })
  .patch("/:id", requireCap("manageSurveys"), validate("json", surveyPatchInput), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const s = await loadOne(c, a, id);
    const v = c.req.valid("json");
    // すでに過ぎている締切日をそのまま保存し直すのは許可する
    if (v.closesAt && v.closesAt !== s.closesAt && v.closesAt < todayJst()) badRequest(PAST_DEADLINE);
    if (s.status !== "draft") {
      // 配信後はタイトル・説明・締切のみ変更可能
      await run(
        c.env.DB,
        "UPDATE surveys SET title = ?, description = ?, closes_at = ?, updated_at = datetime('now') WHERE id = ?",
        v.title,
        v.description,
        v.closesAt ?? null,
        id,
      );
      await audit(c, "survey.update", `アンケート「${v.title}」を更新しました`, { type: "survey", id });
      return c.json({ ok: true, questionsLocked: true });
    }
    if (!v.questions) badRequest("質問を1つ以上追加してください");
    const questions = v.questions;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE surveys SET title = ?, description = ?, kind = ?, anonymous = ?, closes_at = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(v.title, v.description, v.kind, v.anonymous, v.closesAt ?? null, id),
      c.env.DB.prepare("DELETE FROM survey_questions WHERE survey_id = ?").bind(id),
      ...questions.map((q, i) =>
        c.env.DB.prepare(
          "INSERT INTO survey_questions (survey_id, type, text, options, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(id, q.type, q.text, JSON.stringify(q.options), q.required, i + 1),
      ),
    ]);
    await audit(c, "survey.update", `アンケート「${v.title}」を更新しました`, { type: "survey", id });
    return c.json({ ok: true });
  })
  .delete("/:id", requireCap("manageSurveys"), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const s = await loadOne(c, a, id);
    await run(c.env.DB, "DELETE FROM surveys WHERE id = ?", id);
    await audit(c, "survey.delete", `アンケート「${s.title}」を削除しました`, { type: "survey", id });
    return c.json({ ok: true });
  })
  .post(
    "/:id/publish",
    requireCap("manageSurveys"),
    validate("json", z.object({ departmentIds: z.array(z.number().int().positive()).max(200).default([]) })),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const s = await loadOne(c, a, id);
      if (s.status !== "draft") badRequest("配信済みのアンケートです");
      if (s.closesAt && s.closesAt < todayJst())
        badRequest("締切日を過ぎています。編集から締切日を変更してから配信してください");
      const { departmentIds } = c.req.valid("json");
      const depts = await loadDepartments(c);
      const ids = [...new Set(departmentIds.flatMap((d) => subtreeIds(depts, d)))];
      const params: Bindable[] = [];
      let where = "status = 'active'";
      if (ids.length) {
        where += " AND department_id IN (SELECT value FROM json_each(?))";
        params.push(JSON.stringify(ids));
      }
      const members = await all<{ id: number }>(c.env.DB, `SELECT id FROM members WHERE ${where}`, ...params);
      if (!members.length) badRequest("配信対象の社員がいません");
      await batchChunks(c.env.DB, [
        ...members.map((m) =>
          c.env.DB.prepare("INSERT OR IGNORE INTO survey_targets (survey_id, member_id) VALUES (?, ?)").bind(
            id,
            m.id,
          ),
        ),
        c.env.DB.prepare(
          "UPDATE surveys SET status = 'open', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        ).bind(id),
      ]);
      await audit(c, "survey.publish", `アンケート「${s.title}」を${members.length}名に配信しました`, {
        type: "survey",
        id,
      });
      return c.json({ targets: members.length });
    },
  )
  .post("/:id/close", requireCap("manageSurveys"), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const s = await loadOne(c, a, id);
    if (s.status !== "open") badRequest("回答受付中のアンケートではありません");
    await run(
      c.env.DB,
      "UPDATE surveys SET status = 'closed', updated_at = datetime('now') WHERE id = ?",
      id,
    );
    await audit(c, "survey.close", `アンケート「${s.title}」を締め切りました`, { type: "survey", id });
    return c.json({ ok: true });
  })
  /** 締め切ったアンケートの受付を再開する。締切日を過ぎている場合は新しい締切日（または null で締切なし）が必要 */
  .post(
    "/:id/reopen",
    requireCap("manageSurveys"),
    validate("json", z.object({ closesAt: closesAtInput })),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const s = await loadOne(c, a, id);
      if (s.status !== "closed") badRequest("締め切ったアンケートではありません");
      const { closesAt } = c.req.valid("json");
      const today = todayJst();
      if (closesAt && closesAt < today) badRequest(PAST_DEADLINE);
      const next = closesAt === undefined ? s.closesAt : closesAt;
      if (next && next < today) badRequest("締切日を過ぎています。新しい締切日を指定してください");
      await run(
        c.env.DB,
        "UPDATE surveys SET status = 'open', closes_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'closed'",
        next,
        id,
      );
      await audit(c, "survey.reopen", `アンケート「${s.title}」の受付を再開しました`, { type: "survey", id });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/responses",
    validate("json", z.object({ answers: z.record(z.string(), z.unknown()) })),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const s = await loadOne(c, a, id);
      if (s.status !== "open") badRequest("このアンケートは回答を受け付けていません");
      if (!s.isTarget || a.user.memberId === null) forbid("このアンケートの回答対象ではありません");
      if (s.responded) badRequest("すでに回答済みです");
      const { answers } = c.req.valid("json");
      const values: { q: SurveyQuestion; value: unknown }[] = [];
      for (const q of s.questions) {
        const r = validateAnswer(q, answers[String(q.id)]);
        if (!r.ok) badRequest(r.error);
        values.push({ q, value: r.value });
      }
      const member = await first<{ department_id: number | null }>(
        c.env.DB,
        "SELECT department_id FROM members WHERE id = ?",
        a.user.memberId,
      );
      // 二重回答の防止：対象者テーブルを先に更新できた場合のみ記録する
      // 匿名の場合は回答時刻から個人を推測されないよう日付単位で記録する
      const ts = s.anonymous ? "date('now')" : "datetime('now')";
      const mark = await run(
        c.env.DB,
        `UPDATE survey_targets SET responded_at = ${ts} WHERE survey_id = ? AND member_id = ? AND responded_at IS NULL`,
        id,
        a.user.memberId,
      );
      if (!mark.meta.changes) badRequest("すでに回答済みです");
      const responseId = await insert(
        c.env.DB,
        `INSERT INTO survey_responses (survey_id, member_id, department_id, submitted_at) VALUES (?, ?, ?, ${ts})`,
        id,
        s.anonymous ? null : a.user.memberId,
        member?.department_id ?? null,
      );
      await c.env.DB.batch(
        values
          .filter((x) => x.value !== null)
          .map((x) =>
            c.env.DB.prepare(
              "INSERT INTO survey_answers (response_id, question_id, value) VALUES (?, ?, ?)",
            ).bind(responseId, x.q.id, JSON.stringify(x.value)),
          ),
      );
      return c.json({ ok: true }, 201);
    },
  )
  .get("/:id/results", requireCap("manageSurveys"), async (c) => {
    const a = auth(c);
    const s = await loadOne(c, a, parseId(c.req.param("id")));
    return c.json(await computeResults(c, a, s));
  })
  /** 5段階評価の部署別平均（匿名の場合は回答3件未満の部署を伏せる） */
  .get("/:id/results/by-department", requireCap("manageSurveys"), async (c) => {
    const a = auth(c);
    const s = await loadOne(c, a, parseId(c.req.param("id")));
    const scaleQs = s.questions.filter((q) => q.type === "scale");
    if (!scaleQs.length) return c.json({ questions: [], rows: [] });
    const rows = await all<{ department_id: number | null; question_id: number; n: number; avg: number }>(
      c.env.DB,
      `SELECT r.department_id, sa.question_id, count(*) AS n, avg(CAST(sa.value AS REAL)) AS avg
         FROM survey_answers sa JOIN survey_responses r ON r.id = sa.response_id
        WHERE r.survey_id = ? AND sa.question_id IN (${placeholders(scaleQs.length)})
        GROUP BY r.department_id, sa.question_id`,
      s.id,
      ...scaleQs.map((q) => q.id),
    );
    const depts = await loadDepartments(c);
    const deptIds = [...new Set(rows.map((r) => r.department_id))];
    return c.json({
      questions: scaleQs.map((q) => ({ id: q.id, text: q.text })),
      rows: deptIds
        .map((d) => {
          const cells = scaleQs.map((q) => {
            const r = rows.find((x) => x.department_id === d && x.question_id === q.id);
            if (!r) return null;
            if (s.anonymous && r.n < ANONYMITY_THRESHOLD) return { n: r.n, average: null, masked: true };
            return { n: r.n, average: Math.round(r.avg * 100) / 100, masked: false };
          });
          return {
            departmentId: d,
            departmentName: depts.find((x) => x.id === d)?.name ?? "所属なし",
            sortKey: depts.findIndex((x) => x.id === d),
            cells,
          };
        })
        .sort((x, y) => x.sortKey - y.sortKey),
    });
  })
  .get("/:id/export", requireCap("manageSurveys"), async (c) => {
    const a = auth(c);
    const s = await loadOne(c, a, parseId(c.req.param("id")));
    const responses = await all<{
      id: number;
      submitted_at: string;
      name: string | null;
      code: string | null;
      dept: string | null;
    }>(
      c.env.DB,
      `SELECT r.id, r.submitted_at, m.last_name || ' ' || m.first_name AS name, m.employee_code AS code, d.name AS dept
         FROM survey_responses r LEFT JOIN members m ON m.id = r.member_id LEFT JOIN departments d ON d.id = r.department_id
        WHERE r.survey_id = ? ORDER BY r.id`,
      s.id,
    );
    const answers = await all<{ response_id: number; question_id: number; value: string }>(
      c.env.DB,
      "SELECT sa.* FROM survey_answers sa JOIN survey_responses r ON r.id = sa.response_id WHERE r.survey_id = ?",
      s.id,
    );
    // 匿名アンケートは部署・回答日時も出力しない（組み合わせで個人が特定されるのを防ぐ）
    const header = [
      ...(s.anonymous ? [] : ["社員番号", "氏名", "部署", "回答日時"]),
      ...s.questions.map((q) => q.text),
    ];
    const shuffled = s.anonymous ? [...responses].sort(() => Math.random() - 0.5) : responses;
    const csv = toCsv([
      header,
      ...shuffled.map((r) => [
        ...(s.anonymous ? [] : [r.code, r.name, r.dept, r.submitted_at]),
        ...s.questions.map((q) => {
          const ans = answers.find((x) => x.response_id === r.id && x.question_id === q.id);
          return ans ? parseJson<unknown>(ans.value, "") : "";
        }),
      ]),
    ]);
    return c.json({ filename: `アンケート結果_${s.title}.csv`, csv });
  });
