import { Hono } from "hono";
import { z } from "zod";
import type { JobPosition, MemberSummary, PositionMatch, Skill } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppEnv,
  auth,
  badRequest,
  forbid,
  loadDepartments,
  notFound,
  parseId,
  requireAuth,
  requireCap,
} from "../lib/context";
import { all, first, insert, run } from "../lib/db";
import { MEMBER_SELECT, type MemberRow, toSummary } from "../lib/members";
import { validate } from "../lib/validate";

const skillInput = z.object({
  name: z.string().trim().min(1, "スキル名を入力してください").max(40),
  category: z.string().trim().min(1, "カテゴリを入力してください").max(30),
  description: z.string().trim().max(200).default(""),
});

export const skillRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    const rows = await all<{ id: number; name: string; category: string; description: string; n: number }>(
      c.env.DB,
      `SELECT s.*, (SELECT count(*) FROM member_skills ms JOIN members m ON m.id = ms.member_id
                     WHERE ms.skill_id = s.id AND m.status IN ('active','leave')) AS n
         FROM skills s ORDER BY s.category, s.name`,
    );
    const items: Skill[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      holderCount: r.n,
    }));
    return c.json({ items });
  })
  .post("/", requireCap("manageTalent"), validate("json", skillInput), async (c) => {
    const v = c.req.valid("json");
    if (await first(c.env.DB, "SELECT id FROM skills WHERE name = ?", v.name))
      badRequest("同じ名前のスキルがあります");
    const id = await insert(
      c.env.DB,
      "INSERT INTO skills (name, category, description) VALUES (?, ?, ?)",
      v.name,
      v.category,
      v.description,
    );
    await audit(c, "skill.create", `スキル「${v.name}」を追加しました`, { type: "skill", id });
    return c.json({ id }, 201);
  })
  .patch("/:id", requireCap("manageTalent"), validate("json", skillInput), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    if (await first(c.env.DB, "SELECT id FROM skills WHERE name = ? AND id <> ?", v.name, id))
      badRequest("同じ名前のスキルがあります");
    const res = await run(
      c.env.DB,
      "UPDATE skills SET name = ?, category = ?, description = ? WHERE id = ?",
      v.name,
      v.category,
      v.description,
      id,
    );
    if (!res.meta.changes) notFound();
    return c.json({ ok: true });
  })
  .delete("/:id", requireCap("manageTalent"), async (c) => {
    const id = parseId(c.req.param("id"));
    const row = await first<{ name: string }>(c.env.DB, "SELECT name FROM skills WHERE id = ?", id);
    if (!row) notFound();
    await run(c.env.DB, "DELETE FROM skills WHERE id = ?", id);
    await audit(c, "skill.delete", `スキル「${row.name}」を削除しました`, { type: "skill", id });
    return c.json({ ok: true });
  })
  /** スキルマップ：スキル × 本部 の保有者数（レベル3以上）と平均レベル */
  .get("/map", async (c) => {
    auth(c);
    const depts = await loadDepartments(c);
    const root = depts.find((d) => d.parent_id === null);
    const divisions = depts.filter((d) => d.parent_id === root?.id);
    const divisionOf = new Map<number, number>();
    for (const d of depts) {
      let cur: (typeof depts)[number] | undefined = d;
      while (cur && cur.parent_id !== root?.id && cur.parent_id !== null) {
        const parentId: number = cur.parent_id;
        cur = depts.find((x) => x.id === parentId);
      }
      if (cur && cur.parent_id === root?.id) divisionOf.set(d.id, cur.id);
    }
    const rows = await all<{ skill_id: number; level: number; department_id: number | null }>(
      c.env.DB,
      `SELECT ms.skill_id, ms.level, m.department_id FROM member_skills ms JOIN members m ON m.id = ms.member_id
        WHERE m.status IN ('active', 'leave')`,
    );
    const cells: Record<string, { holders: number; total: number; sum: number }> = {};
    for (const r of rows) {
      const div = r.department_id !== null ? divisionOf.get(r.department_id) : undefined;
      const key = `${r.skill_id}:${div ?? 0}`;
      if (!cells[key]) cells[key] = { holders: 0, total: 0, sum: 0 };
      const cell = cells[key]!;
      cell.total++;
      cell.sum += r.level;
      if (r.level >= 3) cell.holders++;
    }
    return c.json({
      divisions: divisions.map((d) => ({ id: d.id, name: d.name })),
      cells: Object.entries(cells).map(([k, v]) => {
        const [skillId, divisionId] = k.split(":").map(Number);
        return {
          skillId,
          divisionId,
          holders: v.holders,
          total: v.total,
          average: Math.round((v.sum / v.total) * 10) / 10,
        };
      }),
    });
  })
  .get("/:id/holders", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const rows = await all<MemberRow & { level: number }>(
      c.env.DB,
      `${MEMBER_SELECT.replace("SELECT m.*", "SELECT m.*, ms.level")} JOIN member_skills ms ON ms.member_id = m.id
        WHERE ms.skill_id = ? AND m.status IN ('active', 'leave') ORDER BY ms.level DESC, m.last_name_kana`,
      id,
    );
    return c.json({ items: rows.map((r) => ({ member: toSummary(a, r), level: r.level })) });
  });

