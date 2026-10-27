import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  ChartBar,
  ChartColumn,
  ChartColumnStacked,
  ChartPie,
  Copy,
  Info,
  LayoutDashboard,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { MemberStatus } from "../../../shared/constants";
import type { ChartConfig, ChartData, ChartDimension, SavedChart } from "../../../shared/types";
import { DepartmentSelect } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Loading,
  PageHeader,
  Segmented,
  Select,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, patch, post } from "../../lib/api";
import { queryClient, useAuth, useSheets } from "../../lib/queries";
import { ChartSaveDialog, type SaveIntent } from "./ChartSaveDialog";
import {
  autoTitle,
  type ChartType,
  ChartView,
  type Dimensions,
  dimensionLabel,
  normalizeConfig,
  resolveChartType,
  sameConfig,
  useClosedPeriods,
  useDimensions,
  useSavedCharts,
  usesEvalRank,
} from "./common";

const TYPE_OPTIONS: { value: ChartType; label: string; icon: React.ReactNode }[] = [
  { value: "bar", label: "横棒", icon: <ChartBar className="size-3.5" /> },
  { value: "column", label: "縦棒", icon: <ChartColumn className="size-3.5" /> },
  { value: "donut", label: "ドーナツ", icon: <ChartPie className="size-3.5" /> },
  { value: "stacked", label: "積み上げ", icon: <ChartColumnStacked className="size-3.5" /> },
];

const TYPE_ICON: Record<ChartType, React.ReactNode> = {
  bar: <ChartBar className="size-4" />,
  column: <ChartColumn className="size-4" />,
  donut: <ChartPie className="size-4" />,
  stacked: <ChartColumnStacked className="size-4" />,
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "在籍・休職" },
  { value: "active", label: "在籍のみ" },
  { value: "leave", label: "休職のみ" },
  { value: "retired", label: "退職のみ" },
  { value: "all", label: "退職者を含むすべて" },
];

const DEFAULT_DIMENSION: ChartDimension = "department";

/** URL の検索パラメータ → 集計条件 */
function configFromParams(params: URLSearchParams): ChartConfig {
  const dimension = (params.get("dim") as ChartDimension | null) ?? DEFAULT_DIMENSION;
  const series = (params.get("series") as ChartDimension | null) || null;
  const rawType = params.get("type");
  const type: ChartType = TYPE_OPTIONS.some((t) => t.value === rawType) ? (rawType as ChartType) : "bar";
  const dept = Number(params.get("dept"));
  const status = params.get("status") as MemberStatus | "all" | null;
  const period = Number(params.get("period"));
  return normalizeConfig({
    dimension,
    series,
    type,
    filters: {
      departmentId: dept > 0 ? dept : undefined,
      includeSub: params.get("sub") === "0" ? false : undefined,
      status: status ?? undefined,
    },
    evalPeriodId: period > 0 ? period : null,
  });
}

/** 集計条件 → URL の検索パラメータ */
function configToParams(c: ChartConfig): Record<string, string | null> {
  const n = normalizeConfig(c);
  return {
    // dim は常に書く（?chart=ID だけのときに保存した条件を読み込む判定に使う）
    dim: n.dimension,
    series: n.series ?? null,
    type: n.type === "bar" ? null : n.type,
    dept: n.filters?.departmentId ? String(n.filters.departmentId) : null,
    sub: n.filters?.includeSub === false ? "0" : null,
    status: n.filters?.status ?? null,
    period: n.evalPeriodId ? String(n.evalPeriodId) : null,
  };
}

