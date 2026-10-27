import { Hono } from "hono";
import { z } from "zod";
import { isIsoDate } from "../../shared/dates";
import type { OneOnOne } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppEnv,
  type AuthContext,
  auth,
  badRequest,
  forbid,
  memberInScope,
  notFound,
  parseId,
  requireAuth,
} from "../lib/context";
import { all, type Bindable, first, insert, run } from "../lib/db";
import { getMemberRow, summariesByIds } from "../lib/members";
import { validate } from "../lib/validate";

const input = z.object({
  memberId: z.number().int().positive(),
  interviewerMemberId: z.number().int().positive().nullable().optional(),
  heldOn: z.string().refine(isIsoDate, "実施日を正しく入力してください"),
  title: z.string().trim().min(1, "テーマを入力してください").max(100),
  notes: z.string().max(8000).default(""),
  nextActions: z.string().max(2000).default(""),
  condition: z.number().int().min(1).max(5).nullable().optional(),
  sharedWithMember: z.boolean().default(true),
});

type Row = {
  id: number;
  member_id: number;
  interviewer_member_id: number | null;
  held_on: string;
  title: string;
  notes: string;
  next_actions: string;
  condition: number | null;
  shared_with_member: number;
  created_by: number | null;
  updated_at: string;
  department_id: number | null;
};

function canEditRow(a: AuthContext, r: Row): boolean {
  if (a.user.role === "admin" || a.user.role === "hr") return true;
  if (r.created_by === a.user.id) return true;
  return a.user.memberId !== null && r.interviewer_member_id === a.user.memberId;
}

function canViewRow(a: AuthContext, r: Row): boolean {
  if (a.scope.all) return true;
  if (a.user.memberId === r.member_id) return r.shared_with_member === 1;
  if (a.user.memberId !== null && r.interviewer_member_id === a.user.memberId) return true;
  if (r.created_by === a.user.id) return true;
  return a.user.role === "manager" && memberInScope(a, { id: r.member_id, department_id: r.department_id });
}

async function toDtos(db: D1Database, a: AuthContext, rows: Row[]): Promise<OneOnOne[]> {
  const map = await summariesByIds(
    db,
    a,
    rows.flatMap((r) => [r.member_id, r.interviewer_member_id]),
  );
  return rows
    .filter((r) => map.has(r.member_id))
    .map((r) => ({
      id: r.id,
      memberId: r.member_id,
      member: map.get(r.member_id)!,
      interviewer: r.interviewer_member_id ? (map.get(r.interviewer_member_id) ?? null) : null,
      heldOn: r.held_on,
      title: r.title,
      notes: r.notes,
      nextActions: r.next_actions,
      // コンディションは本人には見せない
      condition: a.user.memberId === r.member_id && !a.scope.all ? null : r.condition,
      sharedWithMember: r.shared_with_member === 1,
      canEdit: canEditRow(a, r),
      updatedAt: r.updated_at,
    }));
}

const SELECT = `SELECT o.*, m.department_id FROM one_on_ones o JOIN members m ON m.id = o.member_id`;

