import { Hono } from "hono";
import { z } from "zod";
import { departmentInputSchema } from "../../shared/schemas";
import type { Department, EmploymentType, Grade, JobTitle, Masters } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppEnv,
  auth,
  badRequest,
  notFound,
  parseId,
  requireAuth,
  requireCap,
  subtreeIds,
} from "../lib/context";
import { all, first, insert, reorderRows, run } from "../lib/db";
import { validate } from "../lib/validate";

async function loadMasters(db: D1Database): Promise<Masters> {
  const [depts, jts, grades, ets] = await Promise.all([
    all<{
      id: number;
      code: string | null;
      name: string;
      parent_id: number | null;
      sort_order: number;
      n: number;
    }>(
      db,
      `SELECT d.*, (SELECT count(*) FROM members m WHERE m.department_id = d.id AND m.status IN ('active','leave')) AS n
         FROM departments d ORDER BY d.sort_order, d.id`,
    ),
    all<{ id: number; name: string; rank: number; is_manager: number }>(
      db,
      "SELECT * FROM job_titles ORDER BY rank DESC, id",
    ),
    all<{ id: number; name: string; rank: number }>(db, "SELECT * FROM grades ORDER BY rank, id"),
    all<{ id: number; name: string; sort_order: number }>(
      db,
      "SELECT * FROM employment_types ORDER BY sort_order, id",
    ),
  ]);
  return {
    departments: depts.map(
      (d): Department => ({
        id: d.id,
        code: d.code,
        name: d.name,
        parentId: d.parent_id,
        sortOrder: d.sort_order,
        memberCount: d.n,
      }),
    ),
    jobTitles: jts.map(
      (j): JobTitle => ({ id: j.id, name: j.name, rank: j.rank, isManager: j.is_manager === 1 }),
    ),
    grades: grades.map((g): Grade => ({ id: g.id, name: g.name, rank: g.rank })),
    employmentTypes: ets.map((e): EmploymentType => ({ id: e.id, name: e.name, sortOrder: e.sort_order })),
  };
}

const simpleMaster = z.object({
  name: z.string().trim().min(1, "名称を入力してください").max(40),
  rank: z.number().int().min(0).max(1000).default(0),
  isManager: z.boolean().default(false),
});

type MasterTable = "job_titles" | "grades" | "employment_types";
const TABLE_LABEL: Record<MasterTable, string> = {
  job_titles: "役職",
  grades: "等級",
  employment_types: "雇用形態",
};
const MEMBER_COLUMN: Record<MasterTable, string> = {
  job_titles: "job_title_id",
  grades: "grade_id",
  employment_types: "employment_type_id",
};

function masterCrud(table: MasterTable) {
  const rankCol = table === "employment_types" ? "sort_order" : "rank";
  return new Hono<AppEnv>()
    .use(requireCap("manageMasters"))
    .post("/", validate("json", simpleMaster), async (c) => {
      const v = c.req.valid("json");
      const dup = await first(c.env.DB, `SELECT id FROM ${table} WHERE name = ?`, v.name);
      if (dup) badRequest(`同じ名前の${TABLE_LABEL[table]}があります`);
      const id =
        table === "job_titles"
          ? await insert(
              c.env.DB,
              "INSERT INTO job_titles (name, rank, is_manager) VALUES (?, ?, ?)",
              v.name,
              v.rank,
              v.isManager,
            )
          : await insert(c.env.DB, `INSERT INTO ${table} (name, ${rankCol}) VALUES (?, ?)`, v.name, v.rank);
      await audit(c, `master.${table}.create`, `${TABLE_LABEL[table]}「${v.name}」を追加しました`, {
        type: table,
        id,
      });
      return c.json({ id }, 201);
    })
    .patch("/:id", validate("json", simpleMaster), async (c) => {
      const id = parseId(c.req.param("id"));
      const v = c.req.valid("json");
      const dup = await first(c.env.DB, `SELECT id FROM ${table} WHERE name = ? AND id <> ?`, v.name, id);
      if (dup) badRequest(`同じ名前の${TABLE_LABEL[table]}があります`);
      const res =
        table === "job_titles"
          ? await run(
              c.env.DB,
              "UPDATE job_titles SET name = ?, rank = ?, is_manager = ? WHERE id = ?",
              v.name,
              v.rank,
              v.isManager,
              id,
            )
          : await run(
              c.env.DB,
              `UPDATE ${table} SET name = ?, ${rankCol} = ? WHERE id = ?`,
              v.name,
              v.rank,
              id,
            );
      if (!res.meta.changes) notFound();
      await audit(c, `master.${table}.update`, `${TABLE_LABEL[table]}「${v.name}」を更新しました`, {
        type: table,
        id,
      });
      return c.json({ ok: true });
    })
    .delete("/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      const used = await first<{ n: number }>(
        c.env.DB,
        `SELECT count(*) AS n FROM members WHERE ${MEMBER_COLUMN[table]} = ?`,
        id,
      );
      if (used && used.n > 0)
        badRequest(`この${TABLE_LABEL[table]}の社員が${used.n}名いるため削除できません`);
      const row = await first<{ name: string }>(c.env.DB, `SELECT name FROM ${table} WHERE id = ?`, id);
      if (!row) notFound();
      await run(c.env.DB, `DELETE FROM ${table} WHERE id = ?`, id);
      await audit(c, `master.${table}.delete`, `${TABLE_LABEL[table]}「${row.name}」を削除しました`, {
        type: table,
        id,
      });
      return c.json({ ok: true });
    });
}

