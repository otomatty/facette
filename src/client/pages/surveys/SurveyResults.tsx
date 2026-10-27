import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { SURVEY_QUESTION_TYPE_LABELS } from "../../../shared/constants";
import type { ChartData, SurveyQuestionResult, SurveyResults } from "../../../shared/types";
import { BarChart, ColumnChart, Meter } from "../../components/charts";
import { Face } from "../../components/Face";
import { Badge, Button, cx, ErrorBox, Input, Loading, Panel } from "../../components/ui";
import { get } from "../../lib/api";
import { buildDeptTree, flattenDeptTree, useAllMembers, useMasters } from "../../lib/queries";
import { rate } from "./parts";

type ByDepartment = {
  questions: { id: number; text: string }[];
  rows: {
    departmentId: number | null;
    departmentName: string;
    cells: ({ n: number; average: number | null; masked: boolean } | null)[];
  }[];
};

const pct = (n: number, d: number) => `${rate(n, d)}%`;

function chartOf(counts: { label: string; count: number }[], labels?: string[]): ChartData {
  return {
    labels: labels ?? counts.map((c) => c.label),
    series: [{ name: "回答数", values: counts.map((c) => c.count) }],
    total: counts.reduce((s, c) => s + c.count, 0),
  };
}

/** 部署の階層の深さ（表のインデント用） */
function useDeptDepth() {
  const masters = useMasters();
  return useMemo(() => {
    const map = new Map<number, number>();
    if (masters.data)
      for (const d of flattenDeptTree(buildDeptTree(masters.data.departments))) map.set(d.id, d.depth);
    return map;
  }, [masters.data]);
}

export function SurveyResultsView({ results }: { results: SurveyResults }) {
  const { survey } = results;
  const scaleAverages = new Map(
    results.questions.filter((q) => q.type === "scale").map((q) => [q.questionId, q.average ?? null]),
  );
  return (
    <div className="space-y-5">
      {survey.anonymous && (
        <p className="flex items-start gap-2 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ai-600" aria-hidden />
          匿名で集計しています。回答者の氏名は表示されず、部署別の平均は回答3件未満の部署を伏せています。
        </p>
      )}
      <section aria-labelledby="results-by-question" className="space-y-4">
        <h2 id="results-by-question" className="text-[17px] font-bold">
          質問ごとの結果
        </h2>
        {results.questions.map((q, i) => (
          <QuestionResult key={q.questionId} index={i} q={q} responses={survey.responseCount} />
        ))}
      </section>
      <section aria-labelledby="results-by-dept" className="space-y-4">
        <h2 id="results-by-dept" className="text-[17px] font-bold">
          部署別の状況
        </h2>
        <DepartmentRates rows={results.byDepartment} />
        <DepartmentScale surveyId={survey.id} overall={scaleAverages} />
      </section>
    </div>
  );
}

function QuestionResult({
  q,
  index,
  responses,
}: {
  q: SurveyQuestionResult;
  index: number;
  responses: number;
}) {
  return (
    <Panel
      title={
        <span className="block whitespace-normal">
          <span className="tabular mr-2 text-ai-700">Q{index + 1}</span>
          {q.text}
        </span>
      }
      description={
        <>
          {SURVEY_QUESTION_TYPE_LABELS[q.type]}
          <span className="tabular ml-3">
            回答 {q.answered}件{responses > 0 && q.answered < responses && `（回答者${responses}名中）`}
          </span>
        </>
      }
    >
      {q.answered === 0 ? (
        <p className="py-4 text-center text-sm text-ink-3">まだ回答がありません。</p>
      ) : q.type === "single" || q.type === "multi" ? (
        <ChoiceResult q={q} />
      ) : q.type === "scale" ? (
        <ScaleResult q={q} />
      ) : q.type === "nps" ? (
        <NpsResult q={q} />
      ) : (
        <TextResult q={q} />
      )}
    </Panel>
  );
}

