import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "../../shared/constants";
import { normalizeRecordData } from "../../shared/sheets";
import type { AppUser, AuditLog, ChangeRequest, FieldValue } from "../../shared/types";
import { audit } from "../lib/audit";
import {
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
import { hashPassword } from "../lib/crypto";
import { all, type Bindable, first, insert, parseJson, run } from "../lib/db";
import { getMemberRow, summariesByIds } from "../lib/members";
import { loadSheets, sheetAccess } from "../lib/sheets";
import { validate } from "../lib/validate";
import { loadAnnouncements } from "./home";

// ───────── ユーザー管理 ─────────
const passwordSchema = z.string().min(10, "パスワードは10文字以上にしてください").max(128);
const userInput = z.object({
  email: z.string().trim().email("メールアドレスの形式が正しくありません").max(200),
  displayName: z.string().trim().min(1, "表示名を入力してください").max(60),
  role: z.enum(ROLES),
  memberId: z.number().int().positive().nullable(),
  active: z.boolean().default(true),
});

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  role: AppUser["role"];
  member_id: number | null;
  active: number;
  last_login_at: string | null;
  created_at: string;
};

export const userRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("manageUsers"))
  .get("/", async (c) => {
    const a = auth(c);
    const rows = await all<UserRow>(c.env.DB, "SELECT * FROM users ORDER BY active DESC, role, id");
    const map = await summariesByIds(
      c.env.DB,
      a,
      rows.map((r) => r.member_id),
    );
    const items: AppUser[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      memberId: r.member_id,
      member: r.member_id ? (map.get(r.member_id) ?? null) : null,
      active: r.active === 1,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
    }));
    return c.json({ items });
  })
  .post("/", validate("json", userInput.extend({ password: passwordSchema })), async (c) => {
    const v = c.req.valid("json");
    if (await first(c.env.DB, "SELECT id FROM users WHERE email = ?", v.email))
      badRequest("このメールアドレスはすでに使われています");
    if (v.memberId && (await first(c.env.DB, "SELECT id FROM users WHERE member_id = ?", v.memberId))) {
      badRequest("この社員にはすでにアカウントがあります");
    }
    const id = await insert(
      c.env.DB,
      "INSERT INTO users (email, display_name, password_hash, role, member_id, active) VALUES (?, ?, ?, ?, ?, ?)",
      v.email,
      v.displayName,
      await hashPassword(v.password),
      v.role,
      v.memberId,
      v.active,
    );
    await audit(c, "user.create", `ユーザー「${v.displayName}」（${v.email}）を作成しました`, {
      type: "user",
      id,
    });
    return c.json({ id }, 201);
  })
  .patch("/:id", validate("json", userInput), async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    if (id === a.user.id && (v.role !== "admin" || !v.active)) {
      badRequest("自分自身の管理者権限を外したり、無効にすることはできません");
    }
    if (await first(c.env.DB, "SELECT id FROM users WHERE email = ? AND id <> ?", v.email, id)) {
      badRequest("このメールアドレスはすでに使われています");
    }
    if (
      v.memberId &&
      (await first(c.env.DB, "SELECT id FROM users WHERE member_id = ? AND id <> ?", v.memberId, id))
    ) {
      badRequest("この社員にはすでにアカウントがあります");
    }
    const res = await run(
      c.env.DB,
      "UPDATE users SET email = ?, display_name = ?, role = ?, member_id = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
      v.email,
      v.displayName,
      v.role,
      v.memberId,
      v.active,
      id,
    );
    if (!res.meta.changes) notFound("ユーザーが見つかりません");
    if (!v.active) await run(c.env.DB, "DELETE FROM sessions WHERE user_id = ?", id);
    await audit(c, "user.update", `ユーザー「${v.displayName}」を更新しました（ロール: ${v.role}）`, {
      type: "user",
      id,
    });
    return c.json({ ok: true });
  })
  .post("/:id/password", validate("json", z.object({ password: passwordSchema })), async (c) => {
    const id = parseId(c.req.param("id"));
    const u = await first<{ display_name: string; is_demo: number }>(
      c.env.DB,
      "SELECT display_name, is_demo FROM users WHERE id = ?",
      id,
    );
    if (!u) notFound("ユーザーが見つかりません");
    if (u.is_demo) forbid("デモアカウントのパスワードは変更できません");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?",
      ).bind(await hashPassword(c.req.valid("json").password), id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    ]);
    await audit(c, "user.password.reset", `ユーザー「${u.display_name}」のパスワードを再設定しました`, {
      type: "user",
      id,
    });
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    if (id === a.user.id) badRequest("自分自身は削除できません");
    const u = await first<{ display_name: string }>(
      c.env.DB,
      "SELECT display_name FROM users WHERE id = ?",
      id,
    );
    if (!u) notFound("ユーザーが見つかりません");
    await run(c.env.DB, "DELETE FROM users WHERE id = ?", id);
    await audit(c, "user.delete", `ユーザー「${u.display_name}」を削除しました`, { type: "user", id });
    return c.json({ ok: true });
  });