export default function AnalyticsPage() {
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<SaveIntent | null>(null);

  const dims = useDimensions();
  const charts = useSavedCharts();
  const sheets = useSheets();

  const config = useMemo(() => configFromParams(params), [params]);
  const chartId = Number(params.get("chart")) || null;
  const current = charts.data?.find((c) => c.id === chartId);
  const dirty = !!current && !sameConfig(current.config, config);
  const evalAxis = usesEvalRank(config);
  const periods = useClosedPeriods(evalAxis);

  // URL の更新は遷移として遅れて反映されるため、続けて条件を変えても前の変更が消えないよう
  // 反映待ちの値を覚えておき、次の変更はそれを元にする
  const pending = useRef<{ base: URLSearchParams; next: URLSearchParams } | null>(null);
  const latestParams = () =>
    pending.current && pending.current.base === params ? pending.current.next : params;
  const navigateParams = (next: URLSearchParams, replace: boolean) => {
    pending.current = { base: params, next };
    setParams(next, { replace });
  };

  const update = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(latestParams());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    navigateParams(next, true);
  };
  const setConfig = (changes: Partial<ChartConfig>) => {
    const base = configFromParams(latestParams());
    update(configToParams({ ...base, ...changes, filters: { ...base.filters, ...changes.filters } }));
  };

  const loadChart = (c: SavedChart) => {
    const next = new URLSearchParams();
    next.set("chart", String(c.id));
    for (const [k, v] of Object.entries(configToParams(c.config))) if (v) next.set(k, v);
    navigateParams(next, false);
  };

  // ダッシュボードなどから ?chart=ID だけで開いたときは、保存した条件を読み込む
  useEffect(() => {
    if (!current || params.has("dim")) return;
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(configToParams(current.config))) if (v) next.set(k, v);
    if (next.toString() !== params.toString()) {
      pending.current = { base: params, next };
      setParams(next, { replace: true });
    }
  }, [current, params, setParams]);

  const chart = useQuery({
    queryKey: ["analytics", "chart", config],
    queryFn: () => post<ChartData>("/analytics/chart", config),
    placeholderData: keepPreviousData,
    enabled: !!dims.data,
  });

  const overwrite = useMutation({
    mutationFn: (c: SavedChart) =>
      patch(`/analytics/charts/${c.id}`, { name: c.name, config, shared: c.shared }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics", "charts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast("上書き保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const remove = useMutation({
    mutationFn: (c: SavedChart) => del(`/analytics/charts/${c.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics", "charts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      update({ chart: null });
      toast("グラフを削除しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const askDelete = async (c: SavedChart) => {
    const ok = await confirm({
      title: "グラフを削除しますか",
      message: (
        <>
          「{c.name}」を削除します。
          {c.shared && "共有しているほかの人の一覧からも消えます。"}
          ダッシュボードに置いたパネルも外れます。元に戻すことはできません。
        </>
      ),
      confirmLabel: "削除する",
      danger: true,
    });
    if (ok) remove.mutate(c);
  };

  const multiFieldIds = useMemo(
    () =>
      new Set(
        (sheets.data ?? []).flatMap((s) =>
          s.fields.filter((f) => f.type === "multiselect").map((f) => `field:${f.id}`),
        ),
      ),
    [sheets.data],
  );
  const countsMultiple =
    multiFieldIds.has(config.dimension) || (!!config.series && multiFieldIds.has(config.series));

  const title = current ? current.name : autoTitle(dims.data, config);
  const data = chart.data;
  const suggestedWidth: 1 | 2 =
    data && (config.series || resolveChartType(data, config.type, 600).type === "bar") ? 2 : 1;

  return (
    <div>
      <PageHeader
        title="社員データグラフ"
        description="社員の属性やシートの項目ごとに人数を集計します。条件を保存すると、ダッシュボードに並べていつでも最新の数字で見られます。"
      />

      <div className="grid gap-5 xl:grid-cols-[248px_minmax(0,1fr)]">
        <SavedChartList
          charts={charts.data}
          isLoading={charts.isLoading}
          error={charts.error}
          onRetry={() => charts.refetch()}
          activeId={current?.id ?? null}
          onSelect={loadChart}
          onNew={() => navigateParams(new URLSearchParams(), false)}
        />

        <div className="min-w-0 space-y-4">
          {dims.error && <ErrorBox error={dims.error} onRetry={() => dims.refetch()} />}

          <ConditionBar
            dims={dims.data}
            config={config}
            onChange={setConfig}
            periods={evalAxis ? (periods.data ?? []) : null}
          />

          <section className="rounded-lg border border-line bg-white" aria-labelledby="analytics-chart-title">
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-line-2 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 id="analytics-chart-title" className="text-[15px] font-bold">
                    {title}
                  </h2>
                  {current?.shared && <Badge tone="ai">共有</Badge>}
                  {dirty && <Badge tone="yamabuki">未保存の変更</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-ink-2" aria-live="polite">
                  対象{" "}
                  <span className="tabular text-lg font-bold text-ink">
                    {data ? data.total.toLocaleString("ja-JP") : "—"}
                  </span>{" "}
                  名
                  {current && !current.isOwner && (
                    <span className="ml-3 text-xs text-ink-3">作成者 {current.ownerName}</span>
                  )}
                  {chart.isFetching && !chart.isLoading && (
                    <span className="ml-3 text-xs text-ink-3">更新中</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {current?.isOwner ? (
                  <>
                    <Button
                      size="sm"
                      variant={dirty ? "primary" : "secondary"}
                      icon={<Save className="size-4" />}
                      disabled={!dirty}
                      loading={overwrite.isPending}
                      onClick={() => overwrite.mutate(current)}
                    >
                      上書き保存
                    </Button>
                    <Button size="sm" icon={<Copy className="size-4" />} onClick={() => setDialog("saveAs")}>
                      別のグラフとして保存
                    </Button>
                  </>
                ) : current ? (
                  <Button size="sm" icon={<Copy className="size-4" />} onClick={() => setDialog("saveAs")}>
                    自分のグラフとして保存
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Save className="size-4" />}
                    disabled={!data}
                    onClick={() => setDialog("save")}
                  >
                    保存
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<LayoutDashboard className="size-4" />}
                  disabled={!data}
                  onClick={() => setDialog("dashboard")}
                >
                  ダッシュボードに追加
                </Button>
                {current?.isOwner && (
                  <span className="flex items-center">
                    <IconButton label="名前と共有の設定" onClick={() => setDialog("rename")}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="グラフを削除"
                      className="hover:bg-beni-100 hover:text-beni"
                      onClick={() => askDelete(current)}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </span>
                )}
              </div>
            </header>

            <div className="p-4">
              {chart.isLoading || (!dims.data && !dims.error) ? (
                <Loading label="集計しています" />
              ) : chart.error ? (
                <ErrorBox error={chart.error} onRetry={() => chart.refetch()} />
              ) : data ? (
                <div className={cx("transition-opacity", chart.isPlaceholderData && "opacity-60")}>
                  <ChartView data={data} type={config.type} showNote />
                  {!config.series && config.type === "stacked" && data.labels.length > 0 && (
                    <p className="mt-3 text-xs text-ink-3">内訳を選ぶと、区分ごとに積み上げて表示します。</p>
                  )}
                </div>
              ) : null}
            </div>

            {(countsMultiple || me.user.role === "manager") && (
              <footer className="space-y-1 border-t border-line-2 px-4 py-2.5 text-xs text-ink-3">
                {countsMultiple && (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    複数選択の項目は、1人が複数の区分に数えられます。対象の人数とグラフの合計は一致しません。
                  </p>
                )}
                {me.user.role === "manager" && (
                  <p className="flex items-start gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    あなたが管轄する部署とその配下の社員だけを集計しています。
                  </p>
                )}
              </footer>
            )}
          </section>
        </div>
      </div>

      {dialog && (
        <ChartSaveDialog
          intent={dialog}
          config={config}
          current={current}
          dirty={dirty}
          defaultName={autoTitle(dims.data, config)}
          suggestedWidth={suggestedWidth}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            if (id !== current?.id) update({ chart: String(id) });
          }}
        />
      )}
    </div>
  );
}

// ───────── 条件 ─────────
function DimensionOptions({ dims, exclude }: { dims: Dimensions | undefined; exclude?: ChartDimension }) {
  if (!dims) return null;
  return (
    <>
      <optgroup label="基本の項目">
        {dims.base
          .filter((d) => d.key !== exclude)
          .map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
      </optgroup>
      {dims.fields.length > 0 && (
        <optgroup label="シートの項目">
          {dims.fields
            .filter((d) => d.key !== exclude)
            .map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
        </optgroup>
      )}
    </>
  );
}

function ConditionBar({
  dims,
  config,
  onChange,
  periods,
}: {
  dims: Dimensions | undefined;
  config: ChartConfig;
  onChange: (patch: Partial<ChartConfig>) => void;
  periods: { id: number; name: string }[] | null;
}) {
  const known = (key: ChartDimension | null | undefined) =>
    !key || !dims || dims.base.some((d) => d.key === key) || dims.fields.some((d) => d.key === key);
  const typeOptions = config.series ? TYPE_OPTIONS.filter((t) => t.value !== "donut") : TYPE_OPTIONS;
  const deptId = config.filters?.departmentId ?? null;
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
        <Field label="集計軸" htmlFor="analytics-dimension" className="w-full sm:w-60">
          <Select
            id="analytics-dimension"
            value={config.dimension}
            disabled={!dims}
            onChange={(e) => onChange({ dimension: e.target.value as ChartDimension })}
          >
            {!known(config.dimension) && (
              <option value={config.dimension}>{dimensionLabel(dims, config.dimension)}</option>
            )}
            <DimensionOptions dims={dims} />
          </Select>
        </Field>
        <Field label="内訳" htmlFor="analytics-series" className="w-full sm:w-60">
          <Select
            id="analytics-series"
            value={config.series ?? ""}
            disabled={!dims}
            onChange={(e) => onChange({ series: (e.target.value || null) as ChartDimension | null })}
          >
            <option value="">なし</option>
            {!known(config.series) && config.series && (
              <option value={config.series}>{dimensionLabel(dims, config.series)}</option>
            )}
            <DimensionOptions dims={dims} exclude={config.dimension} />
          </Select>
        </Field>
        <Field label="グラフの種類">
          <div>
            <Segmented
              label="グラフの種類"
              value={config.type}
              onChange={(type) => onChange({ type })}
              options={typeOptions}
            />
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line-2 p-3">
        <Field label="部署" htmlFor="analytics-department" className="w-full sm:w-60">
          <DepartmentSelect
            id="analytics-department"
            value={deptId}
            onChange={(v) => onChange({ filters: { departmentId: v ?? undefined } })}
          />
        </Field>
        <div className="flex h-9 items-center">
          <Checkbox
            label="配下の部署を含める"
            checked={config.filters?.includeSub !== false}
            disabled={!deptId}
            onChange={(e) => onChange({ filters: { includeSub: e.target.checked ? undefined : false } })}
          />
        </div>
        <Field label="在籍状況" htmlFor="analytics-status" className="w-full sm:w-48">
          <Select
            id="analytics-status"
            value={config.filters?.status ?? ""}
            onChange={(e) =>
              onChange({ filters: { status: (e.target.value || undefined) as MemberStatus | "all" } })
            }
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {periods && (
          <Field label="評価期間" htmlFor="analytics-period" className="w-full sm:w-56">
            <Select
              id="analytics-period"
              value={config.evalPeriodId ?? ""}
              onChange={(e) => onChange({ evalPeriodId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">直近に終了した期間</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </div>
  );
}

// ───────── 保存したグラフ ─────────
function SavedChartList({
  charts,
  isLoading,
  error,
  onRetry,
  activeId,
  onSelect,
  onNew,
}: {
  charts: SavedChart[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  activeId: number | null;
  onSelect: (c: SavedChart) => void;
  onNew: () => void;
}) {
  return (
    <aside className="self-start rounded-lg border border-line bg-white xl:sticky xl:top-20">
      <header className="flex min-h-12 items-center justify-between gap-2 border-b border-line-2 py-2 pr-2 pl-4">
        <h2 className="text-[15px] font-bold">保存したグラフ</h2>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={onNew}>
          新しく作る
        </Button>
      </header>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <div className="p-3">
          <ErrorBox error={error} onRetry={onRetry} />
        </div>
      ) : !charts?.length ? (
        <EmptyState title="保存したグラフはありません">条件を選んで保存すると、ここから開けます。</EmptyState>
      ) : (
        <ul className="grid max-h-64 overflow-y-auto sm:max-h-48 sm:grid-cols-2 md:grid-cols-3 xl:max-h-[calc(100dvh-180px)] xl:grid-cols-1 [&>li]:border-b [&>li]:border-line-2 xl:[&>li:last-child]:border-b-0">
          {charts.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(c)}
                  className={cx(
                    "flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors",
                    active ? "bg-ai-50 shadow-[inset_3px_0_0_var(--color-ai-700)]" : "hover:bg-ai-50/60",
                  )}
                >
                  <span className={cx("mt-0.5 shrink-0", active ? "text-ai-700" : "text-ink-3")}>
                    {TYPE_ICON[c.config.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        "block truncate text-sm",
                        active ? "font-bold text-ai-800" : "font-bold text-ink",
                      )}
                    >
                      {c.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                      <span className="truncate">{c.ownerName}</span>
                      {c.shared && <Badge tone="ai">共有</Badge>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
