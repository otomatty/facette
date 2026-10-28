import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { first, run } from "./db";

/** デモモード（ログイン画面にデモアカウントを表示し、ワンクリックでログインできる） */
export function isDemoMode(env: Env): boolean {
  return String(env.DEMO_MODE) === "true";
}

/** Google の OAuth クライアントが設定されているか */
export function isGoogleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

const SESSION_DAYS = 14;

type LoginUserRow = { active: number; is_demo: number; display_name: string };

/**
 * セッションを作ってよいユーザーか。無効なユーザーと、デモモードでないときの公開デモアカウントは拒否する。
 * Google ログインの場合は、拒否の理由がエラーコードとしてログイン画面へ戻される。
 */
async function assertCanSignIn(env: Env, userId: number): Promise<LoginUserRow> {
  const user = await first<LoginUserRow>(
    env.DB,
    "SELECT active, is_demo, display_name FROM users WHERE id = ?",
    userId,
  );
  if (user?.active !== 1 || (user.is_demo === 1 && !isDemoMode(env))) {
    throw new APIError("FORBIDDEN", { code: "account_disabled", message: "このアカウントは利用できません" });
  }
  return user;
}

/** デモアカウントでのワンクリックログイン（デモモードの間だけ） */
function demoLogin(env: Env) {
  return {
    id: "facette-demo-login",
    endpoints: {
      demoLogin: createAuthEndpoint(
        "/demo-login",
        { method: "POST", body: z.object({ userId: z.number().int().positive() }) },
        async (ctx) => {
          if (!isDemoMode(env)) {
            throw new APIError("FORBIDDEN", { code: "demo_disabled", message: "デモモードが無効です" });
          }
          const demo = await first<{ id: number }>(
            env.DB,
            "SELECT id FROM users WHERE id = ? AND is_demo = 1 AND active = 1",
            ctx.body.userId,
          );
          if (!demo) {
            throw new APIError("BAD_REQUEST", {
              code: "demo_account_not_found",
              message: "デモアカウントが見つかりません",
            });
          }
          const user = await ctx.context.internalAdapter.findUserById(String(demo.id));
          const session = await ctx.context.internalAdapter.createSession(String(demo.id));
          if (!user || !session) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: "ログインできませんでした" });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  } as const;
}

/**
 * Better Auth のインスタンス。ログインは Google アカウントのみで、
 * システム管理者が登録したユーザーとメールアドレスが一致する場合にだけログインできる（新規登録は不可）。
 */
export function createAuth(env: Env, origin: string) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET が設定されていません");
  return betterAuth({
    appName: "Facette",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    socialProviders: isGoogleConfigured(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
            disableSignUp: true,
          },
        }
      : {},
    user: {
      modelName: "users",
      fields: {
        name: "display_name",
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      expiresIn: SESSION_DAYS * 86400,
      updateAge: 86400,
    },
    account: {
      modelName: "accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // 登録済みユーザーと同じメールアドレスの Google アカウントは、初回ログイン時にひもづける
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: {
      modelName: "verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await assertCanSignIn(env, Number(session.userId));
          },
          after: async (session, ctx) => {
            const user = await first<LoginUserRow>(
              env.DB,
              "SELECT active, is_demo, display_name FROM users WHERE id = ?",
              Number(session.userId),
            );
            await run(
              env.DB,
              "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
              Number(session.userId),
            );
            // デモアカウントのワンクリックログインは記録しない
            if (!user || user.is_demo === 1) return;
            await run(
              env.DB,
              "INSERT INTO audit_logs (user_id, user_name, action, target_type, target_id, summary, ip) VALUES (?, ?, 'login', 'user', ?, 'ログインしました', ?)",
              Number(session.userId),
              user.display_name,
              Number(session.userId),
              ctx?.request?.headers.get("cf-connecting-ip") ?? null,
            ).catch((e) => console.error("audit log failed", e));
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "facette",
      // 既存のテーブルに合わせて、ID は D1 の自動採番を使う
      database: { generateId: "serial", validateSchema: false },
    },
    telemetry: { enabled: false },
    plugins: [demoLogin(env)],
  });
}

export type Auth = ReturnType<typeof createAuth>;
