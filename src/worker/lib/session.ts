import { createMiddleware } from "hono/factory";
import type { Role } from "../../shared/constants";
import { createAuth, isDemoMode } from "./auth";
import { type AppContext, type AppEnv, buildAuthContext } from "./context";
import { first } from "./db";

export { isDemoMode };

/** リクエストごとの Better Auth インスタンス（同じリクエスト内では使い回す） */
export function getAuth(c: AppContext) {
  let a = c.get("betterAuth");
  if (!a) {
    a = createAuth(c.env, new URL(c.req.url).origin);
    c.set("betterAuth", a);
  }
  return a;
}

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  member_id: number | null;
  active: number;
  is_demo: number;
};

/** Better Auth のセッションを読み込み c.var.auth に設定する */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("auth", null);
  const { headers, response } = await getAuth(c).api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  // 有効期限の延長（スライディング）で発行し直した Cookie をレスポンスに引き継ぐ
  for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
  if (response) {
    const row = await first<UserRow>(
      c.env.DB,
      "SELECT id, email, display_name, role, member_id, active, is_demo FROM users WHERE id = ?",
      Number(response.user.id),
    );
    // デモモードを切ったあとは、公開されているデモアカウントのセッションも使えなくする
    if (row && row.active === 1 && (row.is_demo !== 1 || isDemoMode(c.env))) {
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
    }
  }
  await next();
});
