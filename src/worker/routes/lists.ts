import { Hono } from "hono";
import { z } from "zod";
import type { MemberList, MemberSummary } from "../../shared/types";
import { audit } from "../lib/audit";
import {
  type AppContext,
  type AppEnv,
  type AuthContext,
  auth,
  forbid,
  notFound,
  parseId,
  requireAuth,
} from "../lib/context";
import { all, first, insert, run } from "../lib/db";
import { MEMBER_SELECT, type MemberRow, toSummary } from "../lib/members";
import { validate } from "../lib/validate";

const listInput = z.object({
  name: z.string().trim().min(1, "リスト名を入力してください").max(60),
  description: z.string().trim().max(400).default(""),
  color: z.enum(["ai", "yamabuki", "wakaba", "beni", "fuji"]).default("ai"),
  shared: z.boolean().default(false),
});

type ListRow = {
  id: number;
  name: string;
  description: string;
  color: string;
  owner_user_id: number;
  shared: number;
  owner_name: string;
  n: number;
};

async function loadList(c: AppContext, a: AuthContext, id: number): Promise<ListRow> {
  const row = await first<ListRow>(
    c.env.DB,
    `SELECT l.*, u.display_name AS owner_name,
            (SELECT count(*) FROM member_list_items i WHERE i.list_id = l.id) AS n
       FROM member_lists l JOIN users u ON u.id = l.owner_user_id WHERE l.id = ?`,
    id,
  );
  if (!row || (row.owner_user_id !== a.user.id && row.shared !== 1)) notFound("社員リストが見つかりません");
  return row;
}

function canEdit(a: AuthContext, row: ListRow) {
  return row.owner_user_id === a.user.id || a.user.role === "admin";
}

function toList(a: AuthContext, row: ListRow, preview: MemberSummary[]): MemberList {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    shared: row.shared === 1,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    memberCount: row.n,
    isOwner: canEdit(a, row),
    previewMembers: preview,
  };
}

export const listRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    const a = auth(c);
    const rows = await all<ListRow>(
      c.env.DB,
      `SELECT l.*, u.display_name AS owner_name,
              (SELECT count(*) FROM member_list_items i WHERE i.list_id = l.id) AS n
         FROM member_lists l JOIN users u ON u.id = l.owner_user_id
        WHERE l.owner_user_id = ? OR l.shared = 1
        ORDER BY (l.owner_user_id = ?) DESC, l.updated_at DESC`,
      a.user.id,
      a.user.id,
    );
    const items: MemberList[] = [];
    for (const r of rows) {
      const preview = await all<MemberRow>(
        c.env.DB,
        `${MEMBER_SELECT} JOIN member_list_items i ON i.member_id = m.id WHERE i.list_id = ? ORDER BY i.added_at LIMIT 8`,
        r.id,
      );
      items.push(
        toList(
          a,
          r,
          preview.map((m) => toSummary(a, m)),
        ),
      );
    }
    return c.json({ items });
  })
  .post("/", validate("json", listInput), async (c) => {
    const a = auth(c);
    const v = c.req.valid("json");
    const id = await insert(
      c.env.DB,
      "INSERT INTO member_lists (name, description, color, owner_user_id, shared) VALUES (?, ?, ?, ?, ?)",
      v.name,
      v.description,
      v.color,
      a.user.id,
      v.shared,
    );
    await audit(c, "list.create", `社員リスト「${v.name}」を作成しました`, { type: "member_list", id });
    return c.json({ id }, 201);
  })
  .get("/:id", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadList(c, a, id);
    const members = await all<MemberRow>(
      c.env.DB,
      `${MEMBER_SELECT} JOIN member_list_items i ON i.member_id = m.id WHERE i.list_id = ?
        ORDER BY m.last_name_kana, m.first_name_kana`,
      id,
    );
    const summaries = members.map((m) => toSummary(a, m));
    return c.json({ list: toList(a, row, summaries.slice(0, 8)), members: summaries });
  })
  .patch("/:id", validate("json", listInput), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadList(c, a, id);
    if (!canEdit(a, row)) forbid("リストを編集できるのは作成者のみです");
    const v = c.req.valid("json");
    await run(
      c.env.DB,
      "UPDATE member_lists SET name = ?, description = ?, color = ?, shared = ?, updated_at = datetime('now') WHERE id = ?",
      v.name,
      v.description,
      v.color,
      v.shared,
      id,
    );
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const row = await loadList(c, a, id);
    if (!canEdit(a, row)) forbid("リストを削除できるのは作成者のみです");
    await run(c.env.DB, "DELETE FROM member_lists WHERE id = ?", id);
    await audit(c, "list.delete", `社員リスト「${row.name}」を削除しました`, { type: "member_list", id });
    return c.json({ ok: true });
  })
  .post(
    "/:id/members",
    validate("json", z.object({ memberIds: z.array(z.number().int().positive()).min(1).max(500) })),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const row = await loadList(c, a, id);
      if (!canEdit(a, row)) forbid("リストを編集できるのは作成者のみです");
      const { memberIds } = c.req.valid("json");
      const stmts = memberIds.map((m) =>
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO member_list_items (list_id, member_id) SELECT ?, id FROM members WHERE id = ?",
        ).bind(id, m),
      );
      for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
      await run(c.env.DB, "UPDATE member_lists SET updated_at = datetime('now') WHERE id = ?", id);
      return c.json({ ok: true });
    },
  )
  .delete("/:id/members/:memberId", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const memberId = parseId(c.req.param("memberId"));
    const row = await loadList(c, a, id);
    if (!canEdit(a, row)) forbid("リストを編集できるのは作成者のみです");
    await run(c.env.DB, "DELETE FROM member_list_items WHERE list_id = ? AND member_id = ?", id, memberId);
    return c.json({ ok: true });
  })
  /** 社員がどのリストに入っているか（自分が見られるリストのみ） */
  .get("/of-member/:memberId", async (c) => {
    const a = auth(c);
    const memberId = parseId(c.req.param("memberId"));
    const rows = await all<{ id: number; name: string; color: string }>(
      c.env.DB,
      `SELECT l.id, l.name, l.color FROM member_lists l JOIN member_list_items i ON i.list_id = l.id
        WHERE i.member_id = ? AND (l.owner_user_id = ? OR l.shared = 1) ORDER BY l.name`,
      memberId,
      a.user.id,
    );
    return c.json({ items: rows });
  });
