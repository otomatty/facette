import { useQueries } from "@tanstack/react-query";
import { ChevronRight, Lock, UserPlus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { GENDER_LABELS, MAX_COMPARE, SKILL_LEVEL_LABELS } from "../../../shared/constants";
import { ageOn, formatDateJa, tenureYears, todayJst } from "../../../shared/dates";
import { formatFieldValue } from "../../../shared/sheets";
import type {
  EvaluationSheetSummary,
  MemberDetail,
  MemberSheetView,
  MemberSkill,
  Sheet,
} from "../../../shared/types";
import { Face, StatusBadge } from "../../components/Face";
import { MemberPicker } from "../../components/pickers";
import { Checkbox, cx, EmptyState, ErrorBox, IconButton, Loading, PageHeader } from "../../components/ui";
import { get } from "../../lib/api";

type MemberData = {
  member: MemberDetail;
  sheets: MemberSheetView[] | null;
  skills: MemberSkill[] | null;
  evaluations: EvaluationSheetSummary[] | null;
};

/** 権限がなく取得できなかった情報は null として扱う */
async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function loadMember(id: number): Promise<MemberData> {
  const [member, sheets, skills, evaluations] = await Promise.all([
    get<MemberDetail>(`/members/${id}`),
    optional(get<{ items: MemberSheetView[] }>(`/members/${id}/sheets`)),
    optional(get<{ items: MemberSkill[] }>(`/members/${id}/skills`)),
    optional(get<{ items: EvaluationSheetSummary[] }>(`/evaluations/history/${id}`)),
  ]);
  return {
    member,
    sheets: sheets?.items ?? null,
    skills: skills?.items ?? null,
    evaluations: evaluations?.items ?? null,
  };
}

export function parseCompareIds(raw: string | null): number[] {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, MAX_COMPARE);
}

type Cell = { text: string; node?: ReactNode; locked?: boolean };
type Row = { key: string; label: string; cells: Cell[] };
type Section = { title: string; rows: Row[] };

const LOCKED: Cell = { text: "", locked: true };

