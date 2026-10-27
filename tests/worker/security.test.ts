import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  EvaluationSheetDetail,
  EvaluationSheetSummary,
  MemberSheetView,
  MemberSummary,
  OneOnOne,
  Paged,
} from "../../src/shared/types";
import { anon, login, PASSWORD, seedBasic } from "./helpers";

beforeEach(seedBasic);

describe("本人に非公開の情報", () => {
  it("人事でも、本人に非公開のシートは自分の分を見られない", async () => {
    await env.DB.prepare(
      'INSERT INTO sheet_records (sheet_id, member_id, data) VALUES (3, 1, \'{"3":"低"}\')',
    ).run();
    const hr = await login("hr@test.jp");
    const own = await hr.get<{ items: MemberSheetView[] }>("/api/members/1/sheets");
    expect(own.body.items.some((v) => v.sheet.id === 3)).toBe(false);
    const other = await hr.get<{ items: MemberSheetView[] }>("/api/members/3/sheets");
    expect(other.body.items.some((v) => v.sheet.id === 3)).toBe(true);
    // 項目による検索でも自分は結果に出ない
    const search = await hr.get<Paged<MemberSummary>>("/api/members?fieldId=3&fieldValue=低");
    expect(search.body.items.map((m) => m.id)).toEqual([4]);
  });

  it("マネージャーは本人に非公開の項目で検索しても自分が含まれない", async () => {
    await env.DB.prepare(
      'INSERT INTO sheet_records (sheet_id, member_id, data) VALUES (3, 2, \'{"3":"高"}\')',
    ).run();
    const mgr = await login("mgr@test.jp");
    const res = await mgr.get<Paged<MemberSummary>>("/api/members?fieldId=3&fieldValue=高");
    expect(res.body.items.map((m) => m.id)).toEqual([3]);
  });

  it("人事でも、自分が受けた面談の非共有の記録とコンディションは見られない", async () => {
    const admin = await login("admin@test.jp");
    const base = { memberId: 1, heldOn: "2026-10-01", title: "定例", notes: "メモ", condition: 2 };
    await admin.send("POST", "/api/one-on-ones", { ...base, sharedWithMember: false });
    await admin.send("POST", "/api/one-on-ones", { ...base, title: "共有", sharedWithMember: true });
    const hr = await login("hr@test.jp");
    const list = await hr.get<{ items: OneOnOne[] }>("/api/one-on-ones?memberId=1");
    expect(list.body.items.map((o) => o.title)).toEqual(["共有"]);
    expect(list.body.items[0]!.condition).toBeNull();
    expect(list.body.items[0]!.canEdit).toBe(false);
    // 面談の一覧（最終面談日）にも自分の分は出さない
    const last = await hr.get<{ items: { memberId: number }[] }>("/api/one-on-ones/last-held");
    expect(last.body.items.some((x) => x.memberId === 1)).toBe(false);
  });

  it("面談を受ける本人を面談者にはできない", async () => {
    const admin = await login("admin@test.jp");
    const res = await admin.send("POST", "/api/one-on-ones", {
      memberId: 3,
      interviewerMemberId: 3,
      heldOn: "2026-10-01",
      title: "定例",
    });
    expect(res.status).toBe(400);
  });
});

