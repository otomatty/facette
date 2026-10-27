import { beforeEach, describe, expect, it } from "vitest";
import type {
  MemberDetail,
  MemberSheetView,
  MemberSummary,
  MemberTransfer,
  Paged,
} from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

type List = Paged<MemberSummary> & { extra?: Record<number, Record<string, unknown>> };

describe("社員一覧・検索", () => {
  it("既定では在籍・休職者のみをかな順で返す", async () => {
    const c = await login("taro@test.jp");
    const res = await c.get<List>("/api/members");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.items.map((m) => m.employeeCode)).not.toContain("E005");
    const kana = res.body.items.map((m) => m.lastNameKana);
    expect(kana).toEqual([...kana].sort());
  });

  it("氏名・かな（カタカナ入力も可）・社員番号で検索できる", async () => {
    const c = await login("taro@test.jp");
    expect((await c.get<List>("/api/members?q=山田")).body.items[0]?.employeeCode).toBe("E003");
    expect((await c.get<List>("/api/members?q=ヤマダ")).body.items[0]?.employeeCode).toBe("E003");
    expect((await c.get<List>("/api/members?q=e004")).body.items[0]?.lastName).toBe("営業");
  });

  it("部署で絞り込むと配下部署も含まれる", async () => {
    const c = await login("taro@test.jp");
    const withSub = await c.get<List>("/api/members?departmentId=2");
    expect(withSub.body.items.map((m) => m.id).sort()).toEqual([2, 3]);
    const only = await c.get<List>("/api/members?departmentId=2&includeSub=false");
    expect(only.body.items.map((m) => m.id)).toEqual([2]);
  });

  it("一般社員には他人の機微情報（生年月日・性別・等級）を返さない", async () => {
    const taro = await login("taro@test.jp");
    const list = await taro.get<List>("/api/members");
    const jiro = list.body.items.find((m) => m.id === 4)!;
    expect(jiro.birthDate).toBeNull();
    expect(jiro.gender).toBeNull();
    expect(jiro.gradeName).toBeNull();
    const self = list.body.items.find((m) => m.id === 3)!;
    expect(self.birthDate).toBe("1995-06-30");
  });

  it("マネージャーは管轄範囲（自部署配下）のみ機微情報が見える", async () => {
    const mgr = await login("mgr@test.jp");
    const list = await mgr.get<List>("/api/members");
    expect(list.body.items.find((m) => m.id === 3)!.birthDate).toBe("1995-06-30");
    expect(list.body.items.find((m) => m.id === 4)!.birthDate).toBeNull();
  });

  it("一般社員が機微情報で絞り込んでも条件は無視される", async () => {
    const taro = await login("taro@test.jp");
    const res = await taro.get<List>("/api/members?gender=female");
    expect(res.body.total).toBe(5);
  });

  it("マネージャーが機微情報で絞り込むと結果は管轄範囲に限定される", async () => {
    const mgr = await login("mgr@test.jp");
    const res = await mgr.get<List>("/api/members?gender=male");
    expect(res.body.items.map((m) => m.id).sort()).toEqual([2, 3]);
  });

  it("スキルとレベルで絞り込める", async () => {
    const c = await login("hr@test.jp");
    const res = await c.get<List>("/api/members?skillId=1&skillMin=3");
    expect(res.body.items.map((m) => m.id)).toEqual([3]);
  });

  it("シート項目の値で検索でき、見えないシートでは検索できない", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.get<List>("/api/members?fieldId=3&fieldValue=高");
    expect(res.body.items.map((m) => m.id)).toEqual([3]);
    const cb = await hr.get<List>("/api/members?fieldId=4&fieldValue=true");
    expect(cb.body.items.map((m) => m.id)).toEqual([3]);
    const taro = await login("taro@test.jp");
    const ng = await taro.get("/api/members?fieldId=3&fieldValue=高");
    expect(ng.status).toBe(403);
    // マネージャーはタレントシートを範囲内でのみ検索できる
    const mgr = await login("mgr@test.jp");
    const scoped = await mgr.get<List>("/api/members?fieldId=3&fieldValue=低");
    expect(scoped.body.items).toEqual([]);
  });

  it("一覧に追加列としてシート項目を取得でき、権限のない値は含まれない", async () => {
    const mgr = await login("mgr@test.jp");
    const res = await mgr.get<List>("/api/members?columns=3");
    expect(res.body.extra?.[3]?.["3"]).toBe("高");
    expect(res.body.extra?.[4]).toBeUndefined();
  });
});

