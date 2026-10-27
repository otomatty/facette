import { Hono } from "hono";
import { z } from "zod";
import type { DemoAccount, MeResponse } from "../../shared/types";
import { audit } from "../lib/audit";
import { type AppEnv, auth, badRequest, buildAuthContext, forbid } from "../lib/context";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { all, first, run } from "../lib/db";
import { getMemberRow, toSummary } from "../lib/members";
import { createSession, destroySession } from "../lib/session";
import { validate } from "../lib/validate";

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  role: "admin" | "hr" | "manager" | "member";
  member_id: number | null;
  active: number;
  is_demo: number;
  failed_logins: number;
  locked_until: string | null;
};

export function isDemoMode(env: Env): boolean {
  return String(env.DEMO_MODE) === "true";
}

export async function companyName(db: D1Database): Promise<string> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = 'company_name'");
  return row?.value ?? "株式会社サンプル";
}

export const authRoutes = new Hono<AppEnv>()
  .get("/demo-accounts", async (c) => {
    if (!isDemoMode(c.env)) return c.json({ accounts: [] as DemoAccount[] });
    const rows = await all<UserRow>(
      c.env.DB,
      `SELECT * FROM users WHERE is_demo = 1 AND active = 1
        ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, id`,
    );
    const accounts: DemoAccount[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      memberId: r.member_id,
    }));
    return c.json({ accounts });
  })
  .post(
    "/login",
    validate(
      "json",
      z.object({
        email: z.string().trim().min(1, "メールアドレスを入力してください"),
        password: z.string().min(1, "パスワードを入力してください"),
      }),
    ),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const user = await first<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = ?", email);
      const invalid = () => c.json({ error: "メールアドレスまたはパスワードが正しくありません" }, 401);
      if (user?.active !== 1) {
        // タイミング差を小さくするためダミーで検証
        await verifyPassword(password, "pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
        return invalid();
      }
      if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
        return c.json(
          {
            error: `ログインに続けて失敗したため一時的にロックしています。${LOCK_MINUTES}分後に再度お試しください`,
          },
          429,
        );
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        const failed = user.failed_logins + 1;
        const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
        await run(
          c.env.DB,
          "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
          lock ? 0 : failed,
          lock,
          user.id,
        );
        return invalid();
      }
      await run(
        c.env.DB,
        "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?",
        user.id,
      );
      await createSession(c, user.id);
      c.set(
        "auth",
        await buildAuthContext(c, {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          memberId: user.member_id,
          isDemo: user.is_demo === 1,
        }),
      );
      await audit(c, "login", "ログインしました", { type: "user", id: user.id });
      return c.json({ ok: true });
    },
  )
  .post("/demo-login", validate("json", z.object({ userId: z.number().int().positive() })), async (c) => {
    if (!isDemoMode(c.env)) forbid("デモモードが無効です");
    const { userId } = c.req.valid("json");
    const user = await first<UserRow>(
      c.env.DB,
      "SELECT * FROM users WHERE id = ? AND is_demo = 1 AND active = 1",
      userId,
    );
    if (!user) badRequest("デモアカウントが見つかりません");
    await run(c.env.DB, "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
    await createSession(c, user.id);
    return c.json({ ok: true });
  })
  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const a = auth(c);
    const memberRow = a.user.memberId ? await getMemberRow(c.env.DB, a.user.memberId) : null;
    const body: MeResponse = {
      user: {
        id: a.user.id,
        email: a.user.email,
        displayName: a.user.displayName,
        role: a.user.role,
        memberId: a.user.memberId,
      },
      member: memberRow ? toSummary(a, memberRow) : null,
      capabilities: a.caps,
      companyName: await companyName(c.env.DB),
      demoMode: isDemoMode(c.env),
    };
    return c.json(body);
  })
  .post(
    "/password",
    validate(
      "json",
      z.object({
        currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
        newPassword: z
          .string()
          .min(10, "新しいパスワードは10文字以上にしてください")
          .max(128, "新しいパスワードは128文字以内にしてください"),
      }),
    ),
    async (c) => {
      const a = auth(c);
      if (a.user.isDemo) forbid("デモアカウントのパスワードは変更できません");
      const { currentPassword, newPassword } = c.req.valid("json");
      const user = await first<UserRow>(c.env.DB, "SELECT * FROM users WHERE id = ?", a.user.id);
      if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
        badRequest("現在のパスワードが正しくありません");
      }
      await run(
        c.env.DB,
        "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
        await hashPassword(newPassword),
        a.user.id,
      );
      await audit(c, "password.change", "パスワードを変更しました", { type: "user", id: a.user.id });
      return c.json({ ok: true });
    },
  );