describe("評価", () => {
  async function setupPeriod() {
    const db = env.DB;
    await db.batch([
      db.prepare("DELETE FROM evaluation_periods"),
      db.prepare("DELETE FROM evaluation_templates"),
      db.prepare(`INSERT INTO evaluation_templates (id, name, scale_max, goal_weight, competency_weight, rank_rules)
        VALUES (1, '総合評価', 5, 0, 100, '[{"rank":"A","min":3},{"rank":"C","min":0}]')`),
      db.prepare(
        "INSERT INTO evaluation_template_items (id, template_id, title, weight, sort_order) VALUES (1, 1, '主体性', 1, 1)",
      ),
    ]);
    const admin = await login("admin@test.jp");
    const res = await admin.send<{ id: number }>("POST", "/api/evaluations/periods", {
      name: "2026上期",
      templateId: 1,
      startDate: "2026-04-01",
      endDate: "2026-09-30",
      useSecondStep: false,
      targetDepartmentIds: [1, 2],
    });
    await admin.send("PATCH", `/api/evaluations/periods/${res.body.id}`, { status: "active" });
    const sheets = await env.DB.prepare("SELECT id, member_id FROM evaluation_sheets").all<{
      id: number;
      member_id: number;
    }>();
    const sheetOf = (memberId: number) => sheets.results.find((s) => s.member_id === memberId)!.id;
    return { admin, sheetOf };
  }

  it("人事は自分自身の評価を確定したり、評価者の点数を見たりできない", async () => {
    const { sheetOf } = await setupPeriod();
    const own = sheetOf(1);
    await env.DB.batch([
      env.DB.prepare("UPDATE evaluation_sheets SET step = 'final' WHERE id = ?").bind(own),
      env.DB.prepare(
        "INSERT INTO evaluation_scores (sheet_id, phase, target_type, target_id, score, comment) VALUES (?, 'first', 'item', 1, 2, '一次の所見')",
      ).bind(own),
    ]);
    const hr = await login("hr@test.jp");
    const detail = await hr.get<EvaluationSheetDetail>(`/api/evaluations/sheets/${own}`);
    expect(detail.status).toBe(200);
    expect(detail.body.editable).toBeNull();
    expect(detail.body.scores.first).toBeUndefined();
    const submit = await hr.send("POST", `/api/evaluations/sheets/${own}/submit`, { comment: "" });
    expect(submit.status).toBe(403);
    const evaluators = await hr.send("PATCH", `/api/evaluations/sheets/${own}/evaluators`, {
      firstEvaluatorId: null,
      secondEvaluatorId: null,
    });
    expect(evaluators.status).toBe(403);
    // 期間の一覧でも自分の結果は完了まで伏せる
    await env.DB.prepare("UPDATE evaluation_sheets SET final_score = 2, final_rank = 'C' WHERE id = ?")
      .bind(own)
      .run();
    const history = await hr.get<{ items: EvaluationSheetSummary[] }>("/api/evaluations/history/1");
    expect(history.body.items[0]!.finalRank).toBeNull();
  });

  it("評価対象者には、評価者の提出時のコメントを見せず、自分あての差し戻し理由は見せる", async () => {
    const { sheetOf } = await setupPeriod();
    const sheet = sheetOf(3);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO evaluation_events (sheet_id, action, from_step, to_step, user_id, comment) VALUES (?, 'submit', 'first', 'final', 3, '昇格は見送りが妥当')",
      ).bind(sheet),
      env.DB.prepare(
        "INSERT INTO evaluation_events (sheet_id, action, from_step, to_step, user_id, comment) VALUES (?, 'remand', 'first', 'self', 3, '根拠を追記してください')",
      ).bind(sheet),
    ]);
    const taro = await login("taro@test.jp");
    const detail = await taro.get<EvaluationSheetDetail>(`/api/evaluations/sheets/${sheet}`);
    const comments = detail.body.events.map((e) => e.comment);
    expect(comments).toContain("根拠を追記してください");
    expect(comments).not.toContain("昇格は見送りが妥当");
  });
});

describe("CSV 入出力の権限", () => {
  it("人事に非表示のシートは出力せず、閲覧のみのシートは取り込まない", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE sheet_permissions SET access = 'none' WHERE sheet_id = 3 AND role = 'hr'"),
      env.DB.prepare("UPDATE sheet_permissions SET access = 'view' WHERE sheet_id = 2 AND role = 'hr'"),
    ]);
    const hr = await login("hr@test.jp");
    const exp = await hr.get<{ csv: string }>("/api/io/members/export");
    const header = exp.body.csv.split("\r\n")[0]!;
    expect(header).not.toContain("タレント:");
    expect(header).toContain("人事情報:居住地");

    const csv = "社員番号,人事情報:居住地\r\nE003,大阪府\r\n";
    const res = await hr.send<{ unknownHeaders: string[]; sheetColumns: string[] }>(
      "POST",
      "/api/io/members/import",
      { csv, dryRun: false },
    );
    expect(res.body.unknownHeaders).toContain("人事情報:居住地");
    const rec = await env.DB.prepare(
      "SELECT data FROM sheet_records WHERE sheet_id = 2 AND member_id = 3",
    ).first<{
      data: string;
    }>();
    expect(JSON.parse(rec!.data)["2"]).toBe("東京都");
  });

  it("人事は自分の行の、本人に非公開のシートを取り込めない", async () => {
    const hr = await login("hr@test.jp");
    const csv = "社員番号,タレント:パフォーマンス\r\nE001,高\r\n";
    const res = await hr.send<{ errorCount: number }>("POST", "/api/io/members/import", {
      csv,
      dryRun: true,
    });
    expect(res.body.errorCount).toBe(1);
  });
});