export const masterRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    return c.json(await loadMasters(c.env.DB));
  })
  .post("/departments", requireCap("manageMasters"), validate("json", departmentInputSchema), async (c) => {
    const v = c.req.valid("json");
    if (v.parentId) {
      const parent = await first(c.env.DB, "SELECT id FROM departments WHERE id = ?", v.parentId);
      if (!parent) badRequest("親部署が見つかりません");
    }
    if (v.code) {
      const dup = await first(c.env.DB, "SELECT id FROM departments WHERE code = ?", v.code);
      if (dup) badRequest("同じ部署コードがすでに使われています");
    }
    const max = await first<{ n: number | null }>(c.env.DB, "SELECT max(sort_order) AS n FROM departments");
    const id = await insert(
      c.env.DB,
      "INSERT INTO departments (name, code, parent_id, sort_order) VALUES (?, ?, ?, ?)",
      v.name,
      v.code ?? null,
      v.parentId,
      (max?.n ?? 0) + 1,
    );
    await audit(c, "department.create", `部署「${v.name}」を追加しました`, { type: "department", id });
    return c.json({ id }, 201);
  })
  .patch(
    "/departments/:id",
    requireCap("manageMasters"),
    validate("json", departmentInputSchema),
    async (c) => {
      const id = parseId(c.req.param("id"));
      const v = c.req.valid("json");
      const depts = await all<{
        id: number;
        name: string;
        parent_id: number | null;
        sort_order: number;
        code: string | null;
      }>(c.env.DB, "SELECT id, name, parent_id, sort_order, code FROM departments");
      if (!depts.some((d) => d.id === id)) notFound("部署が見つかりません");
      if (v.parentId !== null) {
        if (!depts.some((d) => d.id === v.parentId)) badRequest("親部署が見つかりません");
        if (subtreeIds(depts, id).includes(v.parentId))
          badRequest("自部署または配下の部署を親にすることはできません");
      }
      if (v.code) {
        const dup = await first(
          c.env.DB,
          "SELECT id FROM departments WHERE code = ? AND id <> ?",
          v.code,
          id,
        );
        if (dup) badRequest("同じ部署コードがすでに使われています");
      }
      await run(
        c.env.DB,
        "UPDATE departments SET name = ?, code = ?, parent_id = ? WHERE id = ?",
        v.name,
        v.code ?? null,
        v.parentId,
        id,
      );
      await audit(c, "department.update", `部署「${v.name}」を更新しました`, { type: "department", id });
      return c.json({ ok: true });
    },
  )
  .post(
    "/departments/reorder",
    requireCap("manageMasters"),
    validate("json", z.object({ ids: z.array(z.number().int().positive()).max(500) })),
    async (c) => {
      const { ids } = c.req.valid("json");
      await reorderRows(c.env.DB, "departments", ids);
      await audit(c, "department.reorder", "部署の並び順を変更しました", { type: "department" });
      return c.json({ ok: true });
    },
  )
  .delete("/departments/:id", requireCap("manageMasters"), async (c) => {
    const id = parseId(c.req.param("id"));
    const dept = await first<{ name: string }>(c.env.DB, "SELECT name FROM departments WHERE id = ?", id);
    if (!dept) notFound("部署が見つかりません");
    const child = await first(c.env.DB, "SELECT id FROM departments WHERE parent_id = ? LIMIT 1", id);
    if (child) badRequest("配下に部署があるため削除できません");
    const used = await first<{ n: number }>(
      c.env.DB,
      "SELECT count(*) AS n FROM members WHERE department_id = ?",
      id,
    );
    if (used && used.n > 0) badRequest(`所属する社員が${used.n}名いるため削除できません`);
    await run(c.env.DB, "DELETE FROM departments WHERE id = ?", id);
    await audit(c, "department.delete", `部署「${dept.name}」を削除しました`, { type: "department", id });
    return c.json({ ok: true });
  })
  .route("/job-titles", masterCrud("job_titles"))
  .route("/grades", masterCrud("grades"))
  .route("/employment-types", masterCrud("employment_types"));
