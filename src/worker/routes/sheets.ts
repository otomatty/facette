import { Hono } from "hono";
import { z } from "zod";
import { sheetFieldInputSchema, sheetInputSchema } from "../../shared/schemas";
import { audit } from "../lib/audit";
import { type AppEnv, auth, badRequest, notFound, parseId, requireAuth, requireCap } from "../lib/context";
import { first, insert, run } from "../lib/db";
import { loadSheets } from "../lib/sheets";
import { validate } from "../lib/validate";

const reorderSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) });

export const sheetRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    return c.json({ items: await loadSheets(c.env.DB) });
  })
  .post("/", requireCap("manageSheets"), validate("json", sheetInputSchema), async (c) => {
    const v = c.req.valid("json");
    const max = await first<{ n: number | null }>(c.env.DB, "SELECT max(sort_order) AS n FROM sheets");
    const id = await insert(
      c.env.DB,
      "INSERT INTO sheets (name, description, kind, sort_order, self_access) VALUES (?, ?, ?, ?, ?)",
      v.name,
      v.description,
      v.kind,
      (max?.n ?? 0) + 1,
      v.selfAccess,
    );
    await c.env.DB.batch(
      (["hr", "manager", "member"] as const).map((role) =>
        c.env.DB.prepare("INSERT INTO sheet_permissions (sheet_id, role, access) VALUES (?, ?, ?)").bind(
          id,
          role,
          v.permissions[role],
        ),
      ),
    );
    await audit(c, "sheet.create", `シート「${v.name}」を作成しました`, { type: "sheet", id });
    return c.json({ id }, 201);
  })
  .post("/reorder", requireCap("manageSheets"), validate("json", reorderSchema), async (c) => {
    const { ids } = c.req.valid("json");
    await c.env.DB.batch(
      ids.map((id, i) => c.env.DB.prepare("UPDATE sheets SET sort_order = ? WHERE id = ?").bind(i + 1, id)),
    );
    return c.json({ ok: true });
  })
  .patch("/:id", requireCap("manageSheets"), validate("json", sheetInputSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    const sheet = await first<{ kind: string }>(c.env.DB, "SELECT kind FROM sheets WHERE id = ?", id);
    if (!sheet) notFound("シートが見つかりません");
    if (sheet.kind === "multi" && v.kind === "single") {
      const multi = await first<{ n: number }>(
        c.env.DB,
        "SELECT count(*) AS n FROM (SELECT member_id FROM sheet_records WHERE sheet_id = ? GROUP BY member_id HAVING count(*) > 1)",
        id,
      );
      if (multi && multi.n > 0)
        badRequest("複数件のデータがある社員がいるため、単一レコードに変更できません");
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE sheets SET name = ?, description = ?, kind = ?, self_access = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(v.name, v.description, v.kind, v.selfAccess, id),
      ...(["hr", "manager", "member"] as const).map((role) =>
        c.env.DB.prepare(
          `INSERT INTO sheet_permissions (sheet_id, role, access) VALUES (?, ?, ?)
           ON CONFLICT(sheet_id, role) DO UPDATE SET access = excluded.access`,
        ).bind(id, role, v.permissions[role]),
      ),
    ]);
    await audit(c, "sheet.update", `シート「${v.name}」の設定を変更しました`, { type: "sheet", id });
    return c.json({ ok: true });
  })
  .delete("/:id", requireCap("manageSheets"), async (c) => {
    const id = parseId(c.req.param("id"));
    const sheet = await first<{ name: string }>(c.env.DB, "SELECT name FROM sheets WHERE id = ?", id);
    if (!sheet) notFound("シートが見つかりません");
    await run(c.env.DB, "DELETE FROM sheets WHERE id = ?", id);
    await audit(c, "sheet.delete", `シート「${sheet.name}」を削除しました`, { type: "sheet", id });
    return c.json({ ok: true });
  })
  .post("/:id/fields", requireCap("manageSheets"), validate("json", sheetFieldInputSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    const sheet = await first<{ name: string }>(c.env.DB, "SELECT name FROM sheets WHERE id = ?", id);
    if (!sheet) notFound("シートが見つかりません");
    const max = await first<{ n: number | null }>(
      c.env.DB,
      "SELECT max(sort_order) AS n FROM sheet_fields WHERE sheet_id = ?",
      id,
    );
    const fieldId = await insert(
      c.env.DB,
      "INSERT INTO sheet_fields (sheet_id, label, type, options, required, help_text, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      v.label,
      v.type,
      JSON.stringify(v.options),
      v.required,
      v.helpText,
      (max?.n ?? 0) + 1,
    );
    await audit(c, "sheet.field.create", `シート「${sheet.name}」に項目「${v.label}」を追加しました`, {
      type: "sheet",
      id,
    });
    return c.json({ id: fieldId }, 201);
  })
  .post("/:id/fields/reorder", requireCap("manageSheets"), validate("json", reorderSchema), async (c) => {
    const id = parseId(c.req.param("id"));
    const { ids } = c.req.valid("json");
    await c.env.DB.batch(
      ids.map((fid, i) =>
        c.env.DB.prepare("UPDATE sheet_fields SET sort_order = ? WHERE id = ? AND sheet_id = ?").bind(
          i + 1,
          fid,
          id,
        ),
      ),
    );
    return c.json({ ok: true });
  })
  .patch(
    "/:id/fields/:fieldId",
    requireCap("manageSheets"),
    validate("json", sheetFieldInputSchema),
    async (c) => {
      const id = parseId(c.req.param("id"));
      const fieldId = parseId(c.req.param("fieldId"));
      const v = c.req.valid("json");
      const res = await run(
        c.env.DB,
        "UPDATE sheet_fields SET label = ?, type = ?, options = ?, required = ?, help_text = ? WHERE id = ? AND sheet_id = ?",
        v.label,
        v.type,
        JSON.stringify(v.options),
        v.required,
        v.helpText,
        fieldId,
        id,
      );
      if (!res.meta.changes) notFound("項目が見つかりません");
      await audit(c, "sheet.field.update", `項目「${v.label}」を変更しました`, { type: "sheet", id });
      return c.json({ ok: true });
    },
  )
  .delete("/:id/fields/:fieldId", requireCap("manageSheets"), async (c) => {
    const id = parseId(c.req.param("id"));
    const fieldId = parseId(c.req.param("fieldId"));
    const field = await first<{ label: string }>(
      c.env.DB,
      "SELECT label FROM sheet_fields WHERE id = ? AND sheet_id = ?",
      fieldId,
      id,
    );
    if (!field) notFound("項目が見つかりません");
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM sheet_fields WHERE id = ?").bind(fieldId),
      c.env.DB.prepare(
        `UPDATE sheet_records SET data = json_remove(data, '$."${fieldId}"') WHERE sheet_id = ?`,
      ).bind(id),
    ]);
    await audit(c, "sheet.field.delete", `項目「${field.label}」を削除しました`, { type: "sheet", id });
    return c.json({ ok: true });
  });