// ───────── ポジション ─────────
const positionInput = z.object({
  name: z.string().trim().min(1, "ポジション名を入力してください").max(60),
  departmentId: z.number().int().positive().nullable(),
  mission: z.string().trim().max(400).default(""),
  description: z.string().trim().max(4000).default(""),
  headcount: z.number().int().min(1).max(999).default(1),
  status: z.enum(["open", "closed"]).default("open"),
  requirements: z
    .array(
      z.object({
        skillId: z.number().int().positive(),
        minLevel: z.number().int().min(1).max(5),
        weight: z.number().int().min(1).max(5).default(1),
      }),
    )
    .max(30)
    .default([]),
});

async function loadPositions(db: D1Database, id?: number): Promise<JobPosition[]> {
  const rows = await all<{
    id: number;
    name: string;
    department_id: number | null;
    department_name: string | null;
    mission: string;
    description: string;
    headcount: number;
    status: "open" | "closed";
  }>(
    db,
    `SELECT p.*, d.name AS department_name FROM job_positions p LEFT JOIN departments d ON d.id = p.department_id
      ${id ? "WHERE p.id = ?" : ""} ORDER BY p.status, p.id`,
    ...(id ? [id] : []),
  );
  const reqs = await all<{
    position_id: number;
    skill_id: number;
    name: string;
    min_level: number;
    weight: number;
  }>(
    db,
    `SELECT r.*, s.name FROM job_position_requirements r JOIN skills s ON s.id = r.skill_id ${id ? "WHERE r.position_id = ?" : ""}
      ORDER BY r.weight DESC, s.name`,
    ...(id ? [id] : []),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    departmentId: r.department_id,
    departmentName: r.department_name,
    mission: r.mission,
    description: r.description,
    headcount: r.headcount,
    status: r.status,
    requirements: reqs
      .filter((q) => q.position_id === r.id)
      .map((q) => ({ skillId: q.skill_id, skillName: q.name, minLevel: q.min_level, weight: q.weight })),
  }));
}

async function saveRequirements(
  db: D1Database,
  positionId: number,
  reqs: z.infer<typeof positionInput>["requirements"],
) {
  await db.batch([
    db.prepare("DELETE FROM job_position_requirements WHERE position_id = ?").bind(positionId),
    ...reqs.map((r) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO job_position_requirements (position_id, skill_id, min_level, weight) SELECT ?, id, ?, ? FROM skills WHERE id = ?",
        )
        .bind(positionId, r.minLevel, r.weight, r.skillId),
    ),
  ]);
}

/** マッチ度 = Σ(重み × min(保有レベル / 必要レベル, 1)) / Σ重み */
export function matchScore(
  reqs: { skillId: number; minLevel: number; weight: number }[],
  levels: Map<number, number>,
): { score: number; met: number } {
  let num = 0;
  let den = 0;
  let met = 0;
  for (const r of reqs) {
    const actual = levels.get(r.skillId) ?? 0;
    num += r.weight * Math.min(actual / r.minLevel, 1);
    den += r.weight;
    if (actual >= r.minLevel) met++;
  }
  return { score: den ? Math.round((num / den) * 100) : 0, met };
}