function differs(row: Row): boolean {
  const values = row.cells.filter((c) => !c.locked).map((c) => c.text);
  return new Set(values).size > 1;
}

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const ids = parseCompareIds(params.get("ids"));
  const [onlyDiff, setOnlyDiff] = useState(false);
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ["compare", id], queryFn: () => loadMember(id) })),
  });
  const setIds = (next: number[]) => {
    const p = new URLSearchParams(params);
    if (next.length) p.set("ids", next.join(","));
    else p.delete("ids");
    setParams(p, { replace: true });
  };

  const loading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error;
  const data = results.map((r) => r.data).filter((d): d is MemberData => !!d);
  const sections = useMemo(() => (data.length === ids.length ? buildSections(data) : []), [data, ids.length]);

  const header = (
    <>
      <nav aria-label="パンくず" className="mb-3 flex items-center gap-1 text-xs text-ink-3">
        <Link to="/members" className="hover:text-ai-700">
          メンバー
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-ink-2">比較</span>
      </nav>
      <PageHeader
        title="メンバーを比較"
        description={`最大${MAX_COMPARE}名の基本情報・評価・スキル・シートの内容を並べて比べます。閲覧権限のない項目は表示されません。`}
      />
    </>
  );

  if (!ids.length) {
    return (
      <div>
        {header}
        <EmptyState title="比較するメンバーを選んでください">
          <div className="mx-auto mt-3 w-72 text-left">
            <MemberPicker value={null} onChange={(m) => m && setIds([m.id])} id="compare-first" />
          </div>
          <p className="mt-3 text-xs text-ink-3">メンバー一覧で複数選んで「比較する」からも開けます。</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      {header}
      {error ? (
        <ErrorBox error={error} />
      ) : loading || !sections.length ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Checkbox
              label="値が異なる項目だけ表示"
              checked={onlyDiff}
              onChange={(e) => setOnlyDiff(e.target.checked)}
            />
            {ids.length < MAX_COMPARE && (
              <div className="flex w-full items-center gap-2 sm:w-80">
                <UserPlus className="size-4 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0 flex-1">
                  <MemberPicker
                    value={null}
                    placeholder="比較するメンバーを追加"
                    excludeIds={ids}
                    onChange={(m) => m && setIds([...ids, m.id])}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 w-36 min-w-36 bg-white px-4 py-3 text-left text-xs font-bold text-ink-3"
                  >
                    項目
                  </th>
                  {data.map(({ member: m }) => (
                    <th
                      key={m.id}
                      scope="col"
                      className="w-56 min-w-48 px-4 py-3 text-left align-top font-normal"
                    >
                      <div className="flex items-start gap-3">
                        <Face member={m} size={56} />
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/members/${m.id}`}
                            className="block truncate font-bold text-ink hover:text-ai-700 hover:underline"
                          >
                            {m.lastName} {m.firstName}
                          </Link>
                          <span className="tabular block text-xs text-ink-3">{m.employeeCode}</span>
                          <StatusBadge status={m.status} />
                        </div>
                        <IconButton
                          label={`${m.lastName} ${m.firstName}を比較から外す`}
                          onClick={() => setIds(ids.filter((x) => x !== m.id))}
                        >
                          <X className="size-4" />
                        </IconButton>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              {sections.map((section) => {
                const rows = onlyDiff ? section.rows.filter(differs) : section.rows;
                if (!rows.length) return null;
                return (
                  <tbody key={section.title}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={data.length + 1}
                        className="sticky left-0 bg-canvas px-4 py-2 text-left text-[13px] font-bold text-ink-2"
                      >
                        {section.title}
                      </th>
                    </tr>
                    {rows.map((row) => {
                      const diff = differs(row);
                      return (
                        <tr key={row.key} className="border-t border-line-2">
                          <th
                            scope="row"
                            className={cx(
                              "sticky left-0 z-10 border-l-[3px] bg-white py-2.5 pr-4 pl-[13px] text-left align-top text-xs font-bold text-ink-2",
                              diff ? "border-yamabuki" : "border-transparent",
                            )}
                          >
                            {row.label}
                            {diff && <span className="sr-only">（値が異なる）</span>}
                          </th>
                          {row.cells.map((cell, i) => (
                            <td key={data[i]!.member.id} className="px-4 py-2.5 align-top break-words">
                              {cell.locked ? (
                                <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                                  <Lock className="size-3" aria-hidden />
                                  権限なし
                                </span>
                              ) : (
                                (cell.node ?? (cell.text || <span className="text-ink-3">—</span>))
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            左端に黄色の線がある項目は、メンバーによって値が異なります。
          </p>
        </>
      )}
    </div>
  );
}

function buildSections(data: MemberData[]): Section[] {
  const today = todayJst();
  const basic = (label: string, key: string, fn: (m: MemberDetail) => string | null | undefined): Row => ({
    key,
    label,
    cells: data.map(({ member }) => ({ text: fn(member) ?? "" })),
  });
  /** 機微情報（null は権限なし、空文字は未登録） */
  const sensitive = (label: string, key: string, fn: (m: MemberDetail) => string | null): Row => ({
    key,
    label,
    cells: data.map(({ member }) => {
      const v = fn(member);
      return v === null ? LOCKED : { text: v };
    }),
  });

  const sections: Section[] = [
    {
      title: "基本情報",
      rows: [
        basic("部署", "dept", (m) => m.path.map((p) => p.name).join(" / ") || m.departmentName),
        basic("役職", "job", (m) => m.jobTitleName),
        sensitive("等級", "grade", (m) => (m.inScope ? (m.gradeName ?? "") : null)),
        sensitive("雇用形態", "etype", (m) => (m.inScope ? (m.employmentTypeName ?? "") : null)),
        basic("入社日", "hire", (m) => {
          const y = tenureYears(m.hireDate, today);
          return m.hireDate ? `${formatDateJa(m.hireDate)}（勤続${y ?? 0}年）` : "";
        }),
        sensitive("年齢", "age", (m) => {
          if (!m.inScope) return null;
          const age = ageOn(m.birthDate, today);
          return age === null ? "" : `${age}歳`;
        }),
        sensitive("性別", "gender", (m) => (m.inScope ? (m.gender ? GENDER_LABELS[m.gender] : "") : null)),
        basic("勤務地", "location", (m) => m.workLocation),
      ],
    },
  ];

  // 評価：比較対象のいずれかに結果がある評価期間（新しい順に3期まで）
  const periods = new Map<number, string>();
  for (const d of data)
    for (const e of d.evaluations ?? []) if (e.step === "done") periods.set(e.periodId, e.periodName);
  const periodRows: Row[] = [...periods.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([periodId, name]) => ({
      key: `eval-${periodId}`,
      label: name,
      cells: data.map((d) => {
        if (!d.evaluations) return LOCKED;
        const e = d.evaluations.find((x) => x.periodId === periodId && x.step === "done");
        if (!e) return { text: "" };
        const text = `${e.finalRank ?? ""}${e.finalScore !== null ? `（${e.finalScore.toFixed(2)}）` : ""}`;
        return {
          text,
          node: (
            <span>
              <span className="text-base font-bold">{e.finalRank ?? "—"}</span>
              {e.finalScore !== null && (
                <span className="tabular ml-1.5 text-xs text-ink-3">{e.finalScore.toFixed(2)}</span>
              )}
            </span>
          ),
        };
      }),
    }));
  if (periodRows.length) sections.push({ title: "評価結果", rows: periodRows });

  // スキル：比較対象の誰かが持っているスキル（保有人数の多い順に10件まで）
  const skillCount = new Map<number, { name: string; n: number }>();
  for (const d of data)
    for (const s of d.skills ?? []) {
      const cur = skillCount.get(s.skillId) ?? { name: s.name, n: 0 };
      cur.n++;
      skillCount.set(s.skillId, cur);
    }
  const skillRows: Row[] = [...skillCount.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name, "ja"))
    .slice(0, 10)
    .map(([skillId, { name }]) => ({
      key: `skill-${skillId}`,
      label: name,
      cells: data.map((d) => {
        if (!d.skills) return LOCKED;
        const s = d.skills.find((x) => x.skillId === skillId);
        if (!s) return { text: "" };
        return {
          text: String(s.level),
          node: <SkillLevel level={s.level} />,
        };
      }),
    }));
  if (skillRows.length) sections.push({ title: "スキル", rows: skillRows });

  // シート：誰か一人でも見られるシートを、設定の並び順で
  const sheets = new Map<number, Sheet>();
  for (const d of data) for (const v of d.sheets ?? []) sheets.set(v.sheet.id, v.sheet);
  for (const sheet of [...sheets.values()].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const views = data.map((d) => d.sheets?.find((v) => v.sheet.id === sheet.id) ?? null);
    const rows: Row[] =
      sheet.kind === "single"
        ? sheet.fields.map((f) => ({
            key: `sheet-${sheet.id}-${f.id}`,
            label: f.label,
            cells: views.map((v) => {
              if (!v) return LOCKED;
              return { text: formatFieldValue(f, v.records[0]?.data[String(f.id)]) };
            }),
          }))
        : [
            {
              key: `sheet-${sheet.id}`,
              label: `${sheet.name}（件数）`,
              cells: views.map((v) => {
                if (!v) return LOCKED;
                const first = sheet.fields[0];
                const items = first
                  ? v.records.map((r) => formatFieldValue(first, r.data[String(first.id)])).filter(Boolean)
                  : [];
                return {
                  text: v.records.length ? `${v.records.length}件:${items.join(",")}` : "",
                  node: v.records.length ? (
                    <div>
                      <span className="tabular font-bold">{v.records.length}件</span>
                      {items.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                          {items.slice(0, 4).map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                          {items.length > 4 && <li className="text-ink-3">ほか{items.length - 4}件</li>}
                        </ul>
                      )}
                    </div>
                  ) : undefined,
                };
              }),
            },
          ];
    sections.push({ title: sheet.name, rows });
  }
  return sections;
}

function SkillLevel({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={SKILL_LEVEL_LABELS[level]}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cx("h-2 w-3 rounded-sm", n <= level ? "bg-ai-700" : "bg-line-2")} />
        ))}
      </span>
      <span className="tabular text-xs text-ink-2">
        Lv{level}
        <span className="sr-only">（{SKILL_LEVEL_LABELS[level]}）</span>
      </span>
    </span>
  );
}