describe("認証", () => {
  it("同時にパスワードを間違えても失敗回数を数え漏らさずロックする", async () => {
    const tries = Array.from({ length: 12 }, () =>
      anon.send("POST", "/api/auth/login", { email: "taro@test.jp", password: "wrong-password" }),
    );
    await Promise.all(tries);
    const res = await anon.send("POST", "/api/auth/login", {
      email: "taro@test.jp",
      password: PASSWORD,
    });
    expect(res.status).toBe(429);
  });

  it("パスワードを変更すると、ほかの端末のセッションは無効になる", async () => {
    const a = await login("taro@test.jp");
    const b = await login("taro@test.jp");
    const res = await a.send("POST", "/api/auth/password", {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });
    expect(res.status).toBe(200);
    expect((await a.get("/api/auth/me")).status).toBe(200);
    expect((await b.get("/api/auth/me")).status).toBe(401);
  });

  it("デモモードの間はデモアカウントを無効化・削除できない", async () => {
    const admin = await login("admin@test.jp");
    const res = await admin.send("PATCH", "/api/users/2", {
      email: "hr@test.jp",
      displayName: "人事 花子",
      role: "hr",
      memberId: 1,
      active: false,
    });
    expect(res.status).toBe(403);
    expect((await admin.send("DELETE", "/api/users/2")).status).toBe(403);
  });
});

describe("配置シミュレーション", () => {
  it("存在しない部署を含む保存は拒否し、保存済みの案は壊さない", async () => {
    const hr = await login("hr@test.jp");
    const { body } = await hr.send<{ id: number }>("POST", "/api/placement", { name: "来期案" });
    await hr.send("PUT", `/api/placement/${body.id}/moves`, {
      moves: [{ memberId: 3, toDepartmentId: 4, toJobTitleId: null }],
    });
    const bad = await hr.send("PUT", `/api/placement/${body.id}/moves`, {
      moves: [
        { memberId: 3, toDepartmentId: 2, toJobTitleId: null },
        { memberId: 4, toDepartmentId: 9999, toJobTitleId: null },
      ],
    });
    expect(bad.status).toBe(400);
    const moves = await env.DB.prepare(
      "SELECT member_id, to_department_id FROM placement_moves WHERE scenario_id = ?",
    )
      .bind(body.id)
      .all();
    expect(moves.results).toEqual([{ member_id: 3, to_department_id: 4 }]);
  });
});

describe("変更申請の審査", () => {
  it("自分の申請は承認できず、編集権限のない人事も承認できない", async () => {
    const hr = await login("hr@test.jp");
    const req = await hr.send<{ id: number }>("POST", "/api/requests", {
      sheetId: 2,
      data: { "2": "大阪府" },
      reason: "転居のため",
    });
    expect(req.status).toBe(201);
    expect((await hr.send("POST", `/api/requests/${req.body.id}/approve`, {})).status).toBe(403);

    const taro = await login("taro@test.jp");
    const other = await taro.send<{ id: number }>("POST", "/api/requests", {
      sheetId: 2,
      data: { "2": "大阪府" },
      reason: "転居のため",
    });
    await env.DB.prepare(
      "UPDATE sheet_permissions SET access = 'view' WHERE sheet_id = 2 AND role = 'hr'",
    ).run();
    expect((await hr.send("POST", `/api/requests/${other.body.id}/approve`, {})).status).toBe(403);

    const admin = await login("admin@test.jp");
    expect((await admin.send("POST", `/api/requests/${req.body.id}/approve`, {})).status).toBe(200);
  });
});
