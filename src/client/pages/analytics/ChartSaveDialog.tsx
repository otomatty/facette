import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ChartConfig, SavedChart } from "../../../shared/types";
import { Button, Checkbox, Field, Input, Modal, Segmented, useToast } from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { useDashboard } from "./common";

export type SaveIntent = "save" | "saveAs" | "rename" | "dashboard";

type Plan = { save: "create" | "update" | null; add: boolean; editFields: boolean };

function planFor(intent: SaveIntent, current: SavedChart | undefined, dirty: boolean): Plan {
  switch (intent) {
    case "save":
    case "saveAs":
      return { save: "create", add: false, editFields: true };
    case "rename":
      return { save: "update", add: false, editFields: true };
    case "dashboard":
      if (!current) return { save: "create", add: true, editFields: true };
      if (!dirty) return { save: null, add: true, editFields: false };
      return current.isOwner
        ? { save: "update", add: true, editFields: false }
        : { save: "create", add: true, editFields: true };
  }
}

/**
 * グラフの保存・名前の変更・ダッシュボードへの追加をまとめて扱うダイアログ。
 * 未保存の条件をダッシュボードに追加するときは、先に保存してから追加する。
 */
export function ChartSaveDialog({
  intent,
  config,
  current,
  dirty,
  defaultName,
  suggestedWidth,
  onClose,
  onSaved,
}: {
  intent: SaveIntent;
  config: ChartConfig;
  current: SavedChart | undefined;
  dirty: boolean;
  defaultName: string;
  suggestedWidth: 1 | 2;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const nameId = useId();
  const plan = planFor(intent, current, dirty);
  const [name, setName] = useState(() => {
    if (intent === "rename" && current) return current.name;
    if (intent === "saveAs" && current) return `${current.name}（コピー）`;
    if (current && !current.isOwner) return current.name;
    return defaultName;
  });
  const [shared, setShared] = useState(intent === "rename" ? !!current?.shared : false);
  const [width, setWidth] = useState<1 | 2>(suggestedWidth);
  const dashboard = useDashboard(plan.add && !!current);
  const alreadyOnDashboard =
    !!current && !!dashboard.data?.panels.some((p) => p.kind === "chart" && p.config.chartId === current.id);

  const submit = useMutation({
    mutationFn: async () => {
      let id = current?.id;
      if (plan.save === "create") {
        id = (await post<{ id: number }>("/analytics/charts", { name: name.trim(), config, shared })).id;
      } else if (plan.save === "update" && current) {
        await patch(`/analytics/charts/${current.id}`, {
          name: plan.editFields ? name.trim() : current.name,
          // 名前の変更では保存済みの条件をそのまま残す
          config: intent === "rename" ? current.config : config,
          shared: plan.editFields ? shared : current.shared,
        });
      }
      if (plan.add && id) await post("/dashboard/panels", { kind: "chart", config: { chartId: id }, width });
      return id!;
    },
    onSuccess: (id) => {
      if (plan.save) queryClient.invalidateQueries({ queryKey: ["analytics", "charts"] });
      if (plan.add || plan.save === "update") queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast(
        plan.add
          ? plan.save
            ? "保存してダッシュボードに追加しました"
            : "ダッシュボードに追加しました"
          : intent === "rename"
            ? "変更を保存しました"
            : "保存しました",
      );
      onSaved(id);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const title = {
    save: "グラフを保存",
    saveAs: "別のグラフとして保存",
    rename: "名前と共有の設定",
    dashboard: "ダッシュボードに追加",
  }[intent];
  const submitLabel = plan.add
    ? plan.save === "create"
      ? "保存して追加"
      : plan.save === "update"
        ? "上書き保存して追加"
        : "追加"
    : "保存";
  const invalid = plan.editFields && !name.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            loading={submit.isPending}
            disabled={invalid}
            onClick={() => submit.mutate()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid && !submit.isPending) submit.mutate();
        }}
      >
        {plan.add && plan.save === "create" && (
          <p className="text-sm text-ink-2">
            {current
              ? "共有されたグラフは編集できないため、変更した条件を自分のグラフとして保存してから追加します。"
              : "ダッシュボードに追加するには、先にグラフを保存します。"}
          </p>
        )}
        {plan.add && plan.save === "update" && current && (
          <p className="text-sm text-ink-2">
            変更した条件で「{current.name}」を上書き保存してから追加します。
          </p>
        )}
        {plan.editFields && (
          <>
            <Field label="グラフ名" htmlFor={nameId} required>
              <Input
                id={nameId}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：部署別の人数"
                autoFocus
              />
            </Field>
            <Field
              label="共有"
              help="共有すると、分析を使えるほかの人も一覧から開けます。集計は開いた人の閲覧範囲で行われます。"
            >
              <Checkbox
                label="ほかの人に共有する"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
            </Field>
          </>
        )}
        {plan.add && (
          <Field label="表示する幅" help="2列にすると、ダッシュボードの横幅いっぱいに表示します。">
            <div>
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
          </Field>
        )}
        {alreadyOnDashboard && (
          <p className="text-xs text-ink-3">
            このグラフはすでにダッシュボードにあります。追加すると2つ表示されます。
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
