import { Table2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { ChartData } from "../../shared/types";
import { cx } from "./ui";

/**
 * 系列色（固定順・使い回さない）。dataviz の検証スクリプトで
 * 明度帯・彩度・色覚多様性での隣接差・通常視での差をすべて満たすことを確認済み。
 * 3色が白背景とのコントラスト 3:1 未満のため、値ラベルと表表示を必ず併用する。
 */
export const SERIES_COLORS = [
  "#2f6db3",
  "#e0901a",
  "#239b6a",
  "#8566c9",
  "#d4574e",
  "#3eaac4",
  "#b5722f",
  "#e27aa3",
];
const OTHER_COLOR = "#a3acb9";

/** 9系列目以降は「その他」にまとめる */
export function foldSeries(data: ChartData, max = 8): ChartData {
  if (data.series.length <= max) return data;
  const keep = data.series.slice(0, max - 1);
  const rest = data.series.slice(max - 1);
  return {
    ...data,
    series: [
      ...keep,
      { name: "その他", values: data.labels.map((_, i) => rest.reduce((s, x) => s + (x.values[i] ?? 0), 0)) },
    ],
  };
}

function colorOf(i: number, name: string) {
  return name === "その他" ? OTHER_COLOR : (SERIES_COLORS[i] ?? OTHER_COLOR);
}

type Tip = {
  x: number;
  y: number;
  title: string;
  rows: { name: string; value: number; color: string }[];
} | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none fixed z-[90] min-w-36 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
      role="tooltip"
    >
      <div className="mb-1 font-bold text-ink">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-ink-2">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
          <span className="flex-1">{r.name}</span>
          <span className="tabular font-bold text-ink">{r.value.toLocaleString("ja-JP")}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

export function ChartTable({ data, total }: { data: ChartData; total?: boolean }) {
  const multi = data.series.length > 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="py-1.5 pr-3 font-normal">区分</th>
            {data.series.map((s) => (
              <th key={s.name} className="py-1.5 pr-3 text-right font-normal">
                {s.name}
              </th>
            ))}
            {multi && total && <th className="py-1.5 text-right font-normal">合計</th>}
          </tr>
        </thead>
        <tbody>
          {data.labels.map((l, i) => (
            <tr key={l} className="border-b border-line-2">
              <td className="py-1.5 pr-3">{l}</td>
              {data.series.map((s) => (
                <td key={s.name} className="tabular py-1.5 pr-3 text-right">
                  {(s.values[i] ?? 0).toLocaleString("ja-JP")}
                </td>
              ))}
              {multi && total && (
                <td className="tabular py-1.5 text-right font-bold">
                  {data.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0).toLocaleString("ja-JP")}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** グラフと表を切り替えられる枠 */
export function ChartFrame({
  data,
  children,
  className,
}: {
  data: ChartData;
  children: ReactNode;
  className?: string;
}) {
  const [table, setTable] = useState(false);
  const legend = data.series.map((s, i) => ({ name: s.name, color: colorOf(i, s.name) }));
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <Legend series={legend} />
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-3 hover:bg-ai-50 hover:text-ink"
        >
          <Table2 className="size-3.5" />
          {table ? "グラフで見る" : "表で見る"}
        </button>
      </div>
      {table ? <ChartTable data={data} total /> : children}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/** 横棒（区分が多い・名前が長いとき） */
export function BarChart({ data, maxBars = 40 }: { data: ChartData; maxBars?: number }) {
  const [tip, setTip] = useState<Tip>(null);
  const folded = foldSeries(data);
  const labels = folded.labels.slice(0, maxBars);
  const totals = labels.map((_, i) => folded.series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t * 10) / 10);
  return (
    <ChartFrame data={folded}>
      <div className="relative" onMouseLeave={() => setTip(null)}>
        <div className="grid grid-cols-[minmax(80px,max-content)_1fr_auto] items-center gap-x-3 gap-y-1.5">
          {labels.map((label, i) => (
            <div key={label} className="contents">
              <div className="max-w-44 truncate text-right text-xs text-ink-2" title={label}>
                {label}
              </div>
              <div className="relative h-5">
                {ticks.slice(1).map((t) => (
                  <span
                    key={t}
                    className="absolute inset-y-[-3px] w-px bg-line-2"
                    style={{ left: `${(t / max) * 100}%` }}
                  />
                ))}
                <div
                  className="relative flex h-full max-h-[18px] gap-[2px] overflow-hidden rounded-r"
                  style={{ width: `${(totals[i]! / max) * 100}%` }}
                  onMouseMove={(e) =>
                    setTip({
                      x: e.clientX,
                      y: e.clientY,
                      title: label,
                      rows: folded.series
                        .map((s, si) => ({
                          name: s.name,
                          value: s.values[i] ?? 0,
                          color: colorOf(si, s.name),
                        }))
                        .filter((r) => r.value > 0),
                    })
                  }
                >
                  {folded.series.map((s, si) =>
                    (s.values[i] ?? 0) > 0 ? (
                      <span
                        key={s.name}
                        className="h-full"
                        style={{ flexGrow: s.values[i], flexBasis: 0, background: colorOf(si, s.name) }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
              <div className="tabular text-xs font-bold text-ink">{totals[i]!.toLocaleString("ja-JP")}</div>
            </div>
          ))}
        </div>
        <Tooltip tip={tip} />
      </div>
      {folded.labels.length > maxBars && (
        <p className="text-xs text-ink-3">ほか {folded.labels.length - maxBars} 区分は表で確認できます</p>
      )}
    </ChartFrame>
  );
}

/** 縦棒（年齢・勤続年数など順序のある区分） */
export function ColumnChart({ data, height = 200 }: { data: ChartData; height?: number }) {
  const [tip, setTip] = useState<Tip>(null);
  const folded = foldSeries(data);
  const totals = folded.labels.map((_, i) => folded.series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t * 10) / 10);
  return (
    <ChartFrame data={folded}>
      <div className="relative flex gap-2" onMouseLeave={() => setTip(null)}>
        <div
          className="tabular flex flex-col justify-between pb-6 text-right text-[11px] text-ink-3"
          style={{ height }}
        >
          {[...ticks].reverse().map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: height - 24 }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute inset-x-0 h-px bg-line-2"
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
          </div>
          <div className="relative flex items-end gap-[2px]" style={{ height: height - 24 }}>
            {folded.labels.map((label, i) => (
              <div
                key={label}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                onMouseMove={(e) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    title: label,
                    rows: folded.series
                      .map((s, si) => ({ name: s.name, value: s.values[i] ?? 0, color: colorOf(si, s.name) }))
                      .filter((r) => r.value > 0),
                  })
                }
              >
                <span className="tabular mb-0.5 text-[11px] font-bold text-ink">{totals[i] || ""}</span>
                <div
                  className="flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t"
                  style={{ height: `${(totals[i]! / max) * 100}%` }}
                >
                  {folded.series.map((s, si) =>
                    (s.values[i] ?? 0) > 0 ? (
                      <span
                        key={s.name}
                        style={{ flexGrow: s.values[i], flexBasis: 0, background: colorOf(si, s.name) }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] border-t border-line">
            {folded.labels.map((l) => (
              <span
                key={l}
                className="min-w-0 flex-1 truncate pt-1 text-center text-[11px] text-ink-2"
                title={l}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
        <Tooltip tip={tip} />
      </div>
    </ChartFrame>
  );
}

/** ドーナツ（構成比。区分は少なめのときだけ） */
export function DonutChart({ data, size = 168 }: { data: ChartData; size?: number }) {
  const [tip, setTip] = useState<Tip>(null);
  // 1系列の区分をスライスとして扱う
  const series = data.series[0];
  const slices = useMemo(() => {
    const raw = data.labels
      .map((l, i) => ({ label: l, value: series?.values[i] ?? 0 }))
      .filter((s) => s.value > 0);
    if (raw.length <= 8) return raw;
    const head = raw.slice(0, 7);
    return [...head, { label: "その他", value: raw.slice(7).reduce((s, x) => s + x.value, 0) }];
  }, [data, series]);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const gap = slices.length > 1 ? 0.012 : 0;
  const arcs = slices.map((s, i) => {
    const sweep = total ? (s.value / total) * Math.PI * 2 : 0;
    const a0 = angle + gap;
    const a1 = angle + sweep - gap;
    angle += sweep;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, rr: number) => `${r + rr * Math.cos(rad)} ${r + rr * Math.sin(rad)}`;
    const d =
      sweep >= Math.PI * 2 - 0.001
        ? `M ${r} ${r - r} A ${r} ${r} 0 1 1 ${r - 0.01} 0 L ${r - 0.01} ${r - inner} A ${inner} ${inner} 0 1 0 ${r} ${r - inner} Z`
        : `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
    return { ...s, d, color: colorOf(i, s.label) };
  });
  const tableData: ChartData = {
    labels: slices.map((s) => s.label),
    series: [{ name: "人数", values: slices.map((s) => s.value) }],
    total,
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-6" onMouseLeave={() => setTip(null)}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="構成比のドーナツグラフ"
        >
          {arcs.map((a) => (
            <path
              key={a.label}
              d={a.d}
              fill={a.color}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX,
                  y: e.clientY,
                  title: a.label,
                  rows: [{ name: "人数", value: a.value, color: a.color }],
                })
              }
            />
          ))}
          <text x={r} y={r - 4} textAnchor="middle" className="fill-ink text-[22px] font-bold tabular">
            {total.toLocaleString("ja-JP")}
          </text>
          <text x={r} y={r + 16} textAnchor="middle" className="fill-ink-3 text-[11px]">
            合計
          </text>
        </svg>
        <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
          {arcs.map((a) => (
            <li key={a.label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
              <span className="flex-1 truncate text-ink-2">{a.label}</span>
              <span className="tabular font-bold">{a.value.toLocaleString("ja-JP")}</span>
              <span className="tabular w-12 text-right text-xs text-ink-3">
                {total ? `${Math.round((a.value / total) * 1000) / 10}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
        <Tooltip tip={tip} />
      </div>
      <details className="text-xs text-ink-3">
        <summary className="cursor-pointer select-none">表で見る</summary>
        <div className="mt-2">
          <ChartTable data={tableData} />
        </div>
      </details>
    </div>
  );
}

export function AutoChart({ data, type }: { data: ChartData; type: "bar" | "column" | "donut" | "stacked" }) {
  if (!data.labels.length)
    return <p className="py-8 text-center text-sm text-ink-3">表示できるデータがありません</p>;
  if (type === "donut" && data.series.length === 1) return <DonutChart data={data} />;
  if (type === "column") return <ColumnChart data={data} />;
  if (type === "stacked")
    return data.labels.length > 10 ? <BarChart data={data} /> : <ColumnChart data={data} />;
  return <BarChart data={data} />;
}

/** 小さな比率バー（回答率など） */
export function Meter({
  value,
  max = 100,
  tone = "ai",
}: {
  value: number;
  max?: number;
  tone?: "ai" | "wakaba" | "yamabuki";
}) {
  const color = tone === "wakaba" ? "#239b6a" : tone === "yamabuki" ? "#e0901a" : "#2f6db3";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2" aria-hidden>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }}
      />
    </div>
  );
}
