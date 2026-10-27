import { Hono } from "hono";
import { z } from "zod";
import { GENDER_LABELS, type Gender, MEMBER_STATUS_LABELS, type MemberStatus } from "../../shared/constants";
import { parseCsv, toCsv } from "../../shared/csv";
import { isIsoDate, todayJst } from "../../shared/dates";
import { formatFieldValue, normalizeRecordData } from "../../shared/sheets";
import { normalizeForSearch } from "../../shared/text";
import type { FieldValue, Sheet } from "../../shared/types";
import { audit } from "../lib/audit";
import { type AppEnv, auth, badRequest, requireAuth, requireCap } from "../lib/context";
import { all, type Bindable, batchAtomic, parseJson, placeholders } from "../lib/db";
import type { MemberRow } from "../lib/members";
import { loadSheets, sheetAccess, sheetEditableForAll, sheetVisibility } from "../lib/sheets";
import { validate } from "../lib/validate";
import { buildMemberWhere, orderBy } from "./members";

const BASE_COLUMNS = [
  "社員番号",
  "姓",
  "名",
  "姓（かな）",
  "名（かな）",
  "メールアドレス",
  "性別",
  "生年月日",
  "入社日",
  "退職日",
  "在籍状況",
  "部署コード",
  "部署",
  "役職",
  "等級",
  "雇用形態",
  "勤務地",
  "電話番号",
  "自己紹介",
] as const;

function sheetColumns(sheets: Sheet[]) {
  return sheets
    .filter((s) => s.kind === "single")
    .flatMap((s) => s.fields.map((f) => ({ header: `${s.name}:${f.label}`, sheet: s, field: f })));
}

const GENDER_BY_LABEL = Object.fromEntries(Object.entries(GENDER_LABELS).map(([k, v]) => [v, k])) as Record<
  string,
  Gender
>;
const STATUS_BY_LABEL = Object.fromEntries(
  Object.entries(MEMBER_STATUS_LABELS).map(([k, v]) => [v, k]),
) as Record<string, MemberStatus>;