// ───────── 操作ログ ─────────
export const auditRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("viewAuditLogs"))
  .get(
    "/",
    validate(
      "query",
      z.object({
        q: z.string().optional(),
        action: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      const where: string[] = [];
      const params: Bindable[] = [];
      if (q.q) {
        where.push("(summary LIKE ? OR user_name LIKE ?)");
        params.push(`%${q.q}%`, `%${q.q}%`);
      }
      if (q.action) {
        where.push("action LIKE ?");
        params.push(`${q.action}%`);
      }
      const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const total = await first<{ n: number }>(
        c.env.DB,
        `SELECT count(*) AS n FROM audit_logs ${w}`,
        ...params,
      );
      const rows = await all<{
        id: number;
        user_name: string;
        action: string;
        target_type: string;
        target_id: number | null;
        summary: string;
        ip: string | null;
        created_at: string;
      }>(
        c.env.DB,
        `SELECT * FROM audit_logs ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        ...params,
        q.pageSize,
        (q.page - 1) * q.pageSize,
      );
      const items: AuditLog[] = rows.map((r) => ({
        id: r.id,
        userName: r.user_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        summary: r.summary,
        ip: r.ip,
        createdAt: r.created_at,
      }));
      return c.json({ items, total: total?.n ?? 0, page: q.page, pageSize: q.pageSize });
    },
  );

// ───────── 会社設定 ─────────
export const settingRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    const rows = await all<{ key: string; value: string }>(c.env.DB, "SELECT * FROM app_settings");
    return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  })
  .put(
    "/",
    requireCap("manageUsers"),
    validate("json", z.object({ companyName: z.string().trim().min(1, "会社名を入力してください").max(60) })),
    async (c) => {
      const v = c.req.valid("json");
      await run(
        c.env.DB,
        "INSERT INTO app_settings (key, value) VALUES ('company_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        v.companyName,
      );
      await audit(c, "settings.update", `会社名を「${v.companyName}」に変更しました`);
      return c.json({ ok: true });
    },
  );

// ───────── お知らせ ─────────
const announcementInput = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください").max(100),
  body: z.string().trim().max(4000).default(""),
  pinned: z.boolean().default(false),
});

export const announcementRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (c) => {
    auth(c);
    return c.json({ items: await loadAnnouncements(c.env.DB, 100) });
  })
  .post("/", requireCap("manageAnnouncements"), validate("json", announcementInput), async (c) => {
    const a = auth(c);
    const v = c.req.valid("json");
    if (v.pinned) await assertPinnable(c.env.DB);
    const id = await insert(
      c.env.DB,
      "INSERT INTO announcements (title, body, pinned, created_by) VALUES (?, ?, ?, ?)",
      v.title,
      v.body,
      v.pinned,
      a.user.id,
    );
    await audit(c, "announcement.create", `お知らせ「${v.title}」を投稿しました`, {
      type: "announcement",
      id,
    });
    return c.json({ id }, 201);
  })
  .patch("/:id", requireCap("manageAnnouncements"), validate("json", announcementInput), async (c) => {
    const id = parseId(c.req.param("id"));
    const v = c.req.valid("json");
    if (v.pinned) await assertPinnable(c.env.DB, id);
    const res = await run(
      c.env.DB,
      "UPDATE announcements SET title = ?, body = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?",
      v.title,
      v.body,
      v.pinned,
      id,
    );
    if (!res.meta.changes) notFound("お知らせが見つかりません");
    await audit(c, "announcement.update", `お知らせ「${v.title}」を更新しました`, {
      type: "announcement",
      id,
    });
    return c.json({ ok: true });
  })
  .delete("/:id", requireCap("manageAnnouncements"), async (c) => {
    const id = parseId(c.req.param("id"));
    const row = await first<{ title: string }>(c.env.DB, "SELECT title FROM announcements WHERE id = ?", id);
    if (!row) notFound("お知らせが見つかりません");
    await run(c.env.DB, "DELETE FROM announcements WHERE id = ?", id);
    await audit(c, "announcement.delete", `お知らせ「${row.title}」を削除しました`, {
      type: "announcement",
      id,
    });
    return c.json({ ok: true });
  });

/** ホームのお知らせ枠を固定表示で埋めないよう、固定できる件数に上限を設ける */
export const MAX_PINNED_ANNOUNCEMENTS = 3;
async function assertPinnable(db: D1Database, exceptId?: number) {
  const row = await first<{ n: number }>(
    db,
    "SELECT count(*) AS n FROM announcements WHERE pinned = 1 AND id <> ?",
    exceptId ?? -1,
  );
  if ((row?.n ?? 0) >= MAX_PINNED_ANNOUNCEMENTS)
    badRequest(
      `上部に固定できるお知らせは${MAX_PINNED_ANNOUNCEMENTS}件までです。ほかのお知らせの固定を外してください`,
    );
}

// ───────── 変更申請 ─────────
type RequestRow = {
  id: number;
  member_id: number;
  requester_name: string | null;
  sheet_id: number;
  sheet_name: string;
  record_id: number | null;
  payload: string;
  reason: string;
  status: ChangeRequest["status"];
  reviewer_name: string | null;
  review_comment: string;
  created_at: string;
  reviewed_at: string | null;
  requester_user_id: number | null;
  before_data: string | null;
};

const REQUEST_SELECT = `SELECT r.*, s.name AS sheet_name, ru.display_name AS requester_name, vu.display_name AS reviewer_name
  FROM change_requests r JOIN sheets s ON s.id = r.sheet_id
  LEFT JOIN users ru ON ru.id = r.requester_user_id LEFT JOIN users vu ON vu.id = r.reviewer_user_id`;

async function toRequests(db: D1Database, a: AuthContext, rows: RequestRow[]): Promise<ChangeRequest[]> {
  const map = await summariesByIds(
    db,
    a,
    rows.map((r) => r.member_id),
  );
  const sheets = await loadSheets(db);
  const out: ChangeRequest[] = [];
  for (const r of rows) {
    const member = map.get(r.member_id);
    const sheet = sheets.find((s) => s.id === r.sheet_id);
    if (!member || !sheet) continue;
    // 申請時点の値があればそれを、なければ（古い申請）現在の値を変更前として扱う
    const rec = r.before_data
      ? { data: r.before_data }
      : await first<{ data: string }>(
          db,
          "SELECT data FROM sheet_records WHERE sheet_id = ? AND member_id = ? ORDER BY id LIMIT 1",
          r.sheet_id,
          r.member_id,
        );
    out.push({
      id: r.id,
      member,
      requesterName: r.requester_name ?? `${member.lastName} ${member.firstName}`,
      sheetId: r.sheet_id,
      sheetName: r.sheet_name,
      recordId: r.record_id,
      payload: parseJson<Record<string, FieldValue>>(r.payload, {}),
      before: rec ? parseJson<Record<string, FieldValue>>(rec.data, {}) : null,
      fields: sheet.fields,
      reason: r.reason,
      status: r.status,
      reviewerName: r.reviewer_name,
      reviewComment: r.review_comment,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    });
  }
  return out;
}

export const requestRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get(
    "/",
    validate(
      "query",
      z.object({ status: z.enum(["pending", "approved", "rejected", "withdrawn", "all"]).default("all") }),
    ),
    async (c) => {
      const a = auth(c);
      const { status } = c.req.valid("query");
      const where: string[] = [];
      const params: Bindable[] = [];
      if (status !== "all") {
        where.push("r.status = ?");
        params.push(status);
      }
      if (!a.caps.reviewRequests) {
        where.push("r.member_id = ?");
        params.push(a.user.memberId ?? -1);
      }
      const rows = await all<RequestRow>(
        c.env.DB,
        `${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`,
        ...params,
      );
      return c.json({ items: await toRequests(c.env.DB, a, rows) });
    },
  )
  .post(
    "/",
    validate(
      "json",
      z.object({
        sheetId: z.number().int().positive(),
        data: z.record(z.string(), z.unknown()),
        reason: z.string().trim().min(1, "申請理由を入力してください").max(1000),
      }),
    ),
    async (c) => {
      const a = auth(c);
      if (!a.user.memberId) forbid("社員情報にひもづいていないアカウントでは申請できません");
      const v = c.req.valid("json");
      const sheet = (await loadSheets(c.env.DB)).find((s) => s.id === v.sheetId);
      if (!sheet) notFound("シートが見つかりません");
      const member = await getMemberRow(c.env.DB, a.user.memberId);
      if (!member) notFound();
      if (
        sheet.kind !== "single" ||
        sheet.selfAccess !== "view" ||
        sheetAccess(a, sheet, member) !== "view"
      ) {
        badRequest("このシートは申請の対象ではありません");
      }
      const result = normalizeRecordData(sheet.fields, v.data);
      if (!result.ok)
        return c.json({ error: Object.values(result.errors)[0], fieldErrors: result.errors }, 400);
      const dup = await first(
        c.env.DB,
        "SELECT id FROM change_requests WHERE member_id = ? AND sheet_id = ? AND status = 'pending'",
        member.id,
        sheet.id,
      );
      if (dup) badRequest("このシートには承認待ちの申請があります。取り下げてから再度申請してください");
      const current = await first<{ data: string }>(
        c.env.DB,
        "SELECT data FROM sheet_records WHERE sheet_id = ? AND member_id = ? ORDER BY id LIMIT 1",
        sheet.id,
        member.id,
      );
      const id = await insert(
        c.env.DB,
        "INSERT INTO change_requests (member_id, requester_user_id, sheet_id, payload, reason, before_data) VALUES (?, ?, ?, ?, ?, ?)",
        member.id,
        a.user.id,
        sheet.id,
        JSON.stringify(result.data),
        v.reason,
        current?.data ?? "{}",
      );
      await audit(c, "request.create", `「${sheet.name}」の変更を申請しました`, {
        type: "change_request",
        id,
      });
      return c.json({ id }, 201);
    },
  )
  .post(
    "/:id/approve",
    requireCap("reviewRequests"),
    validate("json", z.object({ comment: z.string().max(1000).default("") })),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const r = await first<RequestRow>(c.env.DB, `${REQUEST_SELECT} WHERE r.id = ?`, id);
      if (!r) notFound("申請が見つかりません");
      if (r.status !== "pending") badRequest("この申請はすでに処理されています");
      const payload = parseJson<Record<string, FieldValue>>(r.payload, {});
      const rec = await first<{ id: number; data: string }>(
        c.env.DB,
        "SELECT id, data FROM sheet_records WHERE sheet_id = ? AND member_id = ? ORDER BY id LIMIT 1",
        r.sheet_id,
        r.member_id,
      );
      const merged = { ...(rec ? parseJson<Record<string, FieldValue>>(rec.data, {}) : {}), ...payload };
      await c.env.DB.batch([
        rec
          ? c.env.DB.prepare(
              "UPDATE sheet_records SET data = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
            ).bind(JSON.stringify(merged), a.user.id, rec.id)
          : c.env.DB.prepare(
              "INSERT INTO sheet_records (sheet_id, member_id, data, updated_by) VALUES (?, ?, ?, ?)",
            ).bind(r.sheet_id, r.member_id, JSON.stringify(merged), a.user.id),
        c.env.DB.prepare(
          "UPDATE change_requests SET status = 'approved', reviewer_user_id = ?, review_comment = ?, reviewed_at = datetime('now') WHERE id = ?",
        ).bind(a.user.id, c.req.valid("json").comment, id),
      ]);
      await audit(c, "request.approve", `「${r.sheet_name}」の変更申請を承認しました`, {
        type: "change_request",
        id,
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/reject",
    requireCap("reviewRequests"),
    validate(
      "json",
      z.object({ comment: z.string().trim().min(1, "却下の理由を入力してください").max(1000) }),
    ),
    async (c) => {
      const a = auth(c);
      const id = parseId(c.req.param("id"));
      const res = await run(
        c.env.DB,
        "UPDATE change_requests SET status = 'rejected', reviewer_user_id = ?, review_comment = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'",
        a.user.id,
        c.req.valid("json").comment,
        id,
      );
      if (!res.meta.changes) badRequest("この申請はすでに処理されています");
      await audit(c, "request.reject", "変更申請を却下しました", { type: "change_request", id });
      return c.json({ ok: true });
    },
  )
  .post("/:id/withdraw", async (c) => {
    const a = auth(c);
    const id = parseId(c.req.param("id"));
    const res = await run(
      c.env.DB,
      "UPDATE change_requests SET status = 'withdrawn', reviewed_at = datetime('now') WHERE id = ? AND status = 'pending' AND member_id = ?",
      id,
      a.user.memberId ?? -1,
    );
    if (!res.meta.changes) badRequest("取り下げできる申請ではありません");
    return c.json({ ok: true });
  });
