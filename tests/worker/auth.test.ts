import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginOptions, MeResponse } from "../../src/shared/types";
import { anon, BASE_URL, login, seedBasic } from "./helpers";

beforeEach(seedBasic);
afterEach(() => vi.restoreAllMocks());

function demoLogin(userId: number) {
  return SELF.fetch(`${BASE_URL}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ userId }),
  });
}

function cookiesOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

function base64url(json: unknown): string {
  return btoa(JSON.stringify(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Google のトークンエンドポイントを差し替え、指定したアカウントでログインしたことにする */
type GoogleProfile = { sub: string; email: string; name: string; email_verified?: boolean };

function mockGoogle(profile: GoogleProfile) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        base64url({ alg: "RS256", typ: "JWT" }),
        base64url({
          iss: "https://accounts.google.com",
          aud: "test",
          iat: now,
          exp: now + 3600,
          email_verified: true,
          ...profile,
        }),
        "signature",
      ].join(".");
      return Response.json({
        access_token: "access",
        id_token: idToken,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    return realFetch(input, init);
  });
}

/** Google ログインを始めてからコールバックが返るまでを再現し、コールバックの応答を返す */
async function googleLogin(profile: GoogleProfile) {
  mockGoogle(profile);
  const start = await anon.fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { origin: BASE_URL },
    json: { provider: "google", callbackURL: "/members", errorCallbackURL: "/login" },
  });
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  return SELF.fetch(
    `${BASE_URL}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
    {
      headers: { cookie: cookiesOf(start) },
      redirect: "manual",
    },
  );
}

