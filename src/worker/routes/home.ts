import { Hono } from "hono";
import { todayJst } from "../../shared/dates";
import type { Announcement, HomeSummary } from "../../shared/types";
import { type AppEnv, auth, requireAuth } from "../lib/context";
import { all, first } from "../lib/db";
import { MEMBER_SELECT, type MemberRow, toSummary } from "../lib/members";
import { closeOverdueSurveys } from "./surveys";

export async function loadAnnouncements(db: D1Database, limit: number): Promise<Announcement[]> {
  const rows = await all<{
    id: number;
    title: string;
    body: string;
    pinned: number;
    published_at: string;
    author: string | null;
  }>(
    db,
    `SELECT a.*, u.display_name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.pinned DESC, a.published_at DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    pinned: r.pinned === 1,
    publishedAt: r.published_at,
    authorName: r.author,
  }));
}

export const homeRoutes = new Hono<AppEnv>().use(requireAuth).get("/", async (c) => {
  const a = auth(c);
  const db = c.env.DB;
  const today = todayJst();
  const monthStart = `${today.slice(0, 7)}-01`;
  const me = a.user.memberId ?? -1;

  const todos: HomeSummary["todos"] = [];
  const evalRows = await all<{ id: number; step: string; period: string; member: string; mine: number }>(
    db,
    `SELECT s.id, s.step, p.name AS period, m.last_name || ' ' || m.first_name AS member, (s.member_id = ?) AS mine
       FROM evaluation_sheets s JOIN evaluation_periods p ON p.id = s.period_id JOIN members m ON m.id = s.member_id
      WHERE p.status = 'active' AND (
        (s.member_id = ? AND s.step IN ('goal', 'self')) OR
        (s.first_evaluator_id = ? AND s.step = 'first') OR
        (s.second_evaluator_id = ? AND s.step = 'second'))
      ORDER BY mine DESC, s.id LIMIT 50`,
    me,
    me,
    me,
    me,
  );
  const stepLabel: Record<string, string> = {
    goal: "目標を設定してください",
    self: "自己評価を入力してください",
    first: "一次評価をお願いします",
    second: "二次評価をお願いします",
  };
  const ownEval = evalRows.filter((r) => r.mine === 1);
  for (const r of ownEval) {
    todos.push({
      kind: "evaluation",
      title: `${r.period}の評価`,
      detail: stepLabel[r.step] ?? "",
      href: `/evaluations/sheets/${r.id}`,
    });
  }
  const others = evalRows.filter((r) => r.mine !== 1);
  if (others.length) {
    todos.push({
      kind: "evaluation",
      title: `評価者として ${others.length}件の評価が待っています`,
      detail: others
        .slice(0, 3)
        .map((r) => `${r.member}さん`)
        .join("、")
        .concat(others.length > 3 ? " ほか" : ""),
      href: "/evaluations?tab=evaluator",
    });
  }
  if (a.caps.manageEvaluations) {
    const fin = await first<{ n: number }>(
      db,
      "SELECT count(*) AS n FROM evaluation_sheets s JOIN evaluation_periods p ON p.id = s.period_id WHERE p.status = 'active' AND s.step = 'final'",
    );
    if (fin?.n) {
      todos.push({
        kind: "evaluation",
        title: `最終確定待ちの評価が ${fin.n}件あります`,
        detail: "評価期間の画面から確定してください",
        href: "/evaluations?tab=manage",
      });
    }
  }
  await closeOverdueSurveys(db);
  const surveys = await all<{ id: number; title: string; closes_at: string | null }>(
    db,
    `SELECT s.id, s.title, s.closes_at FROM surveys s JOIN survey_targets t ON t.survey_id = s.id
      WHERE s.status = 'open' AND t.member_id = ? AND t.responded_at IS NULL ORDER BY s.closes_at`,
    me,
  );
  for (const s of surveys) {
    todos.push({
      kind: "survey",
      title: `「${s.title}」に回答してください`,
      detail: s.closes_at ? `締切 ${s.closes_at.slice(5, 10).replace("-", "/")}` : "",
      href: `/surveys/${s.id}/answer`,
    });
  }
  if (a.caps.reviewRequests) {
    const req = await first<{ n: number }>(
      db,
      "SELECT count(*) AS n FROM change_requests WHERE status = 'pending'",
    );
    if (req?.n)
      todos.push({
        kind: "request",
        title: `承認待ちの申請が ${req.n}件あります`,
        detail: "",
        href: "/requests",
      });
  }

  const stats = await first<{ headcount: number; joined: number; leave: number; depts: number }>(
    db,
    `SELECT
       (SELECT count(*) FROM members WHERE status IN ('active', 'leave')) AS headcount,
       (SELECT count(*) FROM members WHERE status IN ('active', 'leave') AND hire_date >= ? AND hire_date <= ?) AS joined,
       (SELECT count(*) FROM members WHERE status = 'leave') AS leave,
       (SELECT count(*) FROM departments) AS depts`,
    monthStart,
    today,
  );

  const newcomers = await all<MemberRow>(
    db,
    `${MEMBER_SELECT} WHERE m.status = 'active' AND m.hire_date <= ? AND m.hire_date >= date(?, '-90 days')
      ORDER BY m.hire_date DESC, m.id LIMIT 8`,
    today,
    today,
  );
  const anniversaryRows = await all<MemberRow>(
    db,
    `${MEMBER_SELECT} WHERE m.status = 'active' AND substr(m.hire_date, 6, 2) = ? AND m.hire_date < ?
      ORDER BY m.hire_date LIMIT 12`,
    today.slice(5, 7),
    `${today.slice(0, 4)}-01-01`,
  );

  const body: HomeSummary = {
    todos,
    announcements: await loadAnnouncements(db, 5),
    stats: {
      headcount: stats?.headcount ?? 0,
      joinedThisMonth: stats?.joined ?? 0,
      departments: stats?.depts ?? 0,
      onLeave: stats?.leave ?? 0,
    },
    newcomers: newcomers.map((r) => toSummary(a, r)),
    anniversaries: anniversaryRows.map((r) => ({
      member: toSummary(a, r),
      years: Number(today.slice(0, 4)) - Number(r.hire_date!.slice(0, 4)),
    })),
  };
  return c.json(body);
});
