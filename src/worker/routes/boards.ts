import { Hono } from "hono";
import { z } from "zod";
import type { BoardData, TeamBoard, TeamBoardSummary } from "../../shared/types";
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
import { all, first, insert, parseJson, run } from "../lib/db";
import { summariesByIds } from "../lib/members";
import { validate } from "../lib/validate";

const EMPTY: BoardData = { items: [], groups: [], notes: [] };
const coord = z.number().min(-1000).max(20000);

const dataSchema = z.object({
  items: z
    .array(z.object({ memberId: z.number().int().positive(), x: coord, y: coord }))
    .max(500, "1つのキャンバスに置けるのは500名までです"),
  groups: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().max(60),
        x: coord,
        y: coord,
        w: z.number().min(80).max(5000),
        h: z.number().min(60).max(5000),
        color: z.enum(["ai", "yamabuki", "wakaba", "beni", "fuji", "neutral"]),
      }),
    )
    .max(60),
  notes: z
    .array(z.object({ id: z.string().min(1).max(40), text: z.string().max(400), x: coord, y: coord }))
    .max(60),
});

const boardInput = z.object({
  name: z.string().trim().min(1, "キャンバス名を入力してください").max(60),
  description: z.string().trim().max(400).default(""),
  shared: z.boolean().default(false),
});

type Row = {
  id: number;
  name: string;
  description: string;
  owner_user_id: number;
  shared: number;
  data: string;
  owner_name: string;
  updated_at: string;
};

const SELECT =
  "SELECT b.*, u.display_name AS owner_name FROM team_boards b JOIN users u ON u.id = b.owner_user_id";

function canEdit(a: AuthContext, r: Row) {
  return r.owner_user_id === a.user.id || a.user.role === "admin";
}

async function load(c: AppContext, a: AuthContext, id: number): Promise<Row> {
  const r = await first<Row>(c.env.DB, `${SELECT} WHERE b.id = ?`, id);
  if (!r || (r.owner_user_id !== a.user.id && r.shared !== 1)) notFound("キャンバスが見つかりません");
  return r;
}

async function toBoard(c: AppContext, a: AuthContext, r: Row, full: boolean): Promise<TeamBoard> {
  const data = parseJson<BoardData>(r.data, EMPTY);
  const ids = full ? data.items.map((i) => i.memberId) : data.items.slice(0, 8).map((i) => i.memberId);
  const map = await summariesByIds(c.env.DB, a, ids);
  // 削除された社員は取り除く
  const items = data.items.filter((i) => map.has(i.memberId) || !full);
  const summary: TeamBoardSummary = {
    id: r.id,
    name: r.name,
    description: r.description,
    shared: r.shared === 1,
    isOwner: canEdit(a, r),
    ownerName: r.owner_name,
    memberCount: data.items.length,
    groupCount: data.groups.length,
    previewMembers: data.items
      .slice(0, 8)
      .map((i) => map.get(i.memberId))
      .filter((m) => !!m),
    updatedAt: r.updated_at,
  };
  return { ...summary, data: { ...data, items }, members: full ? [...map.values()] : [] };
}

export const boardRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    const a = auth(c);
    const rows = await all<Row>(
      c.env.DB,
      `${SELECT} WHERE b.owner_user_id = ? OR b.shared = 1 ORDER BY (b.owner_user_id = ?) DESC, b.updated_at DESC`,
      a.user.id,
      a.user.id,
    );
    const items: TeamBoardSummary[] = [];
    for (const r of rows) {
      const { data: _d, members: _m, ...summary } = await toBoard(c, a, r, false);
      items.push(summary);
    }
    return c.json({ items });
  })
  .post("/", validate("json", boardInput), async (c) => {
    const a = auth(c);
    const v = c.req.valid("json");
    const id = await insert(
      c.env.DB,
      "INSERT INTO team_boards (name, description, owner_user_id, shared) VALUES (?, ?, ?, ?)",
      v.name,
      v.description,
      a.user.id,
      v.shared,
    );
    await audit(c, "board.create", `チームキャンバス「${v.name}」を作成しました`, { type: "team_board", id });
    return c.json({ id }, 201);
  })
  .get("/:id", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    return c.json(await toBoard(c, a, r, true));
  })
  .put("/:id", validate("json", boardInput.extend({ data: dataSchema })), async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    if (!canEdit(a, r)) forbid("キャンバスを編集できるのは作成者のみです");
    const v = c.req.valid("json");
    // 同じ社員を2回置かない
    const seen = new Set<number>();
    const items = v.data.items.filter((i) => {
      if (seen.has(i.memberId)) return false;
      seen.add(i.memberId);
      return true;
    });
    await run(
      c.env.DB,
      "UPDATE team_boards SET name = ?, description = ?, shared = ?, data = ?, updated_at = datetime('now') WHERE id = ?",
      v.name,
      v.description,
      v.shared,
      JSON.stringify({ ...v.data, items }),
      r.id,
    );
    return c.json({ ok: true });
  })
  .post("/:id/duplicate", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    const id = await insert(
      c.env.DB,
      "INSERT INTO team_boards (name, description, owner_user_id, shared, data) VALUES (?, ?, ?, 0, ?)",
      `${r.name}（コピー）`,
      r.description,
      a.user.id,
      r.data,
    );
    return c.json({ id }, 201);
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    const r = await load(c, a, parseId(c.req.param("id")));
    if (!canEdit(a, r)) forbid("キャンバスを削除できるのは作成者のみです");
    await run(c.env.DB, "DELETE FROM team_boards WHERE id = ?", r.id);
    await audit(c, "board.delete", `チームキャンバス「${r.name}」を削除しました`, {
      type: "team_board",
      id: r.id,
    });
    return c.json({ ok: true });
  });
