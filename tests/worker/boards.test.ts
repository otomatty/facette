import { beforeEach, describe, expect, it } from "vitest";
import type { TeamBoard, TeamBoardSummary } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

const data = {
  items: [
    { memberId: 3, x: 40, y: 60 },
    { memberId: 4, x: 140, y: 60 },
    { memberId: 3, x: 999, y: 999 },
  ],
  groups: [{ id: "g1", label: "新規事業チーム", x: 20, y: 20, w: 400, h: 240, color: "ai" }],
  notes: [{ id: "n1", text: "リーダー候補を決める", x: 500, y: 40 }],
};

describe("チームキャンバス", () => {
  it("作成して顔とグループを保存でき、重複した社員は1人にまとまる", async () => {
    const mgr = await login("mgr@test.jp");
    const created = await mgr.send<{ id: number }>("POST", "/api/boards", { name: "来期の体制" });
    expect(created.status).toBe(201);
    const saved = await mgr.send("PUT", `/api/boards/${created.body.id}`, {
      name: "来期の体制",
      shared: false,
      data,
    });
    expect(saved.status).toBe(200);
    const board = await mgr.get<TeamBoard>(`/api/boards/${created.body.id}`);
    expect(board.body.data.items).toHaveLength(2);
    expect(board.body.data.groups[0]!.label).toBe("新規事業チーム");
    expect(board.body.members.map((m) => m.id).sort()).toEqual([3, 4]);
  });

  it("共有しないキャンバスは他人から見えず、共有しても編集は作成者のみ", async () => {
    const mgr = await login("mgr@test.jp");
    const { body } = await mgr.send<{ id: number }>("POST", "/api/boards", { name: "検討メモ" });
    const taro = await login("taro@test.jp");
    expect((await taro.get(`/api/boards/${body.id}`)).status).toBe(404);
    await mgr.send("PUT", `/api/boards/${body.id}`, { name: "検討メモ", shared: true, data });
    const list = await taro.get<{ items: TeamBoardSummary[] }>("/api/boards");
    expect(list.body.items.map((b) => b.name)).toContain("検討メモ");
    expect((await taro.send("PUT", `/api/boards/${body.id}`, { name: "x", shared: true, data })).status).toBe(
      403,
    );
    const dup = await taro.send<{ id: number }>("POST", `/api/boards/${body.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect((await taro.get<TeamBoard>(`/api/boards/${dup.body.id}`)).body.isOwner).toBe(true);
  });

  it("不正な座標や色は保存できない", async () => {
    const mgr = await login("mgr@test.jp");
    const { body } = await mgr.send<{ id: number }>("POST", "/api/boards", { name: "x" });
    const bad = await mgr.send("PUT", `/api/boards/${body.id}`, {
      name: "x",
      data: {
        items: [],
        groups: [{ id: "g", label: "", x: 0, y: 0, w: 10, h: 10, color: "red" }],
        notes: [],
      },
    });
    expect(bad.status).toBe(400);
  });
});
