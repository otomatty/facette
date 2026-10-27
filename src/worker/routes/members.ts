import { Hono } from "hono";
import { z } from "zod";
import { GENDERS, MEMBER_STATUSES } from "../../shared/constants";
import { todayJst } from "../../shared/dates";
import { canViewSensitive } from "../../shared/permissions";
import { memberInputSchema, selfProfileSchema } from "../../shared/schemas";
import { normalizeRecordData } from "../../shared/sheets";
import { normalizeForSearch } from "../../shared/text";
import type {
  FieldValue,
  MemberDetail,
  MemberSheetView,
  MemberSkill,
  MemberSummary,
  MemberTransfer,
  Paged,
} from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppContext,
  type AppEnv,
  type AuthContext,
  auth,
  badRequest,
  departmentPath,
  forbid,
  loadDepartments,
  memberInScope,
  notFound,
  parseId,
  requireAuth,
  subtreeIds,
} from "../lib/context";
import { all, type Bindable, first, insert, parseJson, placeholders, run } from "../lib/db";
import { getMemberRow, MEMBER_SELECT, type MemberRow, toSummary } from "../lib/members";
import { loadSheets, type RecordRow, sheetAccess, sheetVisibility, toRecord } from "../lib/sheets";
import { validate } from "../lib/validate";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const searchSchema = z.object({
  q: z.string().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  includeSub: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  jobTitleId: z.coerce.number().int().positive().optional(),
  gradeId: z.coerce.number().int().positive().optional(),
  employmentTypeId: z.coerce.number().int().positive().optional(),
  status: z.enum([...MEMBER_STATUSES, "all", "current"]).optional(),
  gender: z.enum(GENDERS).optional(),
  hiredFrom: z.string().optional(),
  hiredTo: z.string().optional(),
  skillId: z.coerce.number().int().positive().optional(),
  skillMin: z.coerce.number().int().min(1).max(5).optional(),
  listId: z.coerce.number().int().positive().optional(),
  fieldId: z.coerce.number().int().positive().optional(),
  fieldValue: z.string().optional(),
  columns: z.string().optional(),
  sort: z.enum(["kana", "code", "hire", "department"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
});
export type SearchQuery = z.infer<typeof searchSchema>;

/** 検索条件から WHERE 句を組み立てる（CSV 出力・分析でも利用） */
export async function buildMemberWhere(
  c: AppContext,
  a: AuthContext,
  q: Partial<SearchQuery>,
): Promise<{ where: string; params: Bindable[] }> {
  const where: string[] = [];
  const params: Bindable[] = [];
  const staffOrManager = a.user.role !== "member";
  let restrictToScope = false;

  if (q.q?.trim()) {
    const term = `%${normalizeForSearch(q.q)}%`;
    where.push(`(
      (m.last_name || m.first_name) LIKE ? OR (m.last_name_kana || m.first_name_kana) LIKE ?
      OR lower(m.employee_code) LIKE ? OR lower(coalesce(m.email, '')) LIKE ?
    )`);
    params.push(term, term, term, term);
  }
  if (q.departmentId) {
    const ids =
      q.includeSub === false ? [q.departmentId] : subtreeIds(await loadDepartments(c), q.departmentId);
    where.push("m.department_id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(ids));
  }
  if (q.jobTitleId) {
    where.push("m.job_title_id = ?");
    params.push(q.jobTitleId);
  }
  // 機微情報による絞り込みは人事・管理者・マネージャー（範囲内のみ）に限定
  if (q.gradeId && staffOrManager) {
    where.push("m.grade_id = ?");
    params.push(q.gradeId);
    restrictToScope = true;
  }
  if (q.employmentTypeId && staffOrManager) {
    where.push("m.employment_type_id = ?");
    params.push(q.employmentTypeId);
    restrictToScope = true;
  }
  if (q.gender && staffOrManager) {
    where.push("m.gender = ?");
    params.push(q.gender);
    restrictToScope = true;
  }
  const status = q.status ?? "current";
  if (status === "current") where.push("m.status IN ('active', 'leave')");
  else if (status !== "all") {
    where.push("m.status = ?");
    params.push(status);
  }
  if (q.hiredFrom) {
    where.push("m.hire_date >= ?");
    params.push(q.hiredFrom);
  }
  if (q.hiredTo) {
    where.push("m.hire_date <= ?");
    params.push(q.hiredTo);
  }
  if (q.skillId) {
    where.push(
      "EXISTS (SELECT 1 FROM member_skills ms WHERE ms.member_id = m.id AND ms.skill_id = ? AND ms.level >= ?)",
    );
    params.push(q.skillId, q.skillMin ?? 1);
  }
  if (q.listId) {
    const list = await first<{ owner_user_id: number; shared: number }>(
      c.env.DB,
      "SELECT owner_user_id, shared FROM member_lists WHERE id = ?",
      q.listId,
    );
    if (!list || (list.owner_user_id !== a.user.id && list.shared !== 1))
      notFound("社員リストが見つかりません");
    where.push("EXISTS (SELECT 1 FROM member_list_items li WHERE li.member_id = m.id AND li.list_id = ?)");
    params.push(q.listId);
  }
  if (q.fieldId && q.fieldValue !== undefined && q.fieldValue !== "") {
    const sheets = await loadSheets(c.env.DB);
    const sheet = sheets.find((s) => s.fields.some((f) => f.id === q.fieldId));
    const field = sheet?.fields.find((f) => f.id === q.fieldId);
    if (!sheet || !field) badRequest("検索条件の項目が見つかりません");
    const vis = sheetVisibility(a, sheet);
    if (vis === "none") forbid("この項目で検索する権限がありません");
    if (vis === "scope") restrictToScope = true;
    // 本人に非公開のシート（自分の評価など）では、自分が条件に一致するかも分からないようにする
    if (
      a.user.memberId !== null &&
      sheetAccess(a, sheet, { id: a.user.memberId, department_id: null }) === "none"
    ) {
      where.push("m.id <> ?");
      params.push(a.user.memberId);
    }
    const path = `$."${field.id}"`;
    if (field.type === "checkbox") {
      where.push(
        `EXISTS (SELECT 1 FROM sheet_records r WHERE r.member_id = m.id AND r.sheet_id = ? AND json_extract(r.data, '${path}') = ?)`,
      );
      params.push(sheet.id, q.fieldValue === "true" ? 1 : 0);
    } else if (field.type === "multiselect") {
      where.push(
        `EXISTS (SELECT 1 FROM sheet_records r, json_each(r.data, '${path}') je WHERE r.member_id = m.id AND r.sheet_id = ? AND je.value = ?)`,
      );
      params.push(sheet.id, q.fieldValue);
    } else if (field.type === "select") {
      where.push(
        `EXISTS (SELECT 1 FROM sheet_records r WHERE r.member_id = m.id AND r.sheet_id = ? AND json_extract(r.data, '${path}') = ?)`,
      );
      params.push(sheet.id, q.fieldValue);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM sheet_records r WHERE r.member_id = m.id AND r.sheet_id = ? AND CAST(json_extract(r.data, '${path}') AS TEXT) LIKE ?)`,
      );
      params.push(sheet.id, `%${q.fieldValue}%`);
    }
  }
  if (restrictToScope && !a.scope.all) {
    const ids = [...a.scope.departmentIds];
    const self = a.user.memberId ?? 0;
    if (ids.length) {
      where.push("(m.department_id IN (SELECT value FROM json_each(?)) OR m.id = ?)");
      params.push(JSON.stringify(ids), self);
    } else {
      where.push("m.id = ?");
      params.push(self);
    }
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export function orderBy(sort: SearchQuery["sort"]): string {
  switch (sort) {
    case "code":
      return "ORDER BY m.employee_code";
    case "hire":
      return "ORDER BY m.hire_date DESC, m.employee_code";
    case "department":
      return "ORDER BY d.sort_order, coalesce(jt.rank, 0) DESC, m.last_name_kana, m.first_name_kana";
    default:
      return "ORDER BY m.last_name_kana, m.first_name_kana, m.employee_code";
  }
}

async function loadMemberOr404(c: AppContext, id: number): Promise<MemberRow> {
  const row = await getMemberRow(c.env.DB, id);
  if (!row) notFound("社員が見つかりません");
  return row;
}

function toDetail(a: AuthContext, row: MemberRow, path: { id: number; name: string }[]): MemberDetail {
  const summary = toSummary(a, row);
  const isSelf = a.user.memberId === row.id;
  const inScope = memberInScope(a, row);
  return {
    ...summary,
    email: row.email,
    phone: row.phone,
    bio: row.bio,
    leaveDate: canViewSensitive(a.user.role, isSelf, inScope) ? row.leave_date : null,
    inScope,
    isSelf,
    canEditBasic: a.caps.manageMembers,
    canEditPhoto: a.caps.manageMembers || isSelf,
    path,
  };
}

/** 画像のマジックバイトを確認 */
function sniffImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

async function recordTransferIfChanged(
  db: D1Database,
  before: MemberRow,
  after: { departmentId?: number | null; jobTitleId?: number | null },
  note: string,
  effectiveDate = todayJst(),
) {
  const deptChanged = after.departmentId !== undefined && after.departmentId !== before.department_id;
  const jtChanged = after.jobTitleId !== undefined && after.jobTitleId !== before.job_title_id;
  if (!deptChanged && !jtChanged) return;
  await run(
    db,
    `INSERT INTO member_transfers (member_id, effective_date, from_department_id, to_department_id, from_job_title_id, to_job_title_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    before.id,
    effectiveDate,
    before.department_id,
    after.departmentId === undefined ? before.department_id : after.departmentId,
    before.job_title_id,
    after.jobTitleId === undefined ? before.job_title_id : after.jobTitleId,
    note,
  );
}

export { recordTransferIfChanged };

export const memberRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", validate("query", searchSchema), async (c) => {
    const a = auth(c);
    const q = c.req.valid("query");
    const { where, params } = await buildMemberWhere(c, a, q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 60;
    const fromSql = `FROM members m
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN job_titles jt ON jt.id = m.job_title_id
      LEFT JOIN grades g ON g.id = m.grade_id
      LEFT JOIN employment_types et ON et.id = m.employment_type_id
      ${where}`;
    const totalRow = await first<{ n: number }>(c.env.DB, `SELECT count(*) AS n ${fromSql}`, ...params);
    const rows = await all<MemberRow>(
      c.env.DB,
      `SELECT m.*, d.name AS department_name, jt.name AS job_title_name, g.name AS grade_name, et.name AS employment_type_name
       ${fromSql} ${orderBy(q.sort)} LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    const items = rows.map((r) => toSummary(a, r));

    // 一覧に追加表示するシート項目
    let extra: Record<number, Record<string, FieldValue>> | undefined;
    const columnIds = (q.columns ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 12);
    if (columnIds.length && rows.length) {
      extra = {};
      const sheets = await loadSheets(c.env.DB);
      const targetSheets = sheets.filter(
        (s) => s.kind === "single" && s.fields.some((f) => columnIds.includes(f.id)),
      );
      if (targetSheets.length) {
        const memberIds = rows.map((r) => r.id);
        const recs: RecordRow[] = [];
        for (let i = 0; i < memberIds.length; i += 80) {
          const chunk = memberIds.slice(i, i + 80);
          recs.push(
            ...(await all<RecordRow>(
              c.env.DB,
              `SELECT * FROM sheet_records WHERE sheet_id IN (${placeholders(targetSheets.length)}) AND member_id IN (${placeholders(chunk.length)})`,
              ...targetSheets.map((s) => s.id),
              ...chunk,
            )),
          );
        }
        const byMember = new Map(rows.map((r) => [r.id, r]));
        for (const rec of recs) {
          const sheet = targetSheets.find((s) => s.id === rec.sheet_id)!;
          const member = byMember.get(rec.member_id)!;
          if (sheetAccess(a, sheet, member) === "none") continue;
          const data = parseJson<Record<string, FieldValue>>(rec.data, {});
          if (!extra[rec.member_id]) extra[rec.member_id] = {};
          const target = extra[rec.member_id]!;
          for (const f of sheet.fields) {
            if (columnIds.includes(f.id)) target[String(f.id)] = data[String(f.id)] ?? null;
          }
        }
      }
    }
    const body: Paged<MemberSummary> & { extra?: typeof extra } = {
      items,
      total: totalRow?.n ?? 0,
      page,
      pageSize,
      extra,
    };
    return c.json(body);
  })
  .post("/", validate("json", memberInputSchema), async (c) => {
    const a = auth(c);
    if (!a.caps.manageMembers) forbid();
    const v = c.req.valid("json");
    const dup = await first(c.env.DB, "SELECT id FROM members WHERE employee_code = ?", v.employeeCode);
    if (dup) badRequest("同じ社員番号の社員がすでに登録されています");
    const id = await insert(
      c.env.DB,
      `INSERT INTO members (employee_code, last_name, first_name, last_name_kana, first_name_kana, email, gender,
         birth_date, hire_date, leave_date, status, department_id, job_title_id, grade_id, employment_type_id,
         phone, work_location, bio, avatar_seed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.employeeCode,
      v.lastName,
      v.firstName,
      normalizeForSearch(v.lastNameKana),
      normalizeForSearch(v.firstNameKana),
      v.email ?? null,
      v.gender,
      v.birthDate ?? null,
      v.hireDate ?? null,
      v.leaveDate ?? null,
      v.status,
      v.departmentId ?? null,
      v.jobTitleId ?? null,
      v.gradeId ?? null,
      v.employmentTypeId ?? null,
      v.phone ?? null,
      v.workLocation ?? null,
      v.bio,
      Math.floor(Math.random() * 2_000_000_000),
    );
    await audit(c, "member.create", `社員「${v.lastName} ${v.firstName}」を登録しました`, {
      type: "member",
      id,
    });
    const row = await loadMemberOr404(c, id);
    return c.json(toSummary(a, row), 201);
  })
  .get("/:id", async (c) => {
    const a = auth(c);
    const row = await loadMemberOr404(c, parseId(c.req.param("id")));
    const path = departmentPath(await loadDepartments(c), row.department_id);
    return c.json(toDetail(a, row, path));
  })
  .patch("/:id", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    const body = await c.req.json().catch(() => badRequest("リクエストの形式が正しくありません"));
    if (!a.caps.manageMembers) {
      // 本人は自己紹介・電話番号・勤務地のみ
      if (a.user.memberId !== id) forbid();
      const parsed = selfProfileSchema.safeParse(body);
      if (!parsed.success) badRequest(parsed.error.issues[0]?.message ?? "入力内容に誤りがあります");
      const v = parsed.data;
      await run(
        c.env.DB,
        `UPDATE members SET bio = coalesce(?, bio), phone = ?, work_location = ?, updated_at = datetime('now') WHERE id = ?`,
        v.bio ?? null,
        v.phone === undefined ? row.phone : v.phone,
        v.workLocation === undefined ? row.work_location : v.workLocation,
        id,
      );
      await audit(c, "member.update.self", "自分のプロフィールを更新しました", { type: "member", id });
      return c.json(
        toDetail(
          a,
          (await loadMemberOr404(c, id))!,
          departmentPath(await loadDepartments(c), row.department_id),
        ),
      );
    }
    const parsed = memberInputSchema.partial().safeParse(body);
    if (!parsed.success) badRequest(parsed.error.issues[0]?.message ?? "入力内容に誤りがあります");
    const v = parsed.data;
    if (v.employeeCode && v.employeeCode !== row.employee_code) {
      const dup = await first(
        c.env.DB,
        "SELECT id FROM members WHERE employee_code = ? AND id <> ?",
        v.employeeCode,
        id,
      );
      if (dup) badRequest("同じ社員番号の社員がすでに登録されています");
    }
    const sets: string[] = [];
    const params: Bindable[] = [];
    const map: [keyof typeof v, string, ((x: unknown) => Bindable) | undefined][] = [
      ["employeeCode", "employee_code", undefined],
      ["lastName", "last_name", undefined],
      ["firstName", "first_name", undefined],
      ["lastNameKana", "last_name_kana", (x) => normalizeForSearch(String(x))],
      ["firstNameKana", "first_name_kana", (x) => normalizeForSearch(String(x))],
      ["email", "email", undefined],
      ["gender", "gender", undefined],
      ["birthDate", "birth_date", undefined],
      ["hireDate", "hire_date", undefined],
      ["leaveDate", "leave_date", undefined],
      ["status", "status", undefined],
      ["departmentId", "department_id", undefined],
      ["jobTitleId", "job_title_id", undefined],
      ["gradeId", "grade_id", undefined],
      ["employmentTypeId", "employment_type_id", undefined],
      ["phone", "phone", undefined],
      ["workLocation", "work_location", undefined],
      ["bio", "bio", undefined],
    ];
    for (const [key, col, conv] of map) {
      if (!(key in (body as object))) continue;
      const val = v[key];
      sets.push(`${col} = ?`);
      params.push(conv ? conv(val) : ((val ?? null) as Bindable));
    }
    if (sets.length) {
      await run(
        c.env.DB,
        `UPDATE members SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
        ...params,
        id,
      );
      await recordTransferIfChanged(
        c.env.DB,
        row,
        {
          departmentId: "departmentId" in (body as object) ? (v.departmentId ?? null) : undefined,
          jobTitleId: "jobTitleId" in (body as object) ? (v.jobTitleId ?? null) : undefined,
        },
        "社員情報の編集による変更",
      );
      await audit(c, "member.update", `社員「${row.last_name} ${row.first_name}」の基本情報を更新しました`, {
        type: "member",
        id,
      });
    }
    const updated = await loadMemberOr404(c, id);
    return c.json(toDetail(a, updated, departmentPath(await loadDepartments(c), updated.department_id)));
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    if (a.user.role !== "admin") forbid("社員の削除はシステム管理者のみ行えます");
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    if (a.user.memberId === id) badRequest("自分自身は削除できません");
    await run(c.env.DB, "DELETE FROM members WHERE id = ?", id);
    await audit(
      c,
      "member.delete",
      `社員「${row.last_name} ${row.first_name}」（${row.employee_code}）を削除しました`,
      {
        type: "member",
        id,
      },
    );
    return c.json({ ok: true });
  })
  // ───────── 顔写真 ─────────
  .get("/:id/photo", async (c) => {
    auth(c);
    const id = parseId(c.req.param("id"));
    const photo = await first<{ mime: string; data: ArrayBuffer | number[] }>(
      c.env.DB,
      "SELECT mime, data FROM member_photos WHERE member_id = ?",
      id,
    );
    if (!photo) notFound("顔写真が登録されていません");
    const bytes = photo.data instanceof ArrayBuffer ? new Uint8Array(photo.data) : new Uint8Array(photo.data);
    return c.body(bytes, 200, {
      "Content-Type": photo.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  })
  .put("/:id/photo", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    if (!a.caps.manageMembers && a.user.memberId !== id) forbid();
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.byteLength === 0) badRequest("画像が空です");
    if (buf.byteLength > MAX_PHOTO_BYTES) badRequest("画像は2MB以下にしてください");
    const mime = sniffImage(buf);
    if (!mime) badRequest("JPEG・PNG・WebP の画像をアップロードしてください");
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO member_photos (member_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(member_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      ).bind(id, mime, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      c.env.DB.prepare(
        "UPDATE members SET photo_updated_at = strftime('%Y%m%d%H%M%f', 'now') WHERE id = ?",
      ).bind(id),
    ]);
    await audit(c, "member.photo.update", `「${row.last_name} ${row.first_name}」の顔写真を更新しました`, {
      type: "member",
      id,
    });
    const updated = await loadMemberOr404(c, id);
    return c.json(toSummary(a, updated));
  })
  .delete("/:id/photo", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    if (!a.caps.manageMembers && a.user.memberId !== id) forbid();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM member_photos WHERE member_id = ?").bind(id),
      c.env.DB.prepare("UPDATE members SET photo_updated_at = NULL WHERE id = ?").bind(id),
    ]);
    await audit(c, "member.photo.delete", `「${row.last_name} ${row.first_name}」の顔写真を削除しました`, {
      type: "member",
      id,
    });
    return c.json({ ok: true });
  })
  // ───────── 異動履歴 ─────────
  .get("/:id/transfers", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    if (!memberInScope(a, row)) return c.json({ items: [] as MemberTransfer[] });
    const rows = await all<{
      id: number;
      effective_date: string;
      fd: string | null;
      td: string | null;
      fj: string | null;
      tj: string | null;
      note: string;
    }>(
      c.env.DB,
      `SELECT t.id, t.effective_date, fd.name AS fd, td.name AS td, fj.name AS fj, tj.name AS tj, t.note
         FROM member_transfers t
         LEFT JOIN departments fd ON fd.id = t.from_department_id
         LEFT JOIN departments td ON td.id = t.to_department_id
         LEFT JOIN job_titles fj ON fj.id = t.from_job_title_id
         LEFT JOIN job_titles tj ON tj.id = t.to_job_title_id
        WHERE t.member_id = ? ORDER BY t.effective_date DESC, t.id DESC`,
      id,
    );
    const items: MemberTransfer[] = rows.map((r) => ({
      id: r.id,
      effectiveDate: r.effective_date,
      fromDepartmentName: r.fd,
      toDepartmentName: r.td,
      fromJobTitleName: r.fj,
      toJobTitleName: r.tj,
      note: r.note,
    }));
    return c.json({ items });
  })
  // ───────── シート ─────────
  .get("/:id/sheets", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadMemberOr404(c, id);
    const sheets = await loadSheets(c.env.DB);
    const records = await all<RecordRow>(
      c.env.DB,
      "SELECT * FROM sheet_records WHERE member_id = ? ORDER BY sort_order, id",
      id,
    );
    const isSelf = a.user.memberId === id;
    const items: MemberSheetView[] = [];
    for (const sheet of sheets) {
      const access = sheetAccess(a, sheet, row);
      if (access === "none") continue;
      items.push({
        sheet,
        access,
        records: records.filter((r) => r.sheet_id === sheet.id).map(toRecord),
        canRequestChange:
          isSelf && access === "view" && sheet.selfAccess === "view" && sheet.kind === "single",
      });
    }
    return c.json({ items });
  })
  .put("/:id/sheets/:sheetId", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const sheetId = parseId(c.req.param("sheetId"));
    const row = await loadMemberOr404(c, id);
    const sheet = (await loadSheets(c.env.DB)).find((s) => s.id === sheetId);
    if (!sheet) notFound("シートが見つかりません");
    if (sheetAccess(a, sheet, row) !== "edit") forbid("このシートを編集する権限がありません");
    if (sheet.kind !== "single") badRequest("複数レコードのシートは行単位で編集してください");
    const body = (await c.req.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
    const result = normalizeRecordData(sheet.fields, body?.data ?? {});
    if (!result.ok)
      return c.json({ error: Object.values(result.errors)[0], fieldErrors: result.errors }, 400);
    const existing = await first<{ id: number }>(
      c.env.DB,
      "SELECT id FROM sheet_records WHERE sheet_id = ? AND member_id = ? ORDER BY id LIMIT 1",
      sheetId,
      id,
    );
    if (existing) {
      await run(
        c.env.DB,
        "UPDATE sheet_records SET data = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
        JSON.stringify(result.data),
        a.user.id,
        existing.id,
      );
    } else {
      await insert(
        c.env.DB,
        "INSERT INTO sheet_records (sheet_id, member_id, data, updated_by) VALUES (?, ?, ?, ?)",
        sheetId,
        id,
        JSON.stringify(result.data),
        a.user.id,
      );
    }
    await audit(
      c,
      "sheet.record.update",
      `「${row.last_name} ${row.first_name}」の「${sheet.name}」を更新しました`,
      {
        type: "member",
        id,
      },
    );
    const rec = await first<RecordRow>(
      c.env.DB,
      "SELECT * FROM sheet_records WHERE sheet_id = ? AND member_id = ? ORDER BY id LIMIT 1",
      sheetId,
      id,
    );
    return c.json(toRecord(rec!));
  })
  .post("/:id/sheets/:sheetId/records", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const sheetId = parseId(c.req.param("sheetId"));
    const row = await loadMemberOr404(c, id);
    const sheet = (await loadSheets(c.env.DB)).find((s) => s.id === sheetId);
    if (!sheet) notFound("シートが見つかりません");
    if (sheetAccess(a, sheet, row) !== "edit") forbid("このシートを編集する権限がありません");
    if (sheet.kind !== "multi") badRequest("このシートは1件のみ登録できます");
    const body = (await c.req.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
    const result = normalizeRecordData(sheet.fields, body?.data ?? {});
    if (!result.ok)
      return c.json({ error: Object.values(result.errors)[0], fieldErrors: result.errors }, 400);
    const max = await first<{ n: number | null }>(
      c.env.DB,
      "SELECT max(sort_order) AS n FROM sheet_records WHERE sheet_id = ? AND member_id = ?",
      sheetId,
      id,
    );
    const recId = await insert(
      c.env.DB,
      "INSERT INTO sheet_records (sheet_id, member_id, data, sort_order, updated_by) VALUES (?, ?, ?, ?, ?)",
      sheetId,
      id,
      JSON.stringify(result.data),
      (max?.n ?? 0) + 1,
      a.user.id,
    );
    await audit(
      c,
      "sheet.record.create",
      `「${row.last_name} ${row.first_name}」の「${sheet.name}」に追加しました`,
      {
        type: "member",
        id,
      },
    );
    const rec = await first<RecordRow>(c.env.DB, "SELECT * FROM sheet_records WHERE id = ?", recId);
    return c.json(toRecord(rec!), 201);
  })
  .patch("/:id/sheets/:sheetId/records/:recordId", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const sheetId = parseId(c.req.param("sheetId"));
    const recordId = parseId(c.req.param("recordId"));
    const row = await loadMemberOr404(c, id);
    const sheet = (await loadSheets(c.env.DB)).find((s) => s.id === sheetId);
    if (!sheet) notFound("シートが見つかりません");
    if (sheetAccess(a, sheet, row) !== "edit") forbid("このシートを編集する権限がありません");
    const rec = await first<RecordRow>(
      c.env.DB,
      "SELECT * FROM sheet_records WHERE id = ? AND sheet_id = ? AND member_id = ?",
      recordId,
      sheetId,
      id,
    );
    if (!rec) notFound("レコードが見つかりません");
    const body = (await c.req.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
    const result = normalizeRecordData(sheet.fields, body?.data ?? {});
    if (!result.ok)
      return c.json({ error: Object.values(result.errors)[0], fieldErrors: result.errors }, 400);
    await run(
      c.env.DB,
      "UPDATE sheet_records SET data = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
      JSON.stringify(result.data),
      a.user.id,
      recordId,
    );
    await audit(
      c,
      "sheet.record.update",
      `「${row.last_name} ${row.first_name}」の「${sheet.name}」を更新しました`,
      {
        type: "member",
        id,
      },
    );
    const updated = await first<RecordRow>(c.env.DB, "SELECT * FROM sheet_records WHERE id = ?", recordId);
    return c.json(toRecord(updated!));
  })
  .delete("/:id/sheets/:sheetId/records/:recordId", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const sheetId = parseId(c.req.param("sheetId"));
    const recordId = parseId(c.req.param("recordId"));
    const row = await loadMemberOr404(c, id);
    const sheet = (await loadSheets(c.env.DB)).find((s) => s.id === sheetId);
    if (!sheet) notFound("シートが見つかりません");
    if (sheetAccess(a, sheet, row) !== "edit") forbid("このシートを編集する権限がありません");
    const res = await run(
      c.env.DB,
      "DELETE FROM sheet_records WHERE id = ? AND sheet_id = ? AND member_id = ?",
      recordId,
      sheetId,
      id,
    );
    if (!res.meta.changes) notFound("レコードが見つかりません");
    await audit(
      c,
      "sheet.record.delete",
      `「${row.last_name} ${row.first_name}」の「${sheet.name}」から削除しました`,
      {
        type: "member",
        id,
      },
    );
    return c.json({ ok: true });
  })
  // ───────── スキル ─────────
  .get("/:id/skills", async (c) => {
    auth(c);
    const id = parseId(c.req.param("id"));
    await loadMemberOr404(c, id);
    const rows = await all<{ skill_id: number; name: string; category: string; level: number }>(
      c.env.DB,
      `SELECT ms.skill_id, s.name, s.category, ms.level FROM member_skills ms JOIN skills s ON s.id = ms.skill_id
        WHERE ms.member_id = ? ORDER BY ms.level DESC, s.category, s.name`,
      id,
    );
    const items: MemberSkill[] = rows.map((r) => ({
      skillId: r.skill_id,
      name: r.name,
      category: r.category,
      level: r.level,
    }));
    return c.json({ items });
  })
  .put(
    "/:id/skills",
    validate(
      "json",
      z.object({
        skills: z
          .array(z.object({ skillId: z.number().int().positive(), level: z.number().int().min(1).max(5) }))
          .max(60),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const row = await loadMemberOr404(c, id);
      const canEdit =
        a.caps.manageMembers ||
        a.user.memberId === id ||
        (a.user.role === "manager" && memberInScope(a, row));
      if (!canEdit) forbid();
      const { skills } = c.req.valid("json");
      const statements = [c.env.DB.prepare("DELETE FROM member_skills WHERE member_id = ?").bind(id)];
      const seen = new Set<number>();
      for (const s of skills) {
        if (seen.has(s.skillId)) continue;
        seen.add(s.skillId);
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO member_skills (member_id, skill_id, level) SELECT ?, id, ? FROM skills WHERE id = ?",
          ).bind(id, s.level, s.skillId),
        );
      }
      await c.env.DB.batch(statements);
      await audit(c, "member.skills.update", `「${row.last_name} ${row.first_name}」のスキルを更新しました`, {
        type: "member",
        id,
      });
      return c.json({ ok: true });
    },
  );

export type { MemberRow };
export { MEMBER_SELECT };
