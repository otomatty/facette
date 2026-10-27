import { beforeEach, describe, expect, it } from "vitest";
import type { ChartData, Metric } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("分析", () => {
  it("部署×性別のクロス集計ができる", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.send<ChartData>("POST", "/api/analytics/chart", {
      dimension: "department",
      series: "gender",
      type: "stacked",
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.labels).toEqual(["本社", "開発部", "開発1課", "営業部"]);
    const male = res.body.series.find((s) => s.name === "男性")!;
    expect(male.values).toEqual([1, 1, 1, 1]);
  });

  it("マネージャーの集計は管轄範囲に限られる", async () => {
    const mgr = await login("mgr@test.jp");
    const res = await mgr.send<ChartData>("POST", "/api/analytics/chart", {
      dimension: "department",
      type: "bar",
    });
    expect(res.body.total).toBe(2);
  });

  it("シートの選択項目で集計でき、一般社員は分析を使えない", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.send<ChartData>("POST", "/api/analytics/chart", {
      dimension: "field:3",
      type: "column",
    });
    expect(res.body.labels.slice(0, 3)).toEqual(["高", "低", "未回答"]);
    const taro = await login("taro@test.jp");
    expect(
      (await taro.send("POST", "/api/analytics/chart", { dimension: "department", type: "bar" })).status,
    ).toBe(403);
  });

  it("指標を計算する", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.get<{ items: Metric[] }>("/api/analytics/metrics");
    const m = Object.fromEntries(res.body.items.map((x) => [x.key, x.value]));
    expect(m.headcount).toBe(5);
    expect(m.femaleRatio).toBe(20);
    expect(m.femaleManagerRatio).toBe(0);
  });

  it("配置バランス図：軸ごとに社員を配置し、編集可能な社員を返す", async () => {
    const mgr = await login("mgr@test.jp");
    const res = await mgr.get<{
      xLabels: string[];
      cells: { x: string; y: string; memberIds: number[] }[];
      editableMemberIds: number[];
    }>("/api/analytics/balance?x=field:3&y=grade");
    expect(res.body.xLabels.slice(0, 3)).toEqual(["高", "中", "低"]);
    expect(res.body.cells.find((c) => c.memberIds.includes(3))?.x).toBe("高");
    expect(res.body.editableMemberIds).toEqual([3]);
  });
});
