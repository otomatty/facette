import { beforeEach, describe, expect, it } from "vitest";
import type { MemberDetail, MemberTransfer, PlacementScenario } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("配置シミュレーション", () => {
  it("マネージャーは作成できるが反映できず、人事が反映すると異動履歴が残る", async () => {
    const mgr = await login("mgr@test.jp");
    const created = await mgr.send<{ id: number }>("POST", "/api/placement", {
      name: "来期体制案",
      effectiveDate: "2027-04-01",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    await mgr.send("PUT", `/api/placement/${id}/moves`, {
      moves: [{ memberId: 3, toDepartmentId: 4, toJobTitleId: 1 }],
    });
    expect((await mgr.send("POST", `/api/placement/${id}/apply`)).status).toBe(403);

    // 他のマネージャー作成分は一般社員・他人から見えない
    const taro = await login("taro@test.jp");
    expect((await taro.get("/api/placement")).status).toBe(403);

    const hr = await login("hr@test.jp");
    const list = await hr.get<{ items: PlacementScenario[] }>("/api/placement");
    expect(list.body.items[0]).toMatchObject({ name: "来期体制案", moveCount: 1 });
    const applied = await hr.send<{ applied: number }>("POST", `/api/placement/${id}/apply`);
    expect(applied.body.applied).toBe(1);
    const m = await hr.get<MemberDetail>("/api/members/3");
    expect(m.body).toMatchObject({ departmentName: "営業部", jobTitleName: "部長" });
    const tr = await hr.get<{ items: MemberTransfer[] }>("/api/members/3/transfers");
    expect(tr.body.items[0]).toMatchObject({ effectiveDate: "2027-04-01", toDepartmentName: "営業部" });
    // 反映後は編集できない
    expect((await hr.send("PUT", `/api/placement/${id}/moves`, { moves: [] })).status).toBe(400);
  });
});