export const oneOnOneRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get(
    "/",
    validate(
      "query",
      z.object({
        memberId: z.coerce.number().int().positive().optional(),
        mine: z.enum(["interviewer", "member"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
    ),
    async (c) => {
      const a = auth(c);
      const q = c.req.valid("query");
      const where: string[] = [];
      const params: Bindable[] = [];
      if (q.memberId) {
        where.push("o.member_id = ?");
        params.push(q.memberId);
      }
      if (q.mine === "interviewer") {
        where.push("o.interviewer_member_id = ?");
        params.push(a.user.memberId ?? -1);
      } else if (q.mine === "member") {
        where.push("o.member_id = ? AND o.shared_with_member = 1");
        params.push(a.user.memberId ?? -1);
      }
      // 権限による絞り込み（SQL で大まかに、最終判定は canViewRow）
      if (!a.scope.all) {
        const ids = [...a.scope.departmentIds];
        const conds = ["o.member_id = ?", "o.interviewer_member_id = ?", "o.created_by = ?"];
        params.push(a.user.memberId ?? -1, a.user.memberId ?? -1, a.user.id);
        if (a.user.role === "manager" && ids.length) {
          conds.push("m.department_id IN (SELECT value FROM json_each(?))");
          params.push(JSON.stringify(ids));
        }
        where.push(`(${conds.join(" OR ")})`);
      }
      const rows = await all<Row>(
        c.env.DB,
        `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.held_on DESC, o.id DESC LIMIT ?`,
        ...params,
        q.limit ?? 200,
      );
      return c.json({
        items: await toDtos(
          c.env.DB,
          a,
          rows.filter((r) => canViewRow(a, r)),
        ),
      });
    },
  )
  /** 管轄範囲の社員ごとの最終面談日（面談を記録する人向け） */
  .get("/last-held", async (c) => {
    const a = auth(c);
    if (!a.caps.writeOneOnOnes) forbid();
    const params: Bindable[] = [];
    let where = "";
    if (!a.scope.all) {
      where = "WHERE m.department_id IN (SELECT value FROM json_each(?)) OR o.interviewer_member_id = ?";
      params.push(JSON.stringify([...a.scope.departmentIds]), a.user.memberId ?? -1);
    }
    const rows = await all<{ member_id: number; last: string; n: number }>(
      c.env.DB,
      `SELECT o.member_id, max(o.held_on) AS last, count(*) AS n FROM one_on_ones o JOIN members m ON m.id = o.member_id
        ${where} GROUP BY o.member_id`,
      ...params,
    );
    return c.json({ items: rows.map((r) => ({ memberId: r.member_id, lastHeldOn: r.last, count: r.n })) });
  })
  .post("/", validate("json", input), async (c) => {
    const a = auth(c);
    if (!a.caps.writeOneOnOnes) forbid("面談記録を作成する権限がありません");
    const v = c.req.valid("json");
    const member = await getMemberRow(c.env.DB, v.memberId);
    if (!member) badRequest("対象の社員が見つかりません");
    if (!memberInScope(a, member) || a.user.memberId === v.memberId) {
      forbid("管轄外の社員の面談記録は作成できません");
    }
    const id = await insert(
      c.env.DB,
      `INSERT INTO one_on_ones (member_id, interviewer_member_id, held_on, title, notes, next_actions, condition, shared_with_member, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.memberId,
      v.interviewerMemberId ?? a.user.memberId,
      v.heldOn,
      v.title,
      v.notes,
      v.nextActions,
      v.condition ?? null,
      v.sharedWithMember,
      a.user.id,
    );
    await audit(
      c,
      "one_on_one.create",
      `「${member.last_name} ${member.first_name}」の面談記録を作成しました`,
      {
        type: "one_on_one",
        id,
      },
    );
    const row = await first<Row>(c.env.DB, `${SELECT} WHERE o.id = ?`, id);
    return c.json((await toDtos(c.env.DB, a, [row!]))[0], 201);
  })
  .patch("/:id", validate("json", input.omit({ memberId: true })), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await first<Row>(c.env.DB, `${SELECT} WHERE o.id = ?`, id);
    if (!row || !canViewRow(a, row)) notFound("面談記録が見つかりません");
    if (!canEditRow(a, row)) forbid("この面談記録を編集する権限がありません");
    const v = c.req.valid("json");
    await run(
      c.env.DB,
      `UPDATE one_on_ones SET interviewer_member_id = ?, held_on = ?, title = ?, notes = ?, next_actions = ?, condition = ?,
         shared_with_member = ?, updated_at = datetime('now') WHERE id = ?`,
      v.interviewerMemberId ?? row.interviewer_member_id,
      v.heldOn,
      v.title,
      v.notes,
      v.nextActions,
      v.condition ?? null,
      v.sharedWithMember,
      id,
    );
    const updated = await first<Row>(c.env.DB, `${SELECT} WHERE o.id = ?`, id);
    return c.json((await toDtos(c.env.DB, a, [updated!]))[0]);
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await first<Row>(c.env.DB, `${SELECT} WHERE o.id = ?`, id);
    if (!row || !canViewRow(a, row)) notFound("面談記録が見つかりません");
    if (!canEditRow(a, row)) forbid("この面談記録を削除する権限がありません");
    await run(c.env.DB, "DELETE FROM one_on_ones WHERE id = ?", id);
    await audit(c, "one_on_one.delete", "面談記録を削除しました", { type: "one_on_one", id });
    return c.json({ ok: true });
  });