describe("Google ログイン", () => {
  it("登録済みのメールアドレスなら Google アカウントをひもづけてログインできる", async () => {
    const res = await googleLogin({ sub: "google-taro", email: "Taro@test.jp", name: "Taro Yamada" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/members");
    const me = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie: cookiesOf(res) } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as MeResponse;
    expect(body.user.id).toBe(4);
    // 表示名は Google のプロフィールで上書きしない
    expect(body.user.displayName).toBe("山田 太郎");
    const account = await env.DB.prepare(
      "SELECT user_id, account_id FROM accounts WHERE provider_id = 'google'",
    ).first<{ user_id: number; account_id: string }>();
    expect(account).toEqual({ user_id: 4, account_id: "google-taro" });
    // Google のトークンは平文で保存しない
    const tokens = await env.DB.prepare(
      "SELECT access_token FROM accounts WHERE provider_id = 'google'",
    ).first<{
      access_token: string;
    }>();
    expect(tokens?.access_token).not.toBe("access");
    const log = await env.DB.prepare("SELECT action, user_id FROM audit_logs WHERE action = 'login'").first();
    expect(log).toEqual({ action: "login", user_id: 4 });
  });

  it("未登録のメールアドレスではユーザーを作らずにログイン画面へ戻す", async () => {
    const res = await googleLogin({ sub: "google-stranger", email: "stranger@gmail.com", name: "Stranger" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, BASE_URL);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("signup_disabled");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token=[^;]/);
    const created = await env.DB.prepare("SELECT id FROM users WHERE email = 'stranger@gmail.com'").first();
    expect(created).toBeNull();
  });

  it("Google でメールアドレスが確認されていないアカウントは、登録済みユーザーにひもづけない", async () => {
    const res = await googleLogin({
      sub: "google-attacker",
      email: "taro@test.jp",
      name: "Attacker",
      email_verified: false,
    });
    const location = new URL(res.headers.get("location")!, BASE_URL);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("account_not_linked");
    const linked = await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>();
    expect(linked?.n).toBe(0);
  });

  it("無効にしたユーザーは Google でもログインできない", async () => {
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = 4").run();
    const res = await googleLogin({ sub: "google-taro", email: "taro@test.jp", name: "Taro Yamada" });
    const location = new URL(res.headers.get("location")!, BASE_URL);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("account_disabled");
  });
});

describe("認証", () => {
  it("未ログインでは保護された API に 401 を返す", async () => {
    const res = await anon.get<{ error: string }>("/api/members");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("ログイン");
  });

  it("ログイン中は me でロールと権限が返る", async () => {
    const hr = await login("hr@test.jp");
    const me = await hr.get<MeResponse>("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("hr");
    expect(me.body.member?.lastName).toBe("人事");
    expect(me.body.capabilities.manageMembers).toBe(true);
    expect(me.body.capabilities.manageUsers).toBe(false);
    expect(me.body.scopeDepartmentIds).toBeNull();
    const mgr = await login("mgr@test.jp");
    const mgrMe = await mgr.get<MeResponse>("/api/auth/me");
    expect(mgrMe.body.scopeDepartmentIds?.sort()).toEqual([2, 3]);
  });

  it("ログイン方法は Google のみで、メールアドレスとパスワードではログイン・登録できない", async () => {
    const options = await anon.get<LoginOptions>("/api/auth/login-options");
    expect(options.body.google).toBe(true);
    const signIn = await anon.send("POST", "/api/auth/sign-in/email", {
      email: "taro@test.jp",
      password: "correct-horse-battery",
    });
    expect(signIn.status).toBe(400);
    const signUp = await anon.send("POST", "/api/auth/sign-up/email", {
      email: "someone@test.jp",
      password: "correct-horse-battery",
      name: "誰か",
    });
    expect(signUp.status).toBe(400);
    const created = await env.DB.prepare("SELECT id FROM users WHERE email = 'someone@test.jp'").first();
    expect(created).toBeNull();
  });

  it("Google ログインを始めると Google の認可画面の URL が返る", async () => {
    const res = await anon.fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { origin: BASE_URL },
      json: { provider: "google", callbackURL: "/members", errorCallbackURL: "/login" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; redirect: boolean };
    const url = new URL(body.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/callback/google`);
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("Cookie は HttpOnly・SameSite=Lax・Secure で発行される", async () => {
    const res = await demoLogin(3);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("ログアウトするとセッションが無効になる", async () => {
    const c = await login("taro@test.jp");
    expect((await c.get("/api/auth/me")).status).toBe(200);
    const res = await c.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { origin: BASE_URL },
      json: {},
    });
    expect(res.status).toBe(200);
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });

  it("無効にしたユーザーはセッションを作れず、ログイン中のセッションも使えなくなる", async () => {
    const taro = await login("taro@test.jp");
    const admin = await login("admin@test.jp");
    const res = await admin.send("PATCH", "/api/users/4", {
      email: "taro@test.jp",
      displayName: "山田 太郎",
      role: "member",
      memberId: 3,
      active: false,
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT active FROM users WHERE id = 4").first<{ active: unknown }>();
    expect(row?.active).toBe(0);
    expect((await taro.get("/api/auth/me")).status).toBe(401);
    await expect(login("taro@test.jp")).rejects.toThrow();
  });

  it("他オリジンからの POST は拒否する（CSRF 対策）", async () => {
    const c = await login("taro@test.jp");
    const res = await c.fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: {},
    });
    expect(res.status).toBe(403);
    expect((await c.get("/api/auth/me")).status).toBe(200);
  });

  it("フォーム形式の POST は拒否する", async () => {
    const res = await anon.fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "provider=google",
    });
    expect(res.status).toBe(415);
  });

  it("デモモードではデモアカウント一覧とワンクリックログインが使える", async () => {
    const list = await anon.get<LoginOptions>("/api/auth/login-options");
    expect(list.body.demoAccounts.map((a) => a.role)).toEqual(["admin", "hr", "manager"]);
    const res = await demoLogin(3);
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    const me = await SELF.fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie } });
    expect(((await me.json()) as MeResponse).user.role).toBe("manager");
    // デモでないユーザーには使えない
    expect((await demoLogin(4)).status).toBe(400);
  });
});