export const positionRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    return c.json({ items: await loadPositions(c.env.DB) });
  })
  .post("/", requireCap("manageTalent"), validate("json", positionInput), async (c) => {
    const v = c.req.valid("json");
    const id = await insert(
      c.env.DB,
      "INSERT INTO job_positions (name, department_id, mission, description, headcount, status) VALUES (?, ?, ?, ?, ?, ?)",
      v.name,
      v.departmentId,
      v.mission,
      v.description,
      v.headcount,
      v.status,
    );
    await saveRequirements(c.env.DB, id, v.requirements);
    await audit(c, "position.create", `ポジション「${v.name}」を作成しました`, { type: "position", id });
    return c.json({ id }, 201);
  })
  .get("/:id", async (c) => {
    auth(c);
    const [p] = await loadPositions(c.env.DB, parseId(c.req.param("id")));
    if (!p) notFound("ポジションが見つかりません");
    return c.json(p);
  })
  .patch("/:id", requireCap("manageTalent"), validate("json", positionInput), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    const res = await run(
      c.env.DB,
      `UPDATE job_positions SET name = ?, department_id = ?, mission = ?, description = ?, headcount = ?, status = ?,
         updated_at = datetime('now') WHERE id = ?`,
      v.name,
      v.departmentId,
      v.mission,
      v.description,
      v.headcount,
      v.status,
      id,
    );
    if (!res.meta.changes) notFound("ポジションが見つかりません");
    await saveRequirements(c.env.DB, id, v.requirements);
    await audit(c, "position.update", `ポジション「${v.name}」を更新しました`, { type: "position", id });
    return c.json({ ok: true });
  })
  .delete("/:id", requireCap("manageTalent"), async (c) => {
    const id = parseId(c.req.param("id"));
    const row = await first<{ name: string }>(c.env.DB, "SELECT name FROM job_positions WHERE id = ?", id);
    if (!row) notFound("ポジションが見つかりません");
    await run(c.env.DB, "DELETE FROM job_positions WHERE id = ?", id);
    await audit(c, "position.delete", `ポジション「${row.name}」を削除しました`, { type: "position", id });
    return c.json({ ok: true });
  })
  .get("/:id/matches", async (c) => {
    const a = auth(c);
    if (a.user.role === "member") forbid("候補者の検索は人事・マネージャーのみ利用できます");
    const [p] = await loadPositions(c.env.DB, parseId(c.req.param("id")));
    if (!p) notFound("ポジションが見つかりません");
    if (!p.requirements.length) return c.json({ items: [] as PositionMatch[] });
    const skillIds = p.requirements.map((r) => r.skillId);
    const levels = await all<{ member_id: number; skill_id: number; level: number }>(
      c.env.DB,
      `SELECT member_id, skill_id, level FROM member_skills WHERE skill_id IN (${skillIds.map(() => "?").join(",")})`,
      ...skillIds,
    );
    const byMember = new Map<number, Map<number, number>>();
    for (const l of levels) {
      const m = byMember.get(l.member_id) ?? new Map<number, number>();
      m.set(l.skill_id, l.level);
      byMember.set(l.member_id, m);
    }
    const scored = [...byMember.entries()]
      .map(([memberId, lv]) => ({ memberId, lv, ...matchScore(p.requirements, lv) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || y.met - x.met)
      .slice(0, 40);
    if (!scored.length) return c.json({ items: [] as PositionMatch[] });
    const rows = await all<MemberRow>(
      c.env.DB,
      `${MEMBER_SELECT} WHERE m.id IN (${scored.map(() => "?").join(",")}) AND m.status = 'active'`,
      ...scored.map((s) => s.memberId),
    );
    const summaries = new Map<number, MemberSummary>(rows.map((r) => [r.id, toSummary(a, r)]));
    const items: PositionMatch[] = scored
      .filter((s) => summaries.has(s.memberId))
      .map((s) => ({
        member: summaries.get(s.memberId)!,
        score: s.score,
        met: s.met,
        total: p.requirements.length,
        details: p.requirements.map((r) => ({
          skillId: r.skillId,
          skillName: r.skillName,
          required: r.minLevel,
          actual: s.lv.get(r.skillId) ?? 0,
        })),
      }));
    return c.json({ items });
  });
