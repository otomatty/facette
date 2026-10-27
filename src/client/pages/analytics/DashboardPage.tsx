import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LayoutDashboard, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import {
  Button,
  cx,
  EmptyState,
  ErrorBox,
  IconButton,
  Loading,
  PageHeader,
  Segmented,
  useToast,
} from "../../components/ui";
import { del, errorMessage, patch, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { AddPanelDialog } from "./AddPanelDialog";
import { ChartView, formatMetric, type PanelView, useDashboard } from "./common";

type Block = { kind: "metric" | "chart"; panels: PanelView[] };

/** 連続する指標はひとつの帯に、連続するグラフはひとつのグリッドにまとめる */
function toBlocks(panels: PanelView[]): Block[] {
  const blocks: Block[] = [];
  for (const p of panels) {
    const last = blocks.at(-1);
    if (last && last.kind === p.kind) last.panels.push(p);
    else blocks.push({ kind: p.kind, panels: [p] });
  }
  return blocks;
}

function setPanels(update: (panels: PanelView[]) => PanelView[]) {
  queryClient.setQueryData<{ panels: PanelView[] }>(["dashboard"], (d) =>
    d ? { ...d, panels: update(d.panels) } : d,
  );
}

export default function DashboardPage() {
  const me = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const dashboard = useDashboard();
  const panels = dashboard.data?.panels ?? [];

  const onError = (e: unknown) => {
    toast(errorMessage(e), "error");
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const reorder = useMutation({
    mutationFn: (ids: number[]) => post("/dashboard/reorder", { ids }),
    onError,
  });
  const resize = useMutation({
    mutationFn: (v: { id: number; width: 1 | 2 }) => patch(`/dashboard/panels/${v.id}`, { width: v.width }),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/dashboard/panels/${id}`),
    onSuccess: () => toast("パネルを削除しました"),
    onError,
  });

  const controls = (p: PanelView): PanelControlsProps => {
    const index = panels.findIndex((x) => x.id === p.id);
    const move = (dir: -1 | 1) => {
      const next = [...panels];
      const [item] = next.splice(index, 1);
      next.splice(index + dir, 0, item!);
      setPanels(() => next);
      reorder.mutate(next.map((x) => x.id));
    };
    return {
      canUp: index > 0,
      canDown: index < panels.length - 1,
      onUp: () => move(-1),
      onDown: () => move(1),
      width: p.width,
      onWidth: (width) => {
        setPanels((list) => list.map((x) => (x.id === p.id ? { ...x, width } : x)));
        resize.mutate({ id: p.id, width });
      },
      onDelete: () => {
        setPanels((list) => list.filter((x) => x.id !== p.id));
        remove.mutate(p.id);
      },
    };
  };

  const empty = dashboard.data && panels.length === 0;

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        description={
          me.user.role === "manager"
            ? "よく見る指標とグラフを並べておけます。数字はあなたが管轄する部署とその配下の社員で集計しています。"
            : "よく見る指標とグラフを並べておけます。数字は開くたびに最新の社員データで集計します。"
        }
        actions={
          dashboard.data && (
            <>
              {!empty && (
                <Button
                  variant={editing ? "primary" : "secondary"}
                  aria-pressed={editing}
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? "編集を終える" : "編集"}
                </Button>
              )}
              <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                パネルを追加
              </Button>
            </>
          )
        }
      />

      {dashboard.isLoading && <Loading />}
      {dashboard.error && <ErrorBox error={dashboard.error} onRetry={() => dashboard.refetch()} />}

      {empty && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<LayoutDashboard className="size-10" />}
            title="ダッシュボードにパネルがありません"
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                パネルを追加
              </Button>
            }
          >
            従業員数や平均年齢などの指標と、社員データグラフで保存したグラフを並べられます。
          </EmptyState>
        </div>
      )}

      {panels.length > 0 && (
        <div className="space-y-5">
          {toBlocks(panels).map((b) =>
            b.kind === "metric" ? (
              <MetricStrip key={`m${b.panels[0]!.id}`} panels={b.panels}>
                {b.panels.map((p) => (
                  <MetricCell key={p.id} panel={p} controls={editing ? controls(p) : null} />
                ))}
              </MetricStrip>
            ) : (
              <div key={`c${b.panels[0]!.id}`} className="grid gap-5 xl:grid-cols-2">
                {b.panels.map((p) => (
                  <ChartPanel key={p.id} panel={p} controls={editing ? controls(p) : null} />
                ))}
              </div>
            ),
          )}
        </div>
      )}

      {adding && <AddPanelDialog panels={panels} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ───────── 指標 ─────────
function MetricStrip({ panels, children }: { panels: PanelView[]; children: ReactNode }) {
  // 6・9個のように3で割り切れるときは3列、それ以外は4列にして行の端をそろえる
  const units = panels.reduce((s, p) => s + p.width, 0);
  const cols = units > 4 && units % 3 === 0 && units % 4 !== 0 ? 3 : 4;
  // 数字を主役にするため、ひとつの面に置いて細い縦線だけで区切る。
  // 各項目の左（1列のときは上）に線を引き、行の先頭にくる線は外側にずらして隠す
  return (
    <section aria-label="指標" className="overflow-hidden rounded-lg border border-line bg-white">
      <div
        className={cx(
          "-mt-px grid grid-cols-1 py-1 sm:-ml-px sm:grid-cols-2 sm:gap-y-2 sm:py-3",
          cols === 3 ? "md:grid-cols-3" : "md:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function MetricCell({ panel, controls }: { panel: PanelView; controls: PanelControlsProps | null }) {
  const m = panel.metric;
  const label = panel.config.title || m?.label || "指標";
  const value = m?.value ?? null;
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col border-t border-line-2 px-5 py-4 sm:border-t-0 sm:border-l sm:py-2",
        panel.width === 2 && "sm:col-span-2",
      )}
    >
      <h2 className="text-[13px] leading-snug text-ink-2">{label}</h2>
      <p className="mt-1.5 flex items-baseline gap-1">
        {value === null ? (
          <span
            className="text-[34px] leading-none font-bold text-ink-3"
            title="集計できるデータがありません"
          >
            —
          </span>
        ) : (
          <>
            <span className="tabular text-[34px] leading-none font-bold tracking-tight text-ink">
              {formatMetric(value, m?.unit)}
            </span>
            {m?.unit && <span className="text-[13px] text-ink-3">{m.unit}</span>}
          </>
        )}
      </p>
      {m?.note ? (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">{m.note}</p>
      ) : (
        !m && <p className="mt-2 text-[11px] text-ink-3">この指標は表示できません</p>
      )}
      {controls && (
        <div className="mt-auto pt-3">
          <PanelControls {...controls} className="border-t border-dashed border-line pt-2" />
        </div>
      )}
    </div>
  );
}

// ───────── グラフ ─────────
function ChartPanel({ panel, controls }: { panel: PanelView; controls: PanelControlsProps | null }) {
  const { chart, data } = panel;
  const title = panel.config.title || chart?.name || "グラフ";
  return (
    <section
      className={cx(
        "flex min-w-0 flex-col rounded-lg border border-line bg-white",
        panel.width === 2 && "xl:col-span-2",
      )}
      aria-label={title}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-2 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold">{panel.error ? "グラフを表示できません" : title}</h2>
          {data && (
            <p className="text-xs text-ink-3">
              対象 <span className="tabular font-bold text-ink-2">{data.total.toLocaleString("ja-JP")}</span>{" "}
              名
            </p>
          )}
        </div>
        {chart && !controls && (
          <Link
            to={`/analytics?chart=${chart.id}`}
            className="shrink-0 text-xs font-bold text-ai-700 hover:underline"
          >
            社員データグラフで開く
          </Link>
        )}
      </header>
      {controls && (
        <PanelControls {...controls} className="border-b border-line-2 bg-canvas/60 px-4 py-1.5" />
      )}
      <div className="flex-1 p-4">
        {panel.error ? (
          <ErrorBox error={new Error(panel.error)} />
        ) : data && chart ? (
          <ChartView data={data} type={chart.config.type} />
        ) : (
          <p className="py-8 text-center text-sm text-ink-3">表示できるデータがありません</p>
        )}
      </div>
    </section>
  );
}

// ───────── 編集 ─────────
type PanelControlsProps = {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  width: 1 | 2;
  onWidth: (w: 1 | 2) => void;
  onDelete: () => void;
};

function PanelControls({
  canUp,
  canDown,
  onUp,
  onDown,
  width,
  onWidth,
  onDelete,
  className,
}: PanelControlsProps & { className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-1", className)}>
      <IconButton label="前に移動" disabled={!canUp} onClick={onUp}>
        <ArrowUp className="size-4" />
      </IconButton>
      <IconButton label="後ろに移動" disabled={!canDown} onClick={onDown}>
        <ArrowDown className="size-4" />
      </IconButton>
      <span className="ml-1">
        <Segmented
          label="パネルの幅"
          value={String(width) as "1" | "2"}
          onChange={(v) => onWidth(v === "2" ? 2 : 1)}
          options={[
            { value: "1", label: "1列" },
            { value: "2", label: "2列" },
          ]}
        />
      </span>
      <IconButton
        label="パネルを削除"
        className="ml-auto hover:bg-beni-100 hover:text-beni"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}
