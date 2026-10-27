import { beforeEach, describe, expect, it } from "vitest";
import type { Masters, Sheet } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("マスタ管理", () => {
  it("誰でもマスタを取得でき、部署の人数が含まれる", async () => {
    const taro = await login("taro@test.jp");
    const res = await taro.get<Masters>("/api/masters");
    expect(res.body.departments.find((d) => d.id === 4)?.memberCount).toBe(1);
    expect(res.body.jobTitles[0]?.name).toBe("部長");
  });

  it("人事は部署を追加・移動でき、循環する親子関係は拒否される", async () => {
    const hr = await login("hr@test.jp");
    const created = await hr.send<{ id: number }>("POST", "/api/masters/departments", {
      name: "開発2課",
      parentId: 2,
    });
    expect(created.status).toBe(201);
    const cyc = await hr.send<{ error: string }>("PATCH", "/api/masters/departments/2", {
      name: "開発部",
      parentId: 3,
    });
    expect(cyc.status).toBe(400);
    expect(cyc.body.error).toContain("配下");
    const del = await hr.send("DELETE", "/api/masters/departments/4");
    expect(del.status).toBe(400);
    expect((await hr.send("DELETE", `/api/masters/departments/${created.body.id}`)).status).toBe(200);
  });

  it("一般社員はマスタを変更できない", async () => {
    const taro = await login("taro@test.jp");
    expect((await taro.send("POST", "/api/masters/departments", { name: "x", parentId: null })).status).toBe(
      403,
    );
    expect((await taro.send("POST", "/api/masters/job-titles", { name: "x" })).status).toBe(403);
  });

  it("役職を追加・削除でき、使用中は削除できない", async () => {
    const hr = await login("hr@test.jp");
    const jt = await hr.send<{ id: number }>("POST", "/api/masters/job-titles", {
      name: "課長",
      rank: 40,
      isManager: true,
    });
    expect(jt.status).toBe(201);
    expect((await hr.send("DELETE", "/api/masters/job-titles/2")).status).toBe(400);
    expect((await hr.send("DELETE", `/api/masters/job-titles/${jt.body.id}`)).status).toBe(200);
  });
});

describe("シート設計", () => {
  it("管理者はシートと項目を作成・変更・削除できる", async () => {
    const admin = await login("admin@test.jp");
    const sheet = await admin.send<{ id: number }>("POST", "/api/sheets", {
      name: "語学",
      description: "",
      kind: "multi",
      selfAccess: "edit",
      permissions: { hr: "edit", manager: "view", member: "none" },
    });
    expect(sheet.status).toBe(201);
    const noOpt = await admin.send("POST", `/api/sheets/${sheet.body.id}/fields`, {
      label: "言語",
      type: "select",
      options: [],
    });
    expect(noOpt.status).toBe(400);
    const f = await admin.send<{ id: number }>("POST", `/api/sheets/${sheet.body.id}/fields`, {
      label: "言語",
      type: "select",
      options: ["英語", "中国語"],
      required: true,
    });
    expect(f.status).toBe(201);
    const list = await admin.get<{ items: Sheet[] }>("/api/sheets");
    const created = list.body.items.find((s) => s.id === sheet.body.id)!;
    expect(created.fields[0]).toMatchObject({ label: "言語", options: ["英語", "中国語"], required: true });
    expect(created.permissions.manager).toBe("view");
    expect((await admin.send("DELETE", `/api/sheets/${sheet.body.id}/fields/${f.body.id}`)).status).toBe(200);
    expect((await admin.send("DELETE", `/api/sheets/${sheet.body.id}`)).status).toBe(200);
  });

  it("人事はシート設計を変更できない", async () => {
    const hr = await login("hr@test.jp");
    expect(
      (
        await hr.send("POST", "/api/sheets", {
          name: "x",
          kind: "single",
          selfAccess: "none",
          permissions: { hr: "edit", manager: "none", member: "none" },
        })
      ).status,
    ).toBe(403);
  });

  it("項目を削除すると既存データからも値が消える", async () => {
    const admin = await login("admin@test.jp");
    expect((await admin.send("DELETE", "/api/sheets/3/fields/3")).status).toBe(200);
    const rec = await admin.get<{
      items: { sheet: { id: number }; records: { data: Record<string, unknown> }[] }[];
    }>("/api/members/3/sheets");
    const talent = rec.body.items.find((s) => s.sheet.id === 3)!;
    expect(talent.records[0]!.data).toEqual({ "4": true });
  });
});
