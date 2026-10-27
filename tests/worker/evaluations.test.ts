import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { EvaluationSheetDetail, EvaluationSheetSummary } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

async function seedEvaluation() {
  await seedBasic();
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM evaluation_periods"),
    db.prepare("DELETE FROM evaluation_templates"),
    db.prepare(`INSERT INTO evaluation_templates (id, name, scale_max, goal_weight, competency_weight, rank_rules)
      VALUES (1, '総合評価', 5, 60, 40, '[{"rank":"S","min":4.5},{"rank":"A","min":3.5},{"rank":"B","min":2.5},{"rank":"C","min":0}]')`),
    db.prepare(
      "INSERT INTO evaluation_template_items (id, template_id, title, weight, sort_order) VALUES (1, 1, '主体性', 1, 1), (2, 1, '協調性', 1, 2)",
    ),
  ]);
}

beforeEach(seedEvaluation);

describe("評価期間の作成", () => {
  it("人事が期間を作成すると対象者のシートと評価者が自動で設定される", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.send<{ id: number; created: number }>("POST", "/api/evaluations/periods", {
      name: "2026上期",
      templateId: 1,
      startDate: "2026-04-01",
      endDate: "2026-09-30",
      useSecondStep: false,
      targetDepartmentIds: [2],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    const detail = await hr.get<{ sheets: EvaluationSheetSummary[] }>(
      `/api/evaluations/periods/${res.body.id}`,
    );
    const taro = detail.body.sheets.find((s) => s.member.id === 3)!;
    // 山田（開発1課）の一次評価者は開発部長
    expect(taro.firstEvaluator?.id).toBe(2);
    expect(taro.step).toBe("goal");
  });

  it("一般社員は評価期間を作成できない", async () => {
    const taro = await login("taro@test.jp");
    const res = await taro.send("POST", "/api/evaluations/periods", {
      name: "x",
      templateId: 1,
      startDate: "2026-04-01",
      endDate: "2026-09-30",
    });
    expect(res.status).toBe(403);
  });

  it("テンプレートの配分は合計100%が必要", async () => {
    const hr = await login("hr@test.jp");
    const res = await hr.send<{ error: string }>("POST", "/api/evaluations/templates", {
      name: "x",
      goalWeight: 50,
      competencyWeight: 40,
      rankRules: [{ rank: "A", min: 0 }],
      items: [{ title: "a" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("100%");
  });
});

describe("評価ワークフロー（目標設定 → 自己評価 → 一次評価 → 最終確定）", () => {
  it("一連の流れで総合点とランクが確定し、差し戻しもできる", async () => {
    const hr = await login("hr@test.jp");
    const created = await hr.send<{ id: number }>("POST", "/api/evaluations/periods", {
      name: "2026上期",
      templateId: 1,
      startDate: "2026-04-01",
      endDate: "2026-09-30",
      useSecondStep: false,
      targetDepartmentIds: [3],
    });
    await hr.send("PATCH", `/api/evaluations/periods/${created.body.id}`, { status: "active" });

    const taro = await login("taro@test.jp");
    const my = await taro.get<{ own: EvaluationSheetSummary[] }>("/api/evaluations/my");
    const sheetId = my.body.own[0]!.id;
    expect(my.body.own[0]!.myTurn).toBe(true);

    // 目標のウェイト合計が100でないと提出できない
    await taro.send("PUT", `/api/evaluations/sheets/${sheetId}/goals`, {
      goals: [{ title: "機能Aのリリース", weight: 60 }],
    });
    const ng = await taro.send<{ error: string }>("POST", `/api/evaluations/sheets/${sheetId}/submit`, {});
    expect(ng.status).toBe(400);
    expect(ng.body.error).toContain("100");
    const goals = await taro.send<EvaluationSheetDetail>("PUT", `/api/evaluations/sheets/${sheetId}/goals`, {
      goals: [
        { title: "機能Aのリリース", weight: 60 },
        { title: "後輩の育成", weight: 40 },
      ],
    });
    const [g1, g2] = goals.body.goals;
    expect((await taro.send("POST", `/api/evaluations/sheets/${sheetId}/submit`, {})).status).toBe(200);

    // 上長は自己評価中のシートを編集できない
    const mgr = await login("mgr@test.jp");
    const early = await mgr.send("PUT", `/api/evaluations/sheets/${sheetId}/scores`, {
      phase: "first",
      scores: {},
    });
    expect(early.status).toBe(403);

    // 自己評価：未入力があると提出できない
    await taro.send("PUT", `/api/evaluations/sheets/${sheetId}/scores`, {
      phase: "self",
      scores: { [`goal:${g1!.id}`]: { score: 5, comment: "達成" } },
      comment: "がんばりました",
    });
    expect((await taro.send("POST", `/api/evaluations/sheets/${sheetId}/submit`, {})).status).toBe(400);
    await taro.send("PUT", `/api/evaluations/sheets/${sheetId}/scores`, {
      phase: "self",
      scores: {
        [`goal:${g1!.id}`]: { score: 5, comment: "達成" },
        [`goal:${g2!.id}`]: { score: 4, comment: "" },
        "item:1": { score: 4, comment: "" },
        "item:2": { score: 4, comment: "" },
      },
      comment: "がんばりました",
    });
    const selfDone = await taro.send<EvaluationSheetDetail>(
      "POST",
      `/api/evaluations/sheets/${sheetId}/submit`,
      {},
    );
    expect(selfDone.body.step).toBe("first");

    // 本人には一次評価の内容が見えない
    const scoresAll = {
      [`goal:${g1!.id}`]: { score: 4, comment: "" },
      [`goal:${g2!.id}`]: { score: 3, comment: "" },
      "item:1": { score: 4, comment: "" },
      "item:2": { score: 2, comment: "" },
    };
    const mgrView = await mgr.get<EvaluationSheetDetail>(`/api/evaluations/sheets/${sheetId}`);
    expect(mgrView.body.editable).toBe("first");
    expect(mgrView.body.scores.self?.[`goal:${g1!.id}`]?.score).toBe(5);

    // 差し戻し（理由必須）
    expect(
      (await mgr.send("POST", `/api/evaluations/sheets/${sheetId}/remand`, { comment: "" })).status,
    ).toBe(400);
    const remanded = await mgr.send<EvaluationSheetDetail>(
      "POST",
      `/api/evaluations/sheets/${sheetId}/remand`,
      {
        comment: "目標2の振り返りを具体的に",
      },
    );
    expect(remanded.body.step).toBe("self");
    await taro.send("POST", `/api/evaluations/sheets/${sheetId}/submit`, {});

    await mgr.send("PUT", `/api/evaluations/sheets/${sheetId}/scores`, {
      phase: "first",
      scores: scoresAll,
      comment: "",
    });
    const firstDone = await mgr.send<EvaluationSheetDetail>(
      "POST",
      `/api/evaluations/sheets/${sheetId}/submit`,
      {},
    );
    expect(firstDone.body.step).toBe("final"); // 二次評価なし

    const taroView = await taro.get<EvaluationSheetDetail>(`/api/evaluations/sheets/${sheetId}`);
    expect(taroView.body.scores.first).toBeUndefined();
    expect(taroView.body.finalRank).toBeNull();

    // 人事が最終確定：goals = (4*60+3*40)/100 = 3.6, items = 3 → 3.6*0.6 + 3*0.4 = 3.36 → B
    await hr.send("PUT", `/api/evaluations/sheets/${sheetId}/scores`, {
      phase: "final",
      scores: scoresAll,
      comment: "",
    });
    const done = await hr.send<EvaluationSheetDetail>(
      "POST",
      `/api/evaluations/sheets/${sheetId}/submit`,
      {},
    );
    expect(done.body.step).toBe("done");
    expect(done.body.finalScore).toBe(3.36);
    expect(done.body.finalRank).toBe("B");
    expect(done.body.events.map((e) => e.action)).toContain("remand");

    // 完了後は本人も最終結果を確認できる
    const after = await taro.get<EvaluationSheetDetail>(`/api/evaluations/sheets/${sheetId}`);
    expect(after.body.finalRank).toBe("B");
    expect(after.body.visiblePhases).toContain("final");
  });

  it("関係のない社員は評価シートを見られない", async () => {
    const hr = await login("hr@test.jp");
    const created = await hr.send<{ id: number }>("POST", "/api/evaluations/periods", {
      name: "2026上期",
      templateId: 1,
      startDate: "2026-04-01",
      endDate: "2026-09-30",
      targetDepartmentIds: [3],
    });
    const detail = await hr.get<{ sheets: EvaluationSheetSummary[] }>(
      `/api/evaluations/periods/${created.body.id}`,
    );
    const jiro = await login("jiro@test.jp");
    expect((await jiro.get(`/api/evaluations/sheets/${detail.body.sheets[0]!.id}`)).status).toBe(404);
  });
});