describe("社員詳細・編集", () => {
  it("詳細には部署パスが含まれる", async () => {
    const c = await login("taro@test.jp");
    const res = await c.get<MemberDetail>("/api/members/3");
    expect(res.body.path.map((p) => p.name)).toEqual(["本社", "開発部", "開発1課"]);
    expect(res.body.isSelf).toBe(true);
  });

  it("人事は社員を登録・編集でき、部署変更は異動履歴に残る", async () => {
    const hr = await login("hr@test.jp");
    const created = await hr.send<MemberSummary>("POST", "/api/members", {
      employeeCode: "E100",
      lastName: "新井",
      firstName: "ゆき",
      lastNameKana: "アライ",
      firstNameKana: "ユキ",
      departmentId: 4,
      jobTitleId: 2,
      hireDate: "2026-04-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.lastNameKana).toBe("あらい");
    const dup = await hr.send("POST", "/api/members", {
      employeeCode: "E100",
      lastName: "a",
      firstName: "b",
    });
    expect(dup.status).toBe(400);

    const upd = await hr.send<MemberDetail>("PATCH", `/api/members/${created.body.id}`, { departmentId: 3 });
    expect(upd.body.departmentName).toBe("開発1課");
    const tr = await hr.get<{ items: MemberTransfer[] }>(`/api/members/${created.body.id}/transfers`);
    expect(tr.body.items[0]).toMatchObject({ fromDepartmentName: "営業部", toDepartmentName: "開発1課" });
  });

  it("不正な日付は 400 を返す", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.send<{ error: string }>("PATCH", "/api/members/3", { hireDate: "2026-02-30" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("YYYY-MM-DD");
  });

  it("一般社員は本人の自己紹介のみ編集でき、他人は編集できない", async () => {
    const taro = await login("taro@test.jp");
    const ok = await taro.send<MemberDetail>("PATCH", "/api/members/3", {
      bio: "よろしくお願いします",
      lastName: "改ざん",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.bio).toBe("よろしくお願いします");
    expect(ok.body.lastName).toBe("山田");
    const ng = await taro.send("PATCH", "/api/members/4", { bio: "x" });
    expect(ng.status).toBe(403);
  });

  it("社員の削除はシステム管理者のみ", async () => {
    const hr = await login("hr@test.jp");
    expect((await hr.send("DELETE", "/api/members/4")).status).toBe(403);
    const admin = await login("admin@test.jp");
    expect((await admin.send("DELETE", "/api/members/4")).status).toBe(200);
    expect((await admin.get("/api/members/4")).status).toBe(404);
  });
});

describe("顔写真", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);

  it("本人は顔写真をアップロード・取得・削除できる", async () => {
    const taro = await login("taro@test.jp");
    const up = await taro.fetch("/api/members/3/photo", {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
    expect(up.status).toBe(200);
    const summary = (await up.json()) as MemberSummary;
    expect(summary.photoUrl).toMatch(/^\/api\/members\/3\/photo\?v=/);
    const img = await taro.fetch(summary.photoUrl!);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(jpeg);
    expect((await taro.send("DELETE", "/api/members/3/photo")).status).toBe(200);
    expect((await taro.fetch("/api/members/3/photo")).status).toBe(404);
  });

  it("画像以外や他人の写真は拒否する", async () => {
    const taro = await login("taro@test.jp");
    const bad = await taro.fetch("/api/members/3/photo", {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: new TextEncoder().encode("<svg onload=alert(1)>"),
    });
    expect(bad.status).toBe(400);
    const other = await taro.fetch("/api/members/4/photo", {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: jpeg,
    });
    expect(other.status).toBe(403);
  });
});

describe("シートの閲覧・編集権限", () => {
  const sheetIds = (items: MemberSheetView[]) => items.map((s) => s.sheet.id);

  it("一般社員：本人は公開・人事情報(閲覧)・資格が見え、タレントは見えない", async () => {
    const taro = await login("taro@test.jp");
    const self = await taro.get<{ items: MemberSheetView[] }>("/api/members/3/sheets");
    expect(sheetIds(self.body.items)).toEqual([1, 2, 4]);
    expect(self.body.items.find((s) => s.sheet.id === 2)).toMatchObject({
      access: "view",
      canRequestChange: true,
    });
    const other = await taro.get<{ items: MemberSheetView[] }>("/api/members/4/sheets");
    expect(sheetIds(other.body.items)).toEqual([1, 4]);
    expect(other.body.items.every((s) => s.access === "view")).toBe(true);
  });

  it("マネージャー：管轄内はタレントを編集でき、管轄外・本人は見えない", async () => {
    const mgr = await login("mgr@test.jp");
    const inScope = await mgr.get<{ items: MemberSheetView[] }>("/api/members/3/sheets");
    expect(inScope.body.items.find((s) => s.sheet.id === 3)?.access).toBe("edit");
    const out = await mgr.get<{ items: MemberSheetView[] }>("/api/members/4/sheets");
    expect(sheetIds(out.body.items)).toEqual([1, 4]);
    const self = await mgr.get<{ items: MemberSheetView[] }>("/api/members/2/sheets");
    expect(sheetIds(self.body.items)).not.toContain(3);
  });

  it("単一シートを保存でき、選択肢にない値や権限のない編集は拒否される", async () => {
    const mgr = await login("mgr@test.jp");
    const ok = await mgr.send<{ data: Record<string, unknown> }>("PUT", "/api/members/3/sheets/3", {
      data: { "3": "中", "4": false, "999": "ignored" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ "3": "中", "4": false });
    const bad = await mgr.send("PUT", "/api/members/3/sheets/3", { data: { "3": "最高" } });
    expect(bad.status).toBe(400);
    const ng = await mgr.send("PUT", "/api/members/4/sheets/3", { data: { "3": "中" } });
    expect(ng.status).toBe(403);
  });

  it("複数レコードのシートに追加・更新・削除できる", async () => {
    const taro = await login("taro@test.jp");
    const missing = await taro.send<{ fieldErrors: Record<string, string> }>(
      "POST",
      "/api/members/3/sheets/4/records",
      {
        data: { "6": "2024-01-01" },
      },
    );
    expect(missing.status).toBe(400);
    expect(missing.body.fieldErrors["5"]).toContain("資格名");
    const add = await taro.send<{ id: number }>("POST", "/api/members/3/sheets/4/records", {
      data: { "5": "基本情報技術者", "6": "2024/1/5" },
    });
    expect(add.status).toBe(201);
    const upd = await taro.send<{ data: Record<string, unknown> }>(
      "PATCH",
      `/api/members/3/sheets/4/records/${add.body.id}`,
      { data: { "5": "応用情報技術者", "6": "2025-01-05" } },
    );
    expect(upd.body.data["5"]).toBe("応用情報技術者");
    expect((await taro.send("DELETE", `/api/members/3/sheets/4/records/${add.body.id}`)).status).toBe(200);
    // 他人の資格は閲覧のみ
    const jiro = await login("jiro@test.jp");
    expect((await jiro.send("POST", "/api/members/3/sheets/4/records", { data: { "5": "x" } })).status).toBe(
      403,
    );
  });
});

describe("スキル", () => {
  it("本人はスキルを登録でき、他人のものは変更できない", async () => {
    const taro = await login("taro@test.jp");
    const ok = await taro.send("PUT", "/api/members/3/skills", {
      skills: [
        { skillId: 1, level: 5 },
        { skillId: 2, level: 1 },
      ],
    });
    expect(ok.status).toBe(200);
    const res = await taro.get<{ items: { name: string; level: number }[] }>("/api/members/3/skills");
    expect(res.body.items).toEqual([
      expect.objectContaining({ name: "TypeScript", level: 5 }),
      expect.objectContaining({ name: "営業", level: 1 }),
    ]);
    expect((await taro.send("PUT", "/api/members/4/skills", { skills: [] })).status).toBe(403);
  });
});
