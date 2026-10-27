import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Role } from "../../shared/constants";
import { type AppContext, type AppEnv, buildAuthContext } from "./context";
import { randomToken, sha256Hex } from "./crypto";
import { first, run } from "./db";

export const SESSION_COOKIE = "facette_session";
const SESSION_DAYS = 14;
const RENEW_THRESHOLD_MS = 7 * 86400_000;

function isSecure(c: AppContext): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export async function createSession(c: AppContext, userId: number): Promise<void> {
  const token = randomToken();
  const id = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await run(
    c.env.DB,
    "INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)",
    id,
    userId,
    expires.toISOString(),
    (c.req.header("user-agent") ?? "").slice(0, 200),
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await run(c.env.DB, "DELETE FROM sessions WHERE id = ?", await sha256Hex(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecure(c) });
}

type SessionRow = {
  session_id: string;
  expires_at: string;
  id: number;
  email: string;
  display_name: string;
  role: Role;
  member_id: number | null;
  is_demo: number;
};

/** Cookie からセッションを読み込み c.var.auth に設定する */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("auth", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    const row = await first<SessionRow>(
      c.env.DB,
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name, u.role, u.member_id, u.is_demo
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND u.active = 1`,
      id,
    );
    if (row && Date.parse(row.expires_at) > Date.now()) {
      c.set(
        "auth",
        await buildAuthContext(c, {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          memberId: row.member_id,
          isDemo: row.is_demo === 1,
        }),
      );
      // 有効期限が近ければ延長（スライディング）
      if (Date.parse(row.expires_at) - Date.now() < RENEW_THRESHOLD_MS) {
        const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
        await run(c.env.DB, "UPDATE sessions SET expires_at = ? WHERE id = ?", expires.toISOString(), id);
        setCookie(c, SESSION_COOKIE, token, {
          httpOnly: true,
          secure: isSecure(c),
          sameSite: "Lax",
          path: "/",
          expires,
        });
      }
    } else if (row) {
      await run(c.env.DB, "DELETE FROM sessions WHERE id = ?", id);
    }
  }
  await next();
});
