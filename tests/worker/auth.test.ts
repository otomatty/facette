import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/types";
import { anon, login, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("認証", () => {
  it("未ログインでは保護された API に 401 を返す", async () => {
    const res = await anon.get<{ error: string }>("/api/members");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("ログイン");
  });

  it("正しい資格情報でログインでき、me でロールと権限が返る", async () => {
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

  it("Cookie は HttpOnly・SameSite=Lax で発行される", async () => {
    const res = await SELF.fetch("https://facette.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "taro@test.jp", password: "correct-horse-battery" }),
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("誤ったパスワードでは 401、10回失敗するとロックされる", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await anon.send("POST", "/api/auth/login", { email: "taro@test.jp", password: "wrong" });
      expect(r.status).toBe(401);
    }
    const locked = await anon.send<{ error: string }>("POST", "/api/auth/login", {
      email: "taro@test.jp",
      password: "correct-horse-battery",
    });
    expect(locked.status).toBe(429);
  });

  it("ログアウトするとセッションが無効になる", async () => {
    const c = await login("taro@test.jp");
    expect((await c.get("/api/auth/me")).status).toBe(200);
    await c.send("POST", "/api/auth/logout");
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });

  it("他オリジンからの POST は拒否する（CSRF 対策）", async () => {
    const c = await login("taro@test.jp");
    const res = await c.fetch("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: {},
    });
    expect(res.status).toBe(403);
  });

  it("フォーム形式の POST は拒否する", async () => {
    const res = await anon.fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a&password=b",
    });
    expect(res.status).toBe(415);
  });

  it("デモモードではデモアカウント一覧とワンクリックログインが使える", async () => {
    const list = await anon.get<{ accounts: { id: number; role: string }[] }>("/api/auth/demo-accounts");
    expect(list.body.accounts.map((a) => a.role)).toEqual(["admin", "hr", "manager"]);
    const res = await SELF.fetch("https://facette.test/api/auth/demo-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: 3 }),
    });
    expect(res.status).toBe(200);
    // デモでないユーザーには使えない
    const ng = await anon.send("POST", "/api/auth/demo-login", { userId: 4 });
    expect(ng.status).toBe(400);
  });

  it("パスワードを変更できる（デモアカウントは不可）", async () => {
    const taro = await login("taro@test.jp");
    const short = await taro.send("POST", "/api/auth/password", {
      currentPassword: "correct-horse-battery",
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    const ok = await taro.send("POST", "/api/auth/password", {
      currentPassword: "correct-horse-battery",
      newPassword: "a-much-longer-password",
    });
    expect(ok.status).toBe(200);
    await expect(login("taro@test.jp")).rejects.toThrow();
    await login("taro@test.jp", "a-much-longer-password");

    const admin = await login("admin@test.jp");
    const demo = await admin.send("POST", "/api/auth/password", {
      currentPassword: "correct-horse-battery",
      newPassword: "a-much-longer-password",
    });
    expect(demo.status).toBe(403);
  });
});