function ChoiceResult({ q }: { q: SurveyQuestionResult }) {
  const counts = q.counts ?? [];
  const top = [...counts].sort((a, b) => b.count - a.count)[0];
  return (
    <div className="space-y-3">
      {q.type === "multi" && (
        <p className="text-xs text-ink-3">複数回答のため、合計は回答件数を上回ります。</p>
      )}
      <BarChart data={chartOf(counts)} />
      {top && top.count > 0 && (
        <p className="text-[13px] text-ink-2">
          最も多い回答は「<span className="font-bold text-ink">{top.label}</span>」
          <span className="tabular ml-1">
            {top.count}件（回答者の{pct(top.count, q.answered)}）
          </span>
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tabular text-[26px] leading-tight font-bold">
        {value}
        {sub && <span className="ml-1 text-sm font-normal text-ink-3">{sub}</span>}
      </dd>
    </div>
  );
}

function ScaleResult({ q }: { q: SurveyQuestionResult }) {
  const counts = q.counts ?? [];
  const n = counts.reduce((s, c) => s + c.count, 0);
  const positive = counts.filter((c) => Number(c.label) >= 4).reduce((s, c) => s + c.count, 0);
  const negative = counts.filter((c) => Number(c.label) <= 2).reduce((s, c) => s + c.count, 0);
  return (
    <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
      <dl className="grid grid-cols-3 gap-3 md:grid-cols-1 md:content-start">
        <Stat label="平均" value={q.average?.toFixed(2) ?? "—"} sub="/ 5" />
        <Stat label="肯定的（4〜5）" value={pct(positive, n)} />
        <Stat label="否定的（1〜2）" value={pct(negative, n)} />
      </dl>
      <div className="min-w-0">
        <ColumnChart height={180} data={chartOf(counts)} />
        <p className="mt-1 text-right text-[11px] text-ink-3">1 そう思わない ／ 5 そう思う</p>
      </div>
    </div>
  );
}

function NpsResult({ q }: { q: SurveyQuestionResult }) {
  const nps = q.nps;
  const counts = q.counts ?? [];
  const n = nps ? nps.promoters + nps.passives + nps.detractors : 0;
  const parts = nps
    ? ([
        { label: "推奨者（9〜10）", count: nps.promoters, tone: "wakaba" },
        { label: "中立者（7〜8）", count: nps.passives, tone: "ai" },
        { label: "批判者（0〜6）", count: nps.detractors, tone: "yamabuki" },
      ] as const)
    : [];
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          <Stat
            label="NPS"
            value={nps ? `${nps.score > 0 ? "+" : ""}${nps.score}` : "—"}
            className={cx(nps && nps.score < 0 && "[&_dd]:text-beni")}
          />
          <Stat label="平均" value={q.average?.toFixed(1) ?? "—"} sub="/ 10" />
        </dl>
        <p className="text-xs text-ink-3">NPS は推奨者の割合から批判者の割合を引いた値です（−100〜+100）。</p>
        <ul className="space-y-2.5">
          {parts.map((p) => (
            <li key={p.label}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-ink-2">{p.label}</span>
                <span className="tabular">
                  <span className="font-bold">{pct(p.count, n)}</span>
                  <span className="ml-1.5 text-xs text-ink-3">{p.count}件</span>
                </span>
              </div>
              <Meter value={p.count} max={Math.max(1, n)} tone={p.tone} />
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        <ColumnChart height={200} data={chartOf(counts)} />
      </div>
    </div>
  );
}

const TEXT_PAGE = 10;

/** 記名アンケートの回答者を社員IDから引く */
function useMembersById(enabled: boolean) {
  const all = useAllMembers();
  return useMemo(
    () => new Map(enabled && all.data ? all.data.map((m) => [m.id, m]) : []),
    [all.data, enabled],
  );
}

function TextResult({ q }: { q: SurveyQuestionResult }) {
  const texts = q.texts ?? [];
  const named = texts.some((t) => t.respondent);
  const byId = useMembersById(named);
  const [limit, setLimit] = useState(TEXT_PAGE);
  const [filter, setFilter] = useState("");
  const shown = filter.trim()
    ? texts.filter((t) => t.text.includes(filter.trim()) || t.respondent?.includes(filter.trim()))
    : texts;
  return (
    <div className="space-y-3">
      {texts.length > TEXT_PAGE && (
        <Input
          aria-label="回答を絞り込む"
          placeholder="キーワードで絞り込む"
          className="max-w-72"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {shown.length === 0 ? (
        <p className="py-3 text-sm text-ink-3">条件に合う回答がありません。</p>
      ) : (
        <ul className="divide-y divide-line-2 rounded-md border border-line-2">
          {shown.slice(0, limit).map((t, i) => {
            const m = t.respondentId ? byId.get(t.respondentId) : undefined;
            return (
              <li key={i} className="flex gap-3 px-3 py-2.5">
                {t.respondent && (
                  <div className="flex w-32 shrink-0 items-start gap-2 sm:w-40">
                    {m && <Face member={m} size={28} />}
                    {m ? (
                      <Link
                        to={`/members/${m.id}`}
                        className="min-w-0 pt-1 text-xs font-bold break-words text-ink-2 hover:text-ai-700 hover:underline"
                      >
                        {t.respondent}
                      </Link>
                    ) : (
                      <span className="min-w-0 pt-1 text-xs font-bold break-words text-ink-2">
                        {t.respondent}
                      </span>
                    )}
                  </div>
                )}
                <p className="min-w-0 flex-1 text-sm leading-relaxed break-words whitespace-pre-wrap">
                  {t.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => setLimit((l) => l + 30)}>
            さらに表示
          </Button>
          <span className="tabular text-xs text-ink-3">
            {shown.length}件中 {limit}件を表示
          </span>
        </div>
      )}
    </div>
  );
}

function DepartmentRates({ rows }: { rows: SurveyResults["byDepartment"] }) {
  const depth = useDeptDepth();
  if (rows.length === 0)
    return (
      <Panel title="部署別の回答率">
        <p className="text-sm text-ink-3">対象者がいません。</p>
      </Panel>
    );
  return (
    <Panel title="部署別の回答率" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
            <tr>
              <th className="px-4 py-2 font-normal">部署</th>
              <th className="px-3 py-2 text-right font-normal whitespace-nowrap">対象者</th>
              <th className="px-3 py-2 text-right font-normal whitespace-nowrap">回答</th>
              <th className="w-56 min-w-40 px-4 py-2 font-normal whitespace-nowrap">回答率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {rows.map((r) => {
              const value = rate(r.responses, r.targets);
              return (
                <tr key={r.departmentId ?? "none"}>
                  <td className="px-4 py-2">
                    <span
                      className="block whitespace-nowrap"
                      style={{
                        paddingLeft: `${(r.departmentId !== null ? (depth.get(r.departmentId) ?? 0) : 0) * 14}px`,
                      }}
                    >
                      {r.departmentName}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">{r.targets}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">{r.responses}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tabular w-12 shrink-0 text-right text-xs font-bold">{value}%</span>
                      <Meter value={value} tone={value >= 80 ? "wakaba" : "ai"} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DepartmentScale({ surveyId, overall }: { surveyId: number; overall: Map<number, number | null> }) {
  const depth = useDeptDepth();
  const query = useQuery({
    queryKey: ["survey", surveyId, "by-department"],
    queryFn: () => get<ByDepartment>(`/surveys/${surveyId}/results/by-department`),
  });
  if (query.isLoading)
    return (
      <Panel title="5段階評価の部署別平均">
        <Loading />
      </Panel>
    );
  if (query.error) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data || data.questions.length === 0) return null;
  const masked = data.rows.some((r) => r.cells.some((c) => c?.masked));
  return (
    <Panel
      title="5段階評価の部署別平均"
      description="全体の平均との差が0.3以上ある値に印をつけています"
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
            <tr>
              <th className="sticky left-0 bg-canvas px-4 py-2 font-normal">部署</th>
              {data.questions.map((q, i) => (
                <th key={q.id} className="min-w-28 px-3 py-2 text-right font-normal" title={q.text}>
                  質問{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            <tr className="bg-ai-50/50 font-bold">
              <td className="sticky left-0 bg-ai-50 px-4 py-2">全体</td>
              {data.questions.map((q) => (
                <td key={q.id} className="tabular px-3 py-2 text-right">
                  {overall.get(q.id)?.toFixed(2) ?? "—"}
                </td>
              ))}
            </tr>
            {data.rows.map((r) => (
              <tr key={r.departmentId ?? "none"}>
                <td className="sticky left-0 bg-white px-4 py-2">
                  <span
                    className="block max-w-56 truncate"
                    style={{
                      paddingLeft: `${(r.departmentId !== null ? (depth.get(r.departmentId) ?? 0) : 0) * 14}px`,
                    }}
                  >
                    {r.departmentName}
                  </span>
                </td>
                {r.cells.map((c, i) => {
                  const q = data.questions[i]!;
                  if (!c)
                    return (
                      <td key={q.id} className="px-3 py-2 text-right text-ink-3">
                        —
                      </td>
                    );
                  if (c.masked || c.average === null)
                    return (
                      <td key={q.id} className="px-3 py-2 text-right text-[11px] leading-tight text-ink-3">
                        回答3件未満のため非表示
                      </td>
                    );
                  const base = overall.get(q.id);
                  const diff = base === null || base === undefined ? 0 : c.average - base;
                  return (
                    <td key={q.id} className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {diff >= 0.3 && <Badge tone="wakaba">高</Badge>}
                        {diff <= -0.3 && <Badge tone="beni">低</Badge>}
                        <span className="tabular font-bold">{c.average.toFixed(2)}</span>
                      </span>
                      <span className="tabular block text-[11px] text-ink-3">{c.n}件</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-line-2 px-4 py-3 text-xs text-ink-2">
        <ol className="space-y-0.5">
          {data.questions.map((q, i) => (
            <li key={q.id}>
              <span className="tabular mr-1.5 font-bold">質問{i + 1}</span>
              {q.text}
            </li>
          ))}
        </ol>
        {masked && (
          <p className="text-ink-3">匿名性を守るため、回答が3件未満の部署の平均は表示していません。</p>
        )}
      </div>
    </Panel>
  );
}
