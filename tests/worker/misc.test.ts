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
