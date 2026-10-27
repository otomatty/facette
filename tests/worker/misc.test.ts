import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AppUser,
  ChangeRequest,
  MemberList,
  MemberSheetView,
  OneOnOne,
  PositionMatch,
} from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("社員リスト", () => {
  it("作成者だけが編集でき、共有したリストは他の人も見られる", async () => {
    const mgr = await login("mgr@test.jp");
    const created = await mgr.send<{ id: number }>("POST", "/api/lists", {
      name: "PJメンバー",
      shared: false,
    });
    await mgr.send("POST", `/api/lists/${created.body.id}/members`, { memberIds: [3, 4] });
    const taro = await login("taro@test.jp");
    expect((await taro.get(`/api/lists/${created.body.id}`)).status).toBe(404);
    await mgr.send("PATCH", `/api/lists/${created.body.id}`, { name: "PJメンバー", shared: true });
    const view = await taro.get<{ list: MemberList; members: unknown[] }>(`/api/lists/${created.body.id}`);
    expect(view.body.members).toHaveLength(2);
    expect(view.body.list.isOwner).toBe(false);
    expect((await taro.send("DELETE", `/api/lists/${created.body.id}`)).status).toBe(403);
    const search = await taro.get<{ total: number }>(`/api/members?listId=${created.body.id}`);
    expect(search.body.total).toBe(2);
  });
});

describe("1on1", () => {
  it("上長が記録し、本人は共有された記録のみ見られる（コンディションは非表示）", async () => {
    const mgr = await login("mgr@test.jp");
    const shared = await mgr.send<OneOnOne>("POST", "/api/one-on-ones", {
      memberId: 3,
      heldOn: "2026-10-01",
      title: "目標のすり合わせ",
      condition: 4,
      sharedWithMember: true,
    });
    expect(shared.status).toBe(201);
    await mgr.send("POST", "/api/one-on-ones", {
      memberId: 3,
      heldOn: "2026-10-02",
      title: "非公開メモ",
      sharedWithMember: false,
    });
    // 管轄外は作成できない
    expect(
      (await mgr.send("POST", "/api/one-on-ones", { memberId: 4, heldOn: "2026-10-01", title: "x" })).status,
    ).toBe(403);
    const taro = await login("taro@test.jp");
    const mine = await taro.get<{ items: OneOnOne[] }>("/api/one-on-ones?memberId=3");
    expect(mine.body.items.map((i) => i.title)).toEqual(["目標のすり合わせ"]);
    expect(mine.body.items[0]!.condition).toBeNull();
    expect(
      (await taro.send("POST", "/api/one-on-ones", { memberId: 3, heldOn: "2026-10-01", title: "x" })).status,
    ).toBe(403);
    const jiro = await login("jiro@test.jp");
    expect((await jiro.get<{ items: OneOnOne[] }>("/api/one-on-ones?memberId=3")).body.items).toHaveLength(0);
  });

  it("管轄範囲の最終面談日を返し、一般社員は使えない", async () => {
    const mgr = await login("mgr@test.jp");
    await mgr.send("POST", "/api/one-on-ones", { memberId: 3, heldOn: "2026-09-01", title: "a" });
    await mgr.send("POST", "/api/one-on-ones", { memberId: 3, heldOn: "2026-10-05", title: "b" });
    const res = await mgr.get<{ items: { memberId: number; lastHeldOn: string; count: number }[] }>(
      "/api/one-on-ones/last-held",
    );
    expect(res.body.items).toEqual([{ memberId: 3, lastHeldOn: "2026-10-05", count: 2 }]);
    const taro = await login("taro@test.jp");
    expect((await taro.get("/api/one-on-ones/last-held")).status).toBe(403);
  });
});