function normDate(s: string): string | null {
  const t = s.trim().replace(/\//g, "-");
  if (!t) return null;
  const p = t.replace(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
  );
  return isIsoDate(p) ? p : "invalid";
}

export const ioRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .use(requireCap("manageMembers"))
  .get("/members/export", async (c) => {
    const a = auth(c);
    const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    const { where, params } = await buildMemberWhere(c, a, {
      ...query,
      departmentId: query.departmentId ? Number(query.departmentId) : undefined,
      jobTitleId: query.jobTitleId ? Number(query.jobTitleId) : undefined,
      includeSub: query.includeSub !== "false",
      status: (query.status as never) ?? "all",
    });
    const rows = await all<MemberRow & { department_code: string | null }>(
      c.env.DB,
      `SELECT m.*, d.name AS department_name, d.code AS department_code, jt.name AS job_title_name, g.name AS grade_name,
              et.name AS employment_type_name
         FROM members m LEFT JOIN departments d ON d.id = m.department_id LEFT JOIN job_titles jt ON jt.id = m.job_title_id
         LEFT JOIN grades g ON g.id = m.grade_id LEFT JOIN employment_types et ON et.id = m.employment_type_id
         ${where} ${orderBy("code")}`,
      ...params,
    );
    const sheets = await loadSheets(c.env.DB);
    // 全社員について閲覧できるシートだけを列にする（個々の社員で見られない値は空欄）
    const cols =
      query.withSheets === "false"
        ? []
        : sheetColumns(sheets).filter((x) => sheetVisibility(a, x.sheet) === "all");
    const records = new Map<string, Record<string, FieldValue>>();
    if (cols.length && rows.length) {
      const ids = rows.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const recs = await all<{ sheet_id: number; member_id: number; data: string }>(
          c.env.DB,
          `SELECT sheet_id, member_id, data FROM sheet_records WHERE member_id IN (${placeholders(chunk.length)})`,
          ...chunk,
        );
        for (const r of recs) records.set(`${r.sheet_id}:${r.member_id}`, parseJson(r.data, {}));
      }
    }
    const csv = toCsv([
      [...BASE_COLUMNS, ...cols.map((x) => x.header)],
      ...rows.map((m) => [
        m.employee_code,
        m.last_name,
        m.first_name,
        m.last_name_kana,
        m.first_name_kana,
        m.email,
        GENDER_LABELS[m.gender],
        m.birth_date,
        m.hire_date,
        m.leave_date,
        MEMBER_STATUS_LABELS[m.status],
        m.department_code,
        m.department_name,
        m.job_title_name,
        m.grade_name,
        m.employment_type_name,
        m.work_location,
        m.phone,
        m.bio,
        ...cols.map((x) => {
          if (sheetAccess(a, x.sheet, m) === "none") return "";
          const v = records.get(`${x.sheet.id}:${m.id}`)?.[String(x.field.id)];
          if (x.field.type === "multiselect" && Array.isArray(v)) return v.join("|");
          if (x.field.type === "checkbox") return v ? "はい" : "";
          if (x.field.type === "number") return typeof v === "number" ? v : "";
          return formatFieldValue(x.field, v);
        }),
      ]),
    ]);
    await audit(c, "member.export", `社員データを CSV で出力しました（${rows.length}名）`);
    return c.json({ filename: `社員データ_${todayJst()}.csv`, csv, count: rows.length });
  })
  .get("/members/template", async (c) => {
    const a = auth(c);
    const sheets = await loadSheets(c.env.DB);
    const editable = sheetColumns(sheets).filter((x) => sheetEditableForAll(a, x.sheet));
    const csv = toCsv([[...BASE_COLUMNS, ...editable.map((x) => x.header)]]);
    return c.json({ filename: "社員データ_取込テンプレート.csv", csv });
  })
  .post(
    "/members/import",
    validate("json", z.object({ csv: z.string().max(5_000_000), dryRun: z.boolean().default(true) })),
    async (c) => {
      const a = auth(c);
      const { csv, dryRun } = c.req.valid("json");
      const rows = parseCsv(csv);
      if (rows.length < 2) badRequest("ヘッダー行とデータ行が必要です");
      const header = rows[0]!.map((h) => h.trim());
      const idx = (name: string) => header.indexOf(name);
      if (idx("社員番号") < 0) badRequest("「社員番号」列が必要です");
      if (rows.length > 3001) badRequest("一度に取り込めるのは3000行までです");

      const db = c.env.DB;
      const [depts, jts, grades, ets, existing, sheets] = await Promise.all([
        all<{ id: number; name: string; code: string | null }>(db, "SELECT id, name, code FROM departments"),
        all<{ id: number; name: string }>(db, "SELECT id, name FROM job_titles"),
        all<{ id: number; name: string }>(db, "SELECT id, name FROM grades"),
        all<{ id: number; name: string }>(db, "SELECT id, name FROM employment_types"),
        all<{ id: number; employee_code: string; department_id: number | null; job_title_id: number | null }>(
          db,
          "SELECT id, employee_code, department_id, job_title_id FROM members",
        ),
        loadSheets(db),
      ]);
      const byCode = new Map(existing.map((m) => [m.employee_code, m]));
      // 編集権限のないシートの列は取り込まない（取り込めない列として返す）
      const sCols = sheetColumns(sheets).filter((x) => idx(x.header) >= 0 && sheetEditableForAll(a, x.sheet));
      const unknownHeaders = header.filter(
        (h) => h && !(BASE_COLUMNS as readonly string[]).includes(h) && !sCols.some((x) => x.header === h),
      );

      const errors: { row: number; message: string }[] = [];
      let created = 0;
      let updated = 0;
      const stmts: D1PreparedStatement[] = [];
      const pendingSheetData: { code: string; sheetId: number; data: Record<string, unknown> }[] = [];
      const seen = new Set<string>();
      const today = todayJst();

      for (let r = 1; r < rows.length; r++) {
        const line = rows[r]!;
        const get = (name: string) => {
          const i = idx(name);
          return i >= 0 ? (line[i] ?? "").trim() : undefined;
        };
        const code = get("社員番号") ?? "";
        const rowNo = r + 1;
        if (!code) {
          errors.push({ row: rowNo, message: "社員番号が空です" });
          continue;
        }
        if (seen.has(code)) {
          errors.push({ row: rowNo, message: `社員番号 ${code} が重複しています` });
          continue;
        }
        seen.add(code);
        const ex = byCode.get(code);
        const set: Record<string, Bindable> = {};
        const rowErrors: string[] = [];
        const text = (col: string, key: string, max: number, kana = false) => {
          const v = get(col);
          // 空欄は「変更しない」（新規の場合は既定値）
          if (v === undefined || v === "") return;
          if (v.length > max) rowErrors.push(`${col}は${max}文字以内にしてください`);
          set[key] = kana ? normalizeForSearch(v) : v;
        };
        text("姓", "last_name", 40);
        text("名", "first_name", 40);
        text("姓（かな）", "last_name_kana", 60, true);
        text("名（かな）", "first_name_kana", 60, true);
        text("メールアドレス", "email", 200);
        text("勤務地", "work_location", 60);
        text("電話番号", "phone", 40);
        text("自己紹介", "bio", 1000);
        for (const [col, key] of [
          ["生年月日", "birth_date"],
          ["入社日", "hire_date"],
          ["退職日", "leave_date"],
        ] as const) {
          const v = get(col);
          if (v === undefined || v === "") continue;
          const d = normDate(v);
          if (d === "invalid") rowErrors.push(`${col}「${v}」は日付として読み取れません`);
          else set[key] = d;
        }
        const g = get("性別");
        if (g) {
          if (!GENDER_BY_LABEL[g])
            rowErrors.push(`性別「${g}」は 男性/女性/その他/未回答 のいずれかにしてください`);
          else set.gender = GENDER_BY_LABEL[g]!;
        }
        const st = get("在籍状況");
        if (st) {
          if (!STATUS_BY_LABEL[st])
            rowErrors.push(`在籍状況「${st}」は 在籍/休職/退職 のいずれかにしてください`);
          else set.status = STATUS_BY_LABEL[st]!;
        }
        const deptCode = get("部署コード");
        const deptName = get("部署");
        if (deptCode || deptName) {
          const d = deptCode
            ? depts.find((x) => x.code === deptCode)
            : depts.find((x) => x.name === deptName);
          if (!d) rowErrors.push(`部署「${deptCode || deptName}」が見つかりません`);
          else set.department_id = d.id;
        }
        for (const [col, key, list] of [
          ["役職", "job_title_id", jts],
          ["等級", "grade_id", grades],
          ["雇用形態", "employment_type_id", ets],
        ] as const) {
          const v = get(col);
          if (!v) continue;
          const found = list.find((x) => x.name === v);
          if (!found) rowErrors.push(`${col}「${v}」がマスタにありません`);
          else set[key] = found.id;
        }
        if (!ex && (!set.last_name || !set.first_name)) rowErrors.push("新規登録には姓と名が必要です");
        if (typeof set.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set.email)) {
          rowErrors.push("メールアドレスの形式が正しくありません");
        }
        // シート項目
        const bySheet = new Map<number, Record<string, unknown>>();
        for (const col of sCols) {
          const v = get(col.header);
          if (v === undefined || v === "") continue;
          const data = bySheet.get(col.sheet.id) ?? {};
          data[String(col.field.id)] = col.field.type === "multiselect" ? v.split("|").filter(Boolean) : v;
          bySheet.set(col.sheet.id, data);
        }
        for (const [sheetId, data] of bySheet) {
          const sheet = sheets.find((s) => s.id === sheetId)!;
          // 自分自身の行は本人としての権限で判定する（自分の評価などは書き換えられない）
          if (ex && sheetAccess(a, sheet, ex) !== "edit") {
            rowErrors.push(`「${sheet.name}」を編集する権限がありません`);
            continue;
          }
          // 部分的な列だけでも検証できるよう、対象の項目だけで正規化する
          const fields = sheet.fields
            .filter((f) => String(f.id) in data)
            .map((f) => ({ ...f, required: false }));
          const res = normalizeRecordData(fields, data);
          if (!res.ok) rowErrors.push(...Object.values(res.errors).map((e) => `${sheet.name}：${e}`));
          else pendingSheetData.push({ code, sheetId, data: res.data });
        }
        if (rowErrors.length) {
          errors.push({ row: rowNo, message: rowErrors.join(" / ") });
          continue;
        }
        if (ex) {
          updated++;
          const keys = Object.keys(set);
          if (keys.length) {
            stmts.push(
              db
                .prepare(
                  `UPDATE members SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
                )
                .bind(...(keys.map((k) => set[k]) as (string | number | null)[]), ex.id),
            );
            const deptChanged = "department_id" in set && set.department_id !== ex.department_id;
            const jtChanged = "job_title_id" in set && set.job_title_id !== ex.job_title_id;
            if (deptChanged || jtChanged) {
              stmts.push(
                db
                  .prepare(
                    `INSERT INTO member_transfers (member_id, effective_date, from_department_id, to_department_id, from_job_title_id, to_job_title_id, note)
                     VALUES (?, ?, ?, ?, ?, ?, 'CSV 取り込みによる変更')`,
                  )
                  .bind(
                    ex.id,
                    today,
                    ex.department_id,
                    (set.department_id as number | undefined) ?? ex.department_id,
                    ex.job_title_id,
                    (set.job_title_id as number | undefined) ?? ex.job_title_id,
                  ),
              );
            }
          }
        } else {
          created++;
          const cols = ["employee_code", ...Object.keys(set), "avatar_seed"];
          stmts.push(
            db
              .prepare(`INSERT INTO members (${cols.join(", ")}) VALUES (${placeholders(cols.length)})`)
              .bind(
                code,
                ...(Object.values(set) as (string | number | null)[]),
                Math.floor(Math.random() * 2_000_000_000),
              ),
          );
        }
      }

      if (!dryRun && !errors.length) {
        await batchAtomic(db, stmts);
        if (pendingSheetData.length) {
          const members = await all<{ id: number; employee_code: string }>(
            db,
            "SELECT id, employee_code FROM members",
          );
          const idByCode = new Map(members.map((m) => [m.employee_code, m.id]));
          const recs = await all<{ id: number; sheet_id: number; member_id: number; data: string }>(
            db,
            "SELECT id, sheet_id, member_id, data FROM sheet_records WHERE sheet_id IN (SELECT id FROM sheets WHERE kind = 'single')",
          );
          const recMap = new Map(recs.map((r) => [`${r.sheet_id}:${r.member_id}`, r]));
          const sheetStmts: D1PreparedStatement[] = [];
          for (const p of pendingSheetData) {
            const memberId = idByCode.get(p.code);
            if (!memberId) continue;
            const rec = recMap.get(`${p.sheetId}:${memberId}`);
            if (rec) {
              sheetStmts.push(
                db
                  .prepare("UPDATE sheet_records SET data = ?, updated_at = datetime('now') WHERE id = ?")
                  .bind(
                    JSON.stringify({ ...parseJson<Record<string, unknown>>(rec.data, {}), ...p.data }),
                    rec.id,
                  ),
              );
            } else {
              sheetStmts.push(
                db
                  .prepare("INSERT INTO sheet_records (sheet_id, member_id, data) VALUES (?, ?, ?)")
                  .bind(p.sheetId, memberId, JSON.stringify(p.data)),
              );
            }
          }
          await batchAtomic(db, sheetStmts);
        }
        await audit(
          c,
          "member.import",
          `CSV から社員データを取り込みました（新規 ${created}名・更新 ${updated}名）`,
        );
      }
      return c.json({
        dryRun: dryRun || errors.length > 0,
        created,
        updated,
        errors: errors.slice(0, 200),
        errorCount: errors.length,
        unknownHeaders,
        sheetColumns: sCols.map((x) => x.header),
      });
    },
  );
