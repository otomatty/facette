import { useMutation, useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { type DragEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ChartDimension, FieldValue, MemberSheetView, MemberSummary } from "../../../shared/types";
import { Face } from "../../components/Face";
import { DRAG_MIME } from "../../components/OrgBoard";
import { DepartmentSelect } from "../../components/pickers";
import {
  Checkbox,
  cx,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Segmented,
  Select,
  useToast,
} from "../../components/ui";
import { errorMessage, get, put, qs } from "../../lib/api";
import { queryClient } from "../../lib/queries";

type Dimensions = {
  base: { key: ChartDimension; label: string }[];
  fields: { key: ChartDimension; label: string; sheetId: number; fieldId: number; options: string[] }[];
};
type Editable = { sheetId: number; fieldId: number; type: "select" | "checkbox" } | null;
type Balance = {
  xLabels: string[];
  yLabels: string[];
  cells: { x: string; y: string; memberIds: number[] }[];
  members: MemberSummary[];
  editableX: Editable;
  editableY: Editable;
  editableMemberIds: number[];
};

const AXIS_EXCLUDE = new Set(["department", "workLocation", "hireYear", "status"]);
const BLANK_LABELS = new Set(["未回答", "評価なし", "不明", "未設定", "所属なし"]);

/** 並びを反転する。「未回答」などの区分は末尾に残す */
function reverseKeepingBlank(labels: string[]): string[] {
  const main = labels.filter((l) => !BLANK_LABELS.has(l)).reverse();
  return [...main, ...labels.filter((l) => BLANK_LABELS.has(l))];
}

export default function BalancePage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [size, setSize] = useState<"s" | "m">("m");
  const [overCell, setOverCell] = useState<string | null>(null);
  const [flipX, setFlipX] = useState<boolean | null>(null);
  const [flipY, setFlipY] = useState(false);
  const dims = useQuery({
    queryKey: ["analytics", "dimensions"],
    queryFn: () => get<Dimensions>("/analytics/dimensions"),
  });

  const options = useMemo(() => {
    if (!dims.data) return [];
    return [
      ...dims.data.fields.filter((f) => f.options.length <= 8).map((f) => ({ key: f.key, label: f.label })),
      ...dims.data.base.filter((b) => !AXIS_EXCLUDE.has(b.key)),
    ];
  }, [dims.data]);

  // 既定は「タレント評価」のパフォーマンス × ポテンシャル（9ボックス）
  const defaults = useMemo(() => {
    const perf = dims.data?.fields.find((f) => f.label.includes("パフォーマンス"));
    const pot = dims.data?.fields.find((f) => f.label.includes("ポテンシャル"));
    return { x: perf?.key ?? "evalRank", y: pot?.key ?? "grade" };
  }, [dims.data]);
  const x = (params.get("x") as ChartDimension) ?? defaults.x;
  const y = (params.get("y") as ChartDimension) ?? defaults.y;
  const departmentId = params.get("departmentId") ? Number(params.get("departmentId")) : null;
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  const balance = useQuery({
    queryKey: ["balance", x, y, departmentId],
    queryFn: () => get<Balance>(`/analytics/balance${qs({ x, y, departmentId })}`),
    enabled: !!dims.data,
  });

  const memberMap = useMemo(
    () => new Map((balance.data?.members ?? []).map((m) => [m.id, m])),
    [balance.data],
  );
  const editableIds = useMemo(() => new Set(balance.data?.editableMemberIds ?? []), [balance.data]);
  const canDrag = !!(balance.data?.editableX || balance.data?.editableY);

  const move = useMutation({
    mutationFn: async ({ memberId, toX, toY }: { memberId: number; toX: string; toY: string }) => {
      const b = balance.data!;
      const updates = new Map<number, Record<string, FieldValue>>();
      for (const [ed, label] of [
        [b.editableX, toX],
        [b.editableY, toY],
      ] as const) {
        if (!ed) continue;
        const cur = updates.get(ed.sheetId) ?? {};
        cur[String(ed.fieldId)] =
          ed.type === "checkbox" ? label === "はい" : label === "未回答" ? null : label;
        updates.set(ed.sheetId, cur);
      }
      const sheets = await get<{ items: MemberSheetView[] }>(`/members/${memberId}/sheets`);
      for (const [sheetId, data] of updates) {
        const view = sheets.items.find((s) => s.sheet.id === sheetId);
        const current = view?.records[0]?.data ?? {};
        await put(`/members/${memberId}/sheets/${sheetId}`, { data: { ...current, ...data } });
      }
    },
    onMutate: async ({ memberId, toX, toY }) => {
      // 画面上はすぐに移動させる
      queryClient.setQueryData<Balance>(["balance", x, y, departmentId], (old) => {
        if (!old) return old;
        const cells = old.cells.map((c) => ({
          ...c,
          memberIds: c.memberIds.filter((id) => id !== memberId),
        }));
        const target = cells.find((c) => c.x === toX && c.y === toY);
        if (target) target.memberIds.push(memberId);
        else cells.push({ x: toX, y: toY, memberIds: [memberId] });
        return { ...old, cells };
      });
    },
    onSuccess: (_, v) => {
      const m = memberMap.get(v.memberId);
      toast(`${m?.lastName ?? ""}さんを「${v.toX} × ${v.toY}」に移しました`);
      queryClient.invalidateQueries({ queryKey: ["member", v.memberId] });
    },
    onError: (e) => {
      toast(errorMessage(e), "error");
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
  });

  if (dims.isLoading) return <Loading />;
  if (dims.error) return <ErrorBox error={dims.error} />;
  const raw = balance.data;
  // 横軸は「低い→高い」を左から右に並べるのが見やすいので、高い区分から始まる軸は既定で反転する
  const reverseX = flipX ?? ["高", "S"].includes(raw?.xLabels[0] ?? "");
  const b = raw
    ? {
        ...raw,
        xLabels: reverseX ? reverseKeepingBlank(raw.xLabels) : raw.xLabels,
        yLabels: flipY ? reverseKeepingBlank(raw.yLabels) : raw.yLabels,
      }
    : undefined;
  const labelOf = (k: ChartDimension) => options.find((o) => o.key === k)?.label ?? k;
  const faceSize = size === "s" ? 30 : 40;

  const cellOf = (cx_: string, cy: string) =>
    b?.cells.find((c) => c.x === cx_ && c.y === cy)?.memberIds ?? [];

  const onDrop = (e: DragEvent, toX: string, toY: string) => {
    e.preventDefault();
    setOverCell(null);
    const memberId = Number(e.dataTransfer.getData(DRAG_MIME));
    if (!memberId || !b) return;
    const from = b.cells.find((c) => c.memberIds.includes(memberId));
    if (from && from.x === toX && from.y === toY) return;
    // 編集できない軸の値は変えられない
    if (!b.editableX && from && from.x !== toX) {
      toast(`「${labelOf(x)}」はここでは変更できません`, "error");
      return;
    }
    if (!b.editableY && from && from.y !== toY) {
      toast(`「${labelOf(y)}」はここでは変更できません`, "error");
      return;
    }
    move.mutate({ memberId, toX, toY });
  };

  return (
    <div>
      <PageHeader
        title="配置バランス図"
        description="2つの軸で社員を顔で並べ、人材の偏りや手薄な層を確かめます。タレント評価などシートの項目が軸のときは、顔をドラッグすると値を書き換えられます。"
      />
      <div className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="横軸" htmlFor="bx">
          <Select id="bx" value={x} onChange={(e) => setParam("x", e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="縦軸" htmlFor="by">
          <Select id="by" value={y} onChange={(e) => setParam("y", e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="部署" htmlFor="bd">
          <DepartmentSelect
            id="bd"
            value={departmentId}
            onChange={(v) => setParam("departmentId", v ? String(v) : null)}
            placeholder="全社"
          />
        </Field>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1 pb-0.5">
            <Checkbox label="横軸を逆順" checked={reverseX} onChange={(e) => setFlipX(e.target.checked)} />
            <Checkbox label="縦軸を逆順" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} />
          </div>
          <Segmented
            label="顔の大きさ"
            value={size}
            onChange={setSize}
            options={[
              { value: "s", label: "小" },
              { value: "m", label: "大" },
            ]}
          />
        </div>
      </div>

      {balance.isLoading && <Loading />}
      {balance.error && <ErrorBox error={balance.error} />}
      {b && (
        <>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-3">
            <Info className="size-3.5" />
            対象 {b.members.length}名（在籍者）。
            {canDrag
              ? `顔をドラッグすると${[b.editableX ? labelOf(x) : null, b.editableY ? labelOf(y) : null].filter(Boolean).join("・")}を変更できます（編集権限のある社員のみ）。`
              : "この軸の組み合わせでは値を変更できません。"}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-28 border-b border-line p-2 text-left text-[11px] font-normal text-ink-3">
                    縦：{labelOf(y).split("：").at(-1)}
                    <br />
                    横：{labelOf(x).split("：").at(-1)}
                  </th>
                  {b.xLabels.map((xl) => (
                    <th
                      key={xl}
                      className="min-w-44 border-b border-l border-line p-2 text-center text-[13px] font-bold"
                    >
                      {xl}
                      <span className="tabular ml-1.5 text-[11px] font-normal text-ink-3">
                        {b.cells.filter((c) => c.x === xl).reduce((s, c) => s + c.memberIds.length, 0)}名
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.yLabels.map((yl) => (
                  <tr key={yl}>
                    <th className="border-t border-line p-2 text-left align-top text-[13px] font-bold">
                      {yl}
                      <span className="tabular block text-[11px] font-normal text-ink-3">
                        {b.cells.filter((c) => c.y === yl).reduce((s, c) => s + c.memberIds.length, 0)}名
                      </span>
                    </th>
                    {b.xLabels.map((xl) => {
                      const ids = cellOf(xl, yl);
                      const key = `${xl}|${yl}`;
                      return (
                        <td
                          key={xl}
                          className={cx(
                            "border-t border-l border-line p-2 align-top transition-colors",
                            overCell === key && "bg-yamabuki-50 outline-2 -outline-offset-2 outline-yamabuki",
                          )}
                          onDragOver={
                            canDrag
                              ? (e) => {
                                  if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                                  e.preventDefault();
                                  setOverCell(key);
                                }
                              : undefined
                          }
                          onDragLeave={canDrag ? () => setOverCell(null) : undefined}
                          onDrop={canDrag ? (e) => onDrop(e, xl, yl) : undefined}
                          data-cell={key}
                        >
                          <div className="mb-1 text-right text-[11px] text-ink-3 tabular">
                            {ids.length || ""}
                          </div>
                          <div className="flex min-h-10 flex-wrap gap-1">
                            {ids.map((id) => {
                              const m = memberMap.get(id);
                              if (!m) return null;
                              const draggable = canDrag && editableIds.has(id);
                              return (
                                <Link
                                  key={id}
                                  to={`/members/${id}`}
                                  draggable={draggable}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(DRAG_MIME, String(id));
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                  title={`${m.lastName} ${m.firstName}（${m.departmentName ?? "所属なし"}）`}
                                  aria-label={`${m.lastName} ${m.firstName}`}
                                  data-member-id={id}
                                  className={cx(
                                    "rounded-[5px]",
                                    draggable && "cursor-grab active:cursor-grabbing",
                                  )}
                                >
                                  <Face member={m} size={faceSize} />
                                </Link>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
