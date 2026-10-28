import { Hono } from "hono";
import type { DemoAccount, LoginOptions, MeResponse } from "../../shared/types";
import { isGoogleConfigured } from "../lib/auth";
import { type AppEnv, auth } from "../lib/context";
import { all, first } from "../lib/db";
import { getMemberRow, toSummary } from "../lib/members";
import { isDemoMode } from "../lib/session";

type DemoUserRow = {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "hr" | "manager" | "member";
  member_id: number | null;
  avatar_seed: number | null;
  department_name: string | null;
  job_title_name: string | null;
};

export { isDemoMode };

export async function companyName(db: D1Database): Promise<string> {
  const row = await first<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = 'company_name'");
  return row?.value ?? "株式会社サンプル";
}

/**
 * ログイン・ログアウトなどは Better Auth（/api/auth/*）が処理する。
 * ここではログイン画面の表示に使う情報と、ログイン中のユーザー情報を返す。
 */
export const authRoutes = new Hono<AppEnv>()
  .get("/login-options", async (c) => {
    const demoAccounts: DemoAccount[] = [];
    if (isDemoMode(c.env)) {
      const rows = await all<DemoUserRow>(
        c.env.DB,
        `SELECT u.id, u.email, u.display_name, u.role, u.member_id, m.avatar_seed,
                d.name AS department_name, jt.name AS job_title_name
           FROM users u
           LEFT JOIN members m ON m.id = u.member_id
           LEFT JOIN departments d ON d.id = m.department_id
           LEFT JOIN job_titles jt ON jt.id = m.job_title_id
          WHERE u.is_demo = 1 AND u.active = 1
          ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.id`,
      );
      for (const r of rows) {
        demoAccounts.push({
          id: r.id,
          email: r.email,
          displayName: r.display_name,
          role: r.role,
          memberId: r.member_id,
          avatarSeed: r.avatar_seed,
          subtitle: [r.department_name, r.job_title_name].filter(Boolean).join(" / ") || null,
        });
      }
    }
    const body: LoginOptions = { google: isGoogleConfigured(c.env), demoAccounts };
    return c.json(body);
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
      scopeDepartmentIds: a.scope.all ? null : [...a.scope.departmentIds],
      companyName: await companyName(c.env.DB),
      demoMode: isDemoMode(c.env),
    };
    return c.json(body);
  });
