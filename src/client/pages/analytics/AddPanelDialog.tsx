import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { MetricKey } from "../../../shared/types";
import { Badge, Button, cx, ErrorBox, Loading, Modal, Segmented, Tabs, useToast } from "../../components/ui";
import { errorMessage, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { formatMetric, type PanelView, useMetrics, useSavedCharts } from "./common";

type Tab = "metric" | "chart";

export function AddPanelDialog({ panels, onClose }: { panels: PanelView[]; onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("metric");
  const [metrics, setMetrics] = useState<Set<MetricKey>>(new Set());
  const [charts, setCharts] = useState<Set<number>>(new Set());
  const [width, setWidth] = useState<1 | 2>(1);
  const metricList = useMetrics();
  const chartList = useSavedCharts();
  const usedMetrics = new Set(panels.map((p) => p.config.metric).filter(Boolean));
  const usedCharts = new Set(panels.map((p) => p.config.chartId).filter(Boolean));
  const count = metrics.size + charts.size;

  const add = useMutation({
    mutationFn: async () => {
      // 選んだ順ではなく一覧の順で追加する
      for (const m of metricList.data ?? [])
        if (metrics.has(m.key))
          await post("/dashboard/panels", { kind: "metric", config: { metric: m.key } });
      for (const c of chartList.data ?? [])
        if (charts.has(c.id))
          await post("/dashboard/panels", { kind: "chart", config: { chartId: c.id }, width });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(`${count}件のパネルを追加しました`);
      onClose();
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(errorMessage(e), "error");
    },
  });

  const toggle = <T,>(set: Set<T>, setter: (s: Set<T>) => void, v: T) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="パネルを追加"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-3">
            {count > 0 && (
              <>
                <span className="tabular font-bold text-ink">{count}</span> 件を選択中
              </>
            )}
          </span>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" disabled={!count} loading={add.isPending} onClick={() => add.mutate()}>
            追加
          </Button>
        </>
      }
    >
      <Tabs
        className="-mx-5 -mt-4 mb-4 px-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "metric", label: "指標", count: metrics.size || undefined },
          { value: "chart", label: "保存したグラフ", count: charts.size || undefined },
        ]}
      />

      {tab === "metric" &&
        (metricList.isLoading ? (
          <Loading />
        ) : metricList.error ? (
          <ErrorBox error={metricList.error} onRetry={() => metricList.refetch()} />
        ) : (
          <ul className="divide-y divide-line-2 rounded-md border border-line">
            {metricList.data?.map((m) => (
              <li key={m.key}>
                <label
                  className={cx(
                    "flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ai-50/60",
                    metrics.has(m.key) && "bg-ai-50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-ai-700"
                    checked={metrics.has(m.key)}
                    onChange={() => toggle(metrics, setMetrics, m.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold">
                      {m.label}
                      {usedMetrics.has(m.key) && <Badge>配置済み</Badge>}
                    </span>
                    {m.note && <span className="block text-xs text-ink-3">{m.note}</span>}
                  </span>
                  <span className="shrink-0 text-right text-sm">
                    {m.value === null ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <>
                        <span className="tabular font-bold">{formatMetric(m.value, m.unit)}</span>
                        <span className="ml-0.5 text-xs text-ink-3">{m.unit}</span>
                      </>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ))}

      {tab === "chart" &&
        (chartList.isLoading ? (
          <Loading />
        ) : chartList.error ? (
          <ErrorBox error={chartList.error} onRetry={() => chartList.refetch()} />
        ) : !chartList.data?.length ? (
          <div className="rounded-md border border-line px-4 py-8 text-center text-sm text-ink-2">
            保存したグラフがありません。
            <Link to="/analytics" className="ml-1 font-bold text-ai-700 hover:underline">
              社員データグラフ
            </Link>
            で条件を選んで保存すると、ここから追加できます。
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-line-2 rounded-md border border-line">
              {chartList.data.map((c) => (
                <li key={c.id}>
                  <label
                    className={cx(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ai-50/60",
                      charts.has(c.id) && "bg-ai-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-ai-700"
                      checked={charts.has(c.id)}
                      onChange={() => toggle(charts, setCharts, c.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                        <span className="truncate">{c.name}</span>
                        {c.shared && <Badge tone="ai">共有</Badge>}
                        {usedCharts.has(c.id) && <Badge>配置済み</Badge>}
                      </span>
                      <span className="block text-xs text-ink-3">作成者 {c.ownerName}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-bold text-ink-2">表示する幅</span>
              <Segmented
                label="表示する幅"
                value={String(width) as "1" | "2"}
                onChange={(v) => setWidth(v === "2" ? 2 : 1)}
                options={[
                  { value: "1", label: "1列" },
                  { value: "2", label: "2列" },
                ]}
              />
            </div>
          </div>
        ))}
    </Modal>
  );
}