describe("変更申請", () => {
  it("本人が閲覧のみのシートの変更を申請し、人事が承認すると反映される", async () => {
    const taro = await login("taro@test.jp");
    const sheets = await taro.get<{ items: MemberSheetView[] }>("/api/members/3/sheets");
    expect(sheets.body.items.find((s) => s.sheet.id === 2)?.canRequestChange).toBe(true);
    expect(
      (await taro.send("POST", "/api/requests", { sheetId: 2, data: { "2": "大阪府" }, reason: "" })).status,
    ).toBe(400);
    const req = await taro.send<{ id: number }>("POST", "/api/requests", {
      sheetId: 2,
      data: { "2": "大阪府" },
      reason: "転居",
    });
    expect(req.status).toBe(201);
    expect(
      (await taro.send("POST", "/api/requests", { sheetId: 2, data: { "2": "東京都" }, reason: "x" })).status,
    ).toBe(400);
    // 自分で編集できるシートは申請不要
    expect((await taro.send("POST", "/api/requests", { sheetId: 1, data: {}, reason: "x" })).status).toBe(
      400,
    );

    const hr = await login("hr@test.jp");
    const list = await hr.get<{ items: ChangeRequest[] }>("/api/requests?status=pending");
    expect(list.body.items[0]).toMatchObject({
      sheetName: "人事情報",
      before: { "2": "東京都" },
      payload: { "2": "大阪府" },
    });
    expect((await taro.send("POST", `/api/requests/${req.body.id}/approve`, {})).status).toBe(403);
    expect((await hr.send("POST", `/api/requests/${req.body.id}/approve`, {})).status).toBe(200);
    const after = await taro.get<{ items: MemberSheetView[] }>("/api/members/3/sheets");
    expect(after.body.items.find((s) => s.sheet.id === 2)?.records[0]?.data["2"]).toBe("大阪府");
  });

  it("承認後も申請時点の値を変更前として表示できる", async () => {
    const taro = await login("taro@test.jp");
    const req = await taro.send<{ id: number }>("POST", "/api/requests", {
      sheetId: 2,
      data: { "2": "大阪府" },
      reason: "転居",
    });
    const hr = await login("hr@test.jp");
    await hr.send("POST", `/api/requests/${req.body.id}/approve`, {});
    const all = await hr.get<{ items: ChangeRequest[] }>("/api/requests?status=approved");
    expect(all.body.items[0]).toMatchObject({ before: { "2": "東京都" }, payload: { "2": "大阪府" } });
  });
});

describe("ポジション", () => {
  it("必要スキルに対するマッチ度で候補者を並べる", async () => {
    const hr = await login("hr@test.jp");
    const p = await hr.send<{ id: number }>("POST", "/api/positions", {
      name: "テックリード",
      departmentId: 2,
      requirements: [{ skillId: 1, minLevel: 4, weight: 1 }],
    });
    const res = await hr.get<{ items: PositionMatch[] }>(`/api/positions/${p.body.id}/matches`);
    expect(res.body.items.map((x) => [x.member.id, x.score])).toEqual([
      [3, 100],
      [2, 50],
    ]);
    const taro = await login("taro@test.jp");
    expect((await taro.get(`/api/positions/${p.body.id}/matches`)).status).toBe(403);
  });
});

describe("ユーザー管理・操作ログ", () => {
  it("管理者はユーザーを作成でき、作成したユーザーでログインできる", async () => {
    const admin = await login("admin@test.jp");
    const res = await admin.send("POST", "/api/users", {
      email: "new@test.jp",
      displayName: "新人",
      role: "member",
      memberId: 5,
      password: "a-long-enough-password",
    });
    expect(res.status).toBe(201);
    await login("new@test.jp", "a-long-enough-password");
    const users = await admin.get<{ items: AppUser[] }>("/api/users");
    expect(users.body.items.some((u) => u.email === "new@test.jp")).toBe(true);
    const logs = await admin.get<{ items: { action: string }[] }>("/api/audit-logs");
    expect(logs.body.items.map((l) => l.action)).toContain("user.create");
    const hr = await login("hr@test.jp");
    expect((await hr.get("/api/users")).status).toBe(403);
    expect((await hr.get("/api/audit-logs")).status).toBe(403);
  });

  it("自分自身の管理者権限は外せない", async () => {
    const admin = await login("admin@test.jp");
    const res = await admin.send("PATCH", "/api/users/1", {
      email: "admin@test.jp",
      displayName: "管理",
      role: "hr",
      memberId: 6,
    });
    expect(res.status).toBe(400);
  });
});

