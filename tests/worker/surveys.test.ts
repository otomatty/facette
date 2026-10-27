import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Survey, SurveyResults } from "../../src/shared/types";
import { login, seedBasic } from "./helpers";

beforeEach(seedBasic);

const survey = (anonymous: boolean) => ({
  title: "働き方アンケート",
  anonymous,
  questions: [
    { type: "single", text: "出社日数", options: ["0日", "1日", "2日"] },
    { type: "scale", text: "満足度" },
    { type: "nps", text: "推奨度" },
    { type: "text", text: "要望", required: false },
  ],
});

describe("アンケート", () => {
  it("作成→配信→回答→集計ができ、二重回答はできない", async () => {
    const hr = await login("hr@test.jp");
    const created = await hr.send<{ id: number }>("POST", "/api/surveys", survey(false));
    expect(created.status).toBe(201);
    const id = created.body.id;
    // 下書きは対象者に見えない
    const taro = await login("taro@test.jp");
    expect((await taro.get(`/api/surveys/${id}`)).status).toBe(404);

    const pub = await hr.send<{ targets: number }>("POST", `/api/surveys/${id}/publish`, {
      departmentIds: [2],
    });
    expect(pub.body.targets).toBe(2);
    const s = await taro.get<Survey>(`/api/surveys/${id}`);
    expect(s.body).toMatchObject({ isTarget: true, responded: false });
    const qs = s.body.questions;

    const bad = await taro.send<{ error: string }>("POST", `/api/surveys/${id}/responses`, {
      answers: { [qs[0]!.id]: "5日", [qs[1]!.id]: 3, [qs[2]!.id]: 8 },
    });
    expect(bad.status).toBe(400);
    const ok = await taro.send("POST", `/api/surveys/${id}/responses`, {
      answers: {
        [qs[0]!.id]: "2日",
        [qs[1]!.id]: 4,
        [qs[2]!.id]: 10,
        [qs[3]!.id]: "フレックスを広げてほしい",
      },
    });
    expect(ok.status).toBe(201);
    expect((await taro.send("POST", `/api/surveys/${id}/responses`, { answers: {} })).status).toBe(400);

    // 対象外は回答できない
    const jiro = await login("jiro@test.jp");
    expect((await jiro.get(`/api/surveys/${id}`)).status).toBe(404);

    const res = await hr.get<SurveyResults>(`/api/surveys/${id}/results`);
    expect(res.body.survey.responseCount).toBe(1);
    const nps = res.body.questions.find((q) => q.type === "nps")!;
    expect(nps.nps).toMatchObject({ score: 100, promoters: 1 });
    const text = res.body.questions.find((q) => q.type === "text")!.texts?.[0];
    expect(text).toMatchObject({ respondent: "山田 太郎", respondentId: expect.any(Number) });
    // 一般社員は集計を見られない
    expect((await taro.get(`/api/surveys/${id}/results`)).status).toBe(403);
  });

  it("匿名アンケートは回答者を保存せず、部署別平均は少人数なら伏せる", async () => {
    const hr = await login("hr@test.jp");
    const { body } = await hr.send<{ id: number }>("POST", "/api/surveys", survey(true));
    await hr.send("POST", `/api/surveys/${body.id}/publish`, {});
    const taro = await login("taro@test.jp");
    const s = await taro.get<Survey>(`/api/surveys/${body.id}`);
    const qs = s.body.questions;
    await taro.send("POST", `/api/surveys/${body.id}/responses`, {
      answers: { [qs[0]!.id]: "0日", [qs[1]!.id]: 2, [qs[2]!.id]: 3, [qs[3]!.id]: "匿名の声" },
    });
    const stored = await env.DB.prepare(
      "SELECT member_id, submitted_at FROM survey_responses WHERE survey_id = ?",
    )
      .bind(body.id)
      .first<{ member_id: number | null; submitted_at: string }>();
    expect(stored?.member_id).toBeNull();
    expect(stored?.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 回答が3件未満のうちは、結果も CSV も出さない
    const few = await hr.get<SurveyResults>(`/api/surveys/${body.id}/results`);
    expect(few.body.masked).toBe(true);
    expect(few.body.questions.every((q) => !q.counts && !q.texts)).toBe(true);
    expect((await hr.get(`/api/surveys/${body.id}/export`)).status).toBe(400);

    for (const email of ["jiro@test.jp", "mgr@test.jp"]) {
      const u = await login(email);
      await u.send("POST", `/api/surveys/${body.id}/responses`, {
        answers: { [qs[0]!.id]: "1日", [qs[1]!.id]: 4, [qs[2]!.id]: 7 },
      });
    }
    const res = await hr.get<SurveyResults>(`/api/surveys/${body.id}/results`);
    expect(res.body.masked).toBe(false);
    expect(res.body.questions.find((q) => q.type === "text")!.texts?.[0]?.respondent).toBeNull();
    const byDept = await hr.get<{
      rows: { cells: ({ masked: boolean; average: number | null } | null)[] }[];
    }>(`/api/surveys/${body.id}/results/by-department`);
    expect(byDept.body.rows[0]!.cells[0]).toMatchObject({ masked: true, average: null });
    const exp = await hr.get<{ csv: string }>(`/api/surveys/${body.id}/export`);
    expect(exp.body.csv.split("\r\n")[0]).not.toContain("氏名");
    expect(exp.body.csv).not.toContain("開発1課");
  });

  it("締切日を過ぎると自動で締め切られ、再開には新しい締切日が必要", async () => {
    const hr = await login("hr@test.jp");
    // 過去の締切日では作成・配信できない
    const past = await hr.send("POST", "/api/surveys", { ...survey(false), closesAt: "2020-01-01" });
    expect(past.status).toBe(400);
    const { body } = await hr.send<{ id: number }>("POST", "/api/surveys", {
      ...survey(false),
      closesAt: "2999-12-31",
    });
    await hr.send("POST", `/api/surveys/${body.id}/publish`, {});
    // 締切日が過ぎた状態にする
    await env.DB.prepare("UPDATE surveys SET closes_at = '2020-01-01' WHERE id = ?").bind(body.id).run();
    const taro = await login("taro@test.jp");
    const s = await taro.get<Survey>(`/api/surveys/${body.id}`);
    expect(s.body.status).toBe("closed");
    const qs = s.body.questions;
    const late = await taro.send("POST", `/api/surveys/${body.id}/responses`, {
      answers: { [qs[0]!.id]: "1日", [qs[1]!.id]: 3, [qs[2]!.id]: 5 },
    });
    expect(late.status).toBe(400);
    const home = await taro.get<{ todos: { kind: string }[] }>("/api/home");
    expect(home.body.todos.some((t) => t.kind === "survey")).toBe(false);

    // 締切日を延ばさずに再開はできない
    expect((await hr.send("POST", `/api/surveys/${body.id}/reopen`, {})).status).toBe(400);
    expect((await hr.send("POST", `/api/surveys/${body.id}/reopen`, { closesAt: "2020-02-01" })).status).toBe(
      400,
    );
    const reopened = await hr.send("POST", `/api/surveys/${body.id}/reopen`, { closesAt: "2999-01-31" });
    expect(reopened.status).toBe(200);
    const after = await taro.get<Survey>(`/api/surveys/${body.id}`);
    expect(after.body).toMatchObject({ status: "open", closesAt: "2999-01-31" });
    // 受付中のものは再開できない
    expect((await hr.send("POST", `/api/surveys/${body.id}/reopen`, {})).status).toBe(400);
    const logs = await env.DB.prepare("SELECT action FROM audit_logs WHERE action = 'survey.reopen'").all();
    expect(logs.results).toHaveLength(1);
  });

  it("配信後は質問を省略してタイトルや締切日だけを変更できる", async () => {
    const hr = await login("hr@test.jp");
    const { body } = await hr.send<{ id: number }>("POST", "/api/surveys", survey(false));
    // 下書きのうちは質問が必要
    expect((await hr.send("PATCH", `/api/surveys/${body.id}`, { title: "改題" })).status).toBe(400);
    await hr.send("POST", `/api/surveys/${body.id}/publish`, {});
    const res = await hr.send<{ questionsLocked: boolean }>("PATCH", `/api/surveys/${body.id}`, {
      title: "働き方アンケート（延長）",
      closesAt: "2999-03-31",
    });
    expect(res.status).toBe(200);
    expect(res.body.questionsLocked).toBe(true);
    const s = await hr.get<Survey>(`/api/surveys/${body.id}`);
    expect(s.body).toMatchObject({ title: "働き方アンケート（延長）", closesAt: "2999-03-31" });
    expect(s.body.questions).toHaveLength(4);
  });
});
