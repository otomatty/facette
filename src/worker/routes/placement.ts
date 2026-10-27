import { Hono } from "hono";
import { z } from "zod";
import { isIsoDate, todayJst } from "../../shared/dates";
import type { PlacementMove, PlacementScenario } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppContext,
  type AppEnv,
  type AuthContext,
  auth,
  badRequest,
  forbid,
  notFound,
  parseId,
  requireAuth,
  requireCap,
} from "../lib/context";
import { all, batchChunks, first, insert, run } from "../lib/db";
import { validate } from "../lib/validate";

type Row = {
  id: number;
  name: string;
  description: string;
  status: "draft" | "applied";
  effective_date: string | null;
  created_by: number | null;
  created_by_name: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  moves: number;
};

const SELECT = `SELECT p.*, u.display_name AS created_by_name,
  (SELECT count(*) FROM placement_moves mv WHERE mv.scenario_id = p.id) AS moves
  FROM placement_scenarios p LEFT JOIN users u ON u.id = p.created_by`;

function toDto(r: Row): PlacementScenario {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    effectiveDate: r.effective_date,
    createdByName: r.created_by_name,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    moveCount: r.moves,
  };
}

/** 人事・管理者はすべて、マネージャーは自分が作成したシナリオのみ */
function canAccess(a: AuthContext, r: Row) {
  return a.scope.all || r.created_by === a.user.id;
}

async function load(c: AppContext, a: AuthContext, id: number): Promise<Row> {
  const r = await first<Row>(c.env.DB, `${SELECT} WHERE p.id = ?`, id);
  if (!r || !canAccess(a, r)) notFound("シミュレーションが見つかりません");
  return r;
}

const scenarioInput = z.object({
  name: z.string().trim().min(1, "シミュレーション名を入力してください").max(80),
  description: z.string().trim().max(2000).default(""),
  effectiveDate: z
    .string()
    .nullable()
    .optional()
    .refine((s) => !s || isIsoDate(s), "発令日を正しく入力してください"),
});

