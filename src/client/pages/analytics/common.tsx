import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  ChartConfig,
  ChartData,
  ChartDimension,
  DashboardPanel,
  EvaluationPeriod,
  Metric,
  SavedChart,
} from "../../../shared/types";
import { AutoChart } from "../../components/charts";
import { get } from "../../lib/api";

export type Dimensions = {
  base: { key: ChartDimension; label: string }[];
  fields: { key: ChartDimension; label: string; sheetId: number; fieldId: number; options: string[] }[];
};

export type PanelView = DashboardPanel & {
  metric?: Metric;
  chart?: SavedChart;
  data?: ChartData;
  error?: string;
};

export type ChartType = ChartConfig["type"];

// ───────── データ取得 ─────────
export function useDimensions() {
  return useQuery({
    queryKey: ["analytics", "dimensions"],
    queryFn: () => get<Dimensions>("/analytics/dimensions"),
    staleTime: 5 * 60_000,
  });
}

export function useSavedCharts(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "charts"],
    queryFn: async () => (await get<{ items: SavedChart[] }>("/analytics/charts")).items,
    enabled,
  });
}

export function useMetrics(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "metrics"],
    queryFn: async () => (await get<{ items: Metric[] }>("/analytics/metrics")).items,
    enabled,
  });
}

/** 評価ランク軸で選べる「終了した評価期間」（新しい順） */
export function useClosedPeriods(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "closed-periods"],
    queryFn: async () =>
      (await get<{ items: EvaluationPeriod[] }>("/evaluations/periods")).items
        .filter((p) => p.status === "closed")
        .sort((a, b) => b.endDate.localeCompare(a.endDate)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDashboard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => get<{ panels: PanelView[] }>("/dashboard"),
    enabled,
  });
}

// ───────── 設定 ─────────
export function usesEvalRank(c: Pick<ChartConfig, "dimension" | "series">) {
  return c.dimension === "evalRank" || c.series === "evalRank";
}

/** 比較・送信用に設定を正規化する（既定値は省き、キーの順序をそろえる） */
export function normalizeConfig(c: ChartConfig): ChartConfig {
  const series = c.series && c.series !== c.dimension ? c.series : null;
  const type: ChartType = series && c.type === "donut" ? "stacked" : c.type;
  const f = c.filters ?? {};
  const filters: NonNullable<ChartConfig["filters"]> = {};
  if (f.departmentId) {
    filters.departmentId = f.departmentId;
    if (f.includeSub === false) filters.includeSub = false;
  }
  if (f.status) filters.status = f.status;
  return {
    dimension: c.dimension,
    series,
    type,
    filters,
    evalPeriodId: usesEvalRank({ dimension: c.dimension, series }) ? (c.evalPeriodId ?? null) : null,
  };
}

export function sameConfig(a: ChartConfig, b: ChartConfig) {
  return JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b));
}

/** 「人事基本情報：居住地（都道府県）」→「居住地」 */
export function shortLabel(label: string) {
  return (label.split("：").pop() ?? label).replace(/（[^）]*）$/, "");
}

export function dimensionLabel(dims: Dimensions | undefined, key: ChartDimension | null | undefined) {
  if (!key) return "";
  return (
    dims?.base.find((d) => d.key === key)?.label ?? dims?.fields.find((d) => d.key === key)?.label ?? key
  );
}

/** 条件から自動でつけるグラフ名 */
export function autoTitle(dims: Dimensions | undefined, c: ChartConfig) {
  const x = shortLabel(dimensionLabel(dims, c.dimension));
  const s = c.series ? shortLabel(dimensionLabel(dims, c.series)) : "";
  return s ? `${x}別の人数（${s}の内訳）` : `${x}別の人数`;
}

// ───────── 表示 ─────────
/** 人数は整数、平均・比率は小数1桁にそろえる（2% と 5.6% が並んでも桁がそろう） */
export function formatMetric(v: number, unit?: string) {
  const digits = unit === "名" ? 0 : 1;
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 11px の文字で並べたときのおおよその幅 */
function labelWidth(label: string) {
  let w = 0;
  for (const ch of label) w += (ch.codePointAt(0) ?? 0) > 0xff ? 11 : 6.5;
  return w;
}

/**
 * 選ばれた種類を基本に、読みにくくなる場合だけ横棒に切り替える。
 * - 縦棒・積み上げ：区分名が列の幅に収まらないとき
 * - ドーナツ：区分が多いとき・内訳があるとき
 */
export function resolveChartType(
  data: ChartData,
  type: ChartType,
  width: number,
): { type: "bar" | "column" | "donut"; note?: string } {
  const n = data.labels.length;
  if (type === "donut") {
    if (data.series.length > 1) return { type: "bar", note: "内訳があるため横棒で表示しています" };
    if (n > 8) return { type: "bar", note: "区分が多いため横棒で表示しています" };
    return { type: "donut" };
  }
  if (type === "bar") return { type: "bar" };
  if (width > 0 && n > 0) {
    const slot = (width - 40) / n; // 目盛りの幅を除いた1列分
    const need = Math.max(22, ...data.labels.map(labelWidth)) + 6;
    if (slot < need)
      return { type: "bar", note: type === "column" ? "区分が多いため横棒で表示しています" : undefined };
  }
  return { type: "column" };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 幅に合わせて種類を調整して AutoChart を描く */
export function ChartView({
  data,
  type,
  showNote = false,
}: {
  data: ChartData;
  type: ChartType;
  showNote?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const resolved = resolveChartType(data, type, width);
  return (
    <div ref={ref} className="min-w-0">
      <AutoChart data={data} type={resolved.type} />
      {showNote && resolved.note && <p className="mt-3 text-xs text-ink-3">{resolved.note}</p>}
    </div>
  );
}