describe("CSV 入出力", () => {
  it("出力した CSV を取り込むと差分なく更新でき、新規行は追加される", async () => {
    const hr = await login("hr@test.jp");
    const exp = await hr.get<{ csv: string; count: number }>("/api/io/members/export");
    expect(exp.body.count).toBe(6);
    const header = exp.body.csv.split("\r\n")[0]!;
    expect(header).toContain("タレント:パフォーマンス");
    const csv = `${exp.body.csv}\r\nE200,新規,花子,しんき,はなこ,,女性,1999/1/2,2026/4/1,,在籍,D4,,メンバー,G1,正社員,東京本社,,,`;
    const dry = await hr.send<{ created: number; updated: number; errorCount: number; dryRun: boolean }>(
      "POST",
      "/api/io/members/import",
      { csv, dryRun: true },
    );
    expect(dry.body).toMatchObject({ created: 1, updated: 6, errorCount: 0, dryRun: true });
    const real = await hr.send<{ dryRun: boolean }>("POST", "/api/io/members/import", { csv, dryRun: false });
    expect(real.body.dryRun).toBe(false);
    const found = await hr.get<{ items: { departmentName: string; birthDate: string }[] }>(
      "/api/members?q=E200",
    );
    expect(found.body.items[0]).toMatchObject({ departmentName: "営業部", birthDate: "1999-01-02" });
  });

  it("不正な値はエラー行として返し、取り込まない", async () => {
    const hr = await login("hr@test.jp");
    const csv =
      "社員番号,姓,名,部署,性別,入社日\r\nE300,a,b,存在しない部署,男,2026-13-01\r\nE301,,,営業部,男性,";
    const res = await hr.send<{ errorCount: number; errors: { row: number; message: string }[] }>(
      "POST",
      "/api/io/members/import",
      { csv, dryRun: false },
    );
    expect(res.body.errorCount).toBe(2);
    expect(res.body.errors[0]!.message).toContain("部署「存在しない部署」");
    expect(res.body.errors[0]!.message).toContain("性別");
    expect(res.body.errors[1]!.message).toContain("姓と名");
    expect((await hr.get<{ total: number }>("/api/members?q=E30")).body.total).toBe(0);
  });

  it("一般社員は CSV を扱えない", async () => {
    const taro = await login("taro@test.jp");
    expect((await taro.get("/api/io/members/export")).status).toBe(403);
  });
});

describe("お知らせ・並べ替え", () => {
  it("上部に固定できるお知らせは3件まで", async () => {
    const hr = await login("hr@test.jp");
    for (let i = 1; i <= 3; i++) {
      const r = await hr.send("POST", "/api/announcements", { title: `固定${i}`, body: "", pinned: true });
      expect(r.status).toBe(201);
    }
    const over = await hr.send<{ error: string }>("POST", "/api/announcements", {
      title: "固定4",
      body: "",
      pinned: true,
    });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain("3件まで");
    // 固定済みのものを編集し直すのは上限に数えない
    const list = await hr.get<{ items: { id: number; title: string }[] }>("/api/announcements");
    const target = list.body.items.find((a) => a.title === "固定1")!;
    const edit = await hr.send("PATCH", `/api/announcements/${target.id}`, {
      title: "固定1（更新）",
      body: "",
      pinned: true,
    });
    expect(edit.status).toBe(200);
    expect((await hr.send("DELETE", `/api/announcements/${target.id}`)).status).toBe(200);
    const actions = await env.DB.prepare(
      "SELECT action FROM audit_logs WHERE action LIKE 'announcement.%' ORDER BY id",
    ).all<{ action: string }>();
    expect(actions.results.map((r) => r.action)).toEqual([
      "announcement.create",
      "announcement.create",
      "announcement.create",
      "announcement.update",
      "announcement.delete",
    ]);
  });

  it("シートと項目の並べ替えは1回の更新で反映され、他のシートの項目には影響しない", async () => {
    const admin = await login("admin@test.jp");
    expect((await admin.send("POST", "/api/sheets/reorder", { ids: [4, 3, 2, 1] })).status).toBe(200);
    const sheets = await env.DB.prepare("SELECT id FROM sheets ORDER BY sort_order").all<{ id: number }>();
    expect(sheets.results.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    // 他のシートの項目 ID（5）を混ぜても、そのシートの項目しか動かない
    await admin.send("POST", "/api/sheets/3/fields/reorder", { ids: [4, 3, 5] });
    const fields = await env.DB.prepare("SELECT id, sheet_id, sort_order FROM sheet_fields ORDER BY id").all<{
      id: number;
      sheet_id: number;
      sort_order: number;
    }>();
    expect(fields.results.find((f) => f.id === 4)!.sort_order).toBe(1);
    expect(fields.results.find((f) => f.id === 3)!.sort_order).toBe(2);
    expect(fields.results.find((f) => f.id === 5)!.sort_order).toBe(1);
  });
});