export const placementRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("usePlacement"))
  .get("/", async (c) => {
    const a = auth(c);
    const rows = await all<Row>(
      c.env.DB,
      `${SELECT} ${a.scope.all ? "" : "WHERE p.created_by = ?"} ORDER BY p.status, p.updated_at DESC`,
      ...(a.scope.all ? [] : [a.user.id]),
    );
    return c.json({ items: rows.map(toDto) });
  })
  .post("/", validate("json", scenarioInput), async (c) => {
    const a = auth(c);
    const v = c.req.valid("json");
    const id = await insert(
      c.env.DB,
      "INSERT INTO placement_scenarios (name, description, effective_date, created_by) VALUES (?, ?, ?, ?)",
      v.name,
      v.description,
      v.effectiveDate ?? null,
      a.user.id,
    );
    await audit(c, "placement.create", `配置シミュレーション「${v.name}」を作成しました`, {
      type: "placement",
      id,
    });
    return c.json({ id }, 201);
  })
  .get("/:id", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    const moves = await all<{
      member_id: number;
      to_department_id: number | null;
      to_job_title_id: number | null;
    }>(
      c.env.DB,
      "SELECT member_id, to_department_id, to_job_title_id FROM placement_moves WHERE scenario_id = ?",
      r.id,
    );
    const items: PlacementMove[] = moves.map((m) => ({
      memberId: m.member_id,
      toDepartmentId: m.to_department_id,
      toJobTitleId: m.to_job_title_id,
    }));
    return c.json({ scenario: toDto(r), moves: items });
  })
  .patch("/:id", validate("json", scenarioInput), async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    const v = c.req.valid("json");
    await run(
      c.env.DB,
      "UPDATE placement_scenarios SET name = ?, description = ?, effective_date = ?, updated_at = datetime('now') WHERE id = ?",
      v.name,
      v.description,
      v.effectiveDate ?? null,
      r.id,
    );
    return c.json({ ok: true });
  })
  .put(
    "/:id/moves",
    validate(
      "json",
      z.object({
        moves: z
          .array(
            z.object({
              memberId: z.number().int().positive(),
              toDepartmentId: z.number().int().positive().nullable(),
              toJobTitleId: z.number().int().positive().nullable(),
            }),
          )
          .max(3000),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const r = await load(c, a, parseId(c.req.param("id")));
      if (r.status !== "draft") badRequest("反映済みのシミュレーションは編集できません");
      const { moves } = c.req.valid("json");
      await batchChunks(c.env.DB, [
        c.env.DB.prepare("DELETE FROM placement_moves WHERE scenario_id = ?").bind(r.id),
        ...moves.map((m) =>
          c.env.DB.prepare(
            "INSERT OR REPLACE INTO placement_moves (scenario_id, member_id, to_department_id, to_job_title_id) VALUES (?, ?, ?, ?)",
          ).bind(r.id, m.memberId, m.toDepartmentId, m.toJobTitleId),
        ),
        c.env.DB.prepare("UPDATE placement_scenarios SET updated_at = datetime('now') WHERE id = ?").bind(
          r.id,
        ),
      ]);
      return c.json({ ok: true, count: moves.length });
    },
  )
  .post("/:id/duplicate", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    const id = await insert(
      c.env.DB,
      "INSERT INTO placement_scenarios (name, description, effective_date, created_by) VALUES (?, ?, ?, ?)",
      `${r.name}（コピー）`,
      r.description,
      r.effective_date,
      a.user.id,
    );
    await run(
      c.env.DB,
      `INSERT INTO placement_moves (scenario_id, member_id, to_department_id, to_job_title_id)
       SELECT ?, member_id, to_department_id, to_job_title_id FROM placement_moves WHERE scenario_id = ?`,
      id,
      r.id,
    );
    return c.json({ id }, 201);
  })
  .post("/:id/apply", async (c) => {
    const a = auth(c);
    if (!a.caps.applyPlacement) forbid("本番への反映は人事担当・管理者のみ行えます");
    const r = await load(c, a, parseId(c.req.param("id")));
    if (r.status !== "draft") badRequest("すでに反映済みです");
    const moves = await all<{
      member_id: number;
      to_department_id: number | null;
      to_job_title_id: number | null;
      department_id: number | null;
      job_title_id: number | null;
    }>(
      c.env.DB,
      `SELECT mv.member_id, mv.to_department_id, mv.to_job_title_id, m.department_id, m.job_title_id
         FROM placement_moves mv JOIN members m ON m.id = mv.member_id WHERE mv.scenario_id = ?`,
      r.id,
    );
    const effective = r.effective_date ?? todayJst();
    const stmts: D1PreparedStatement[] = [];
    let changed = 0;
    for (const m of moves) {
      const toDept = m.to_department_id ?? m.department_id;
      const toJt = m.to_job_title_id ?? m.job_title_id;
      if (toDept === m.department_id && toJt === m.job_title_id) continue;
      changed++;
      stmts.push(
        c.env.DB.prepare(
          "UPDATE members SET department_id = ?, job_title_id = ?, updated_at = datetime('now') WHERE id = ?",
        ).bind(toDept, toJt, m.member_id),
        c.env.DB.prepare(
          `INSERT INTO member_transfers (member_id, effective_date, from_department_id, to_department_id, from_job_title_id, to_job_title_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          m.member_id,
          effective,
          m.department_id,
          toDept,
          m.job_title_id,
          toJt,
          `配置シミュレーション「${r.name}」による異動`,
        ),
      );
    }
    stmts.push(
      c.env.DB.prepare(
        "UPDATE placement_scenarios SET status = 'applied', applied_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).bind(r.id),
    );
    await batchChunks(c.env.DB, stmts);
    await audit(c, "placement.apply", `配置シミュレーション「${r.name}」を反映しました（${changed}名）`, {
      type: "placement",
      id: r.id,
    });
    return c.json({ applied: changed });
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    await run(c.env.DB, "DELETE FROM placement_scenarios WHERE id = ?", r.id);
    await audit(c, "placement.delete", `配置シミュレーション「${r.name}」を削除しました`, {
      type: "placement",
      id: r.id,
    });
    return c.json({ ok: true });
  });
