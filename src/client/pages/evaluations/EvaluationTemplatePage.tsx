import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { DEFAULT_RANK_RULES } from "../../../shared/constants";
import type { EvaluationTemplate } from "../../../shared/types";
import {
  Button,
  cx,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, patch, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { evalKeys, RankBadge } from "./parts";

type ItemDraft = { key: string; id?: number; title: string; description: string; weight: number };
type RankDraft = { key: string; rank: string; min: number | "" };
type Draft = {
  name: string;
  description: string;
  scaleMax: number;
  goalWeight: number;
  rankRules: RankDraft[];
  items: ItemDraft[];
};

let seq = 0;
const k = () => `k${++seq}`;

function toDraft(t: EvaluationTemplate | null): Draft {
  if (!t) {
    return {
      name: "",
      description: "",
      scaleMax: 5,
      goalWeight: 60,
      rankRules: DEFAULT_RANK_RULES.map((r) => ({ key: k(), ...r })),
      items: [{ key: k(), title: "", description: "", weight: 1 }],
    };
  }
  return {
    name: t.name,
    description: t.description,
    scaleMax: t.scaleMax,
    goalWeight: t.goalWeight,
    rankRules: t.rankRules.map((r) => ({ key: k(), ...r })),
    items: t.items.map((i) => ({
      key: k(),
      id: i.id,
      title: i.title,
      description: i.description,
      weight: i.weight,
    })),
  };
}

export default function EvaluationTemplatePage() {
  const me = useAuth();
  const { id } = useParams();
  const isNew = id === "new";
  const templateId = Number(id);
  const query = useQuery({
    queryKey: evalKeys.template(templateId),
    queryFn: () => get<EvaluationTemplate>(`/evaluations/templates/${templateId}`),
    enabled: !isNew,
  });
  if (!me.capabilities.manageEvaluations) return <Navigate to="/evaluations" replace />;
  if (!isNew && query.isLoading) return <Loading />;
  if (!isNew && (query.error || !query.data))
    return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  return <TemplateForm key={id} template={isNew ? null : query.data!} />;
}

function TemplateForm({ template }: { template: EvaluationTemplate | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => toDraft(template));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const competencyWeight = 100 - draft.goalWeight;

  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "テンプレート名を入力してください";
  if (draft.rankRules.length === 0) errors.rank = "ランクを1つ以上登録してください";
  draft.rankRules.forEach((r) => {
    if (!r.rank.trim()) errors[`rank-${r.key}`] = "ランク名を入力してください";
    else if (r.min === "" || r.min < 0 || r.min > draft.scaleMax)
      errors[`rank-${r.key}`] = `下限は0〜${draft.scaleMax}で入力してください`;
  });
  const rankNames = draft.rankRules.map((r) => r.rank.trim()).filter(Boolean);
  if (new Set(rankNames).size !== rankNames.length) errors.rank = "同じ名前のランクがあります";
  if (competencyWeight > 0 && draft.items.length === 0)
    errors.items = "行動評価の項目を1つ以上登録してください";
  draft.items.forEach((i) => {
    if (!i.title.trim()) errors[`item-${i.key}`] = "評価項目名を入力してください";
  });
  const hasErrors = Object.keys(errors).length > 0;
  const err = (key: string) => (tried ? (errors[key] ?? null) : null);

  const payload = () => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    scaleMax: draft.scaleMax,
    goalWeight: draft.goalWeight,
    competencyWeight,
    rankRules: draft.rankRules.map((r) => ({ rank: r.rank.trim(), min: Number(r.min) })),
    items: draft.items.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      title: i.title.trim(),
      description: i.description.trim(),
      weight: i.weight,
    })),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (template) {
        await patch(`/evaluations/templates/${template.id}`, payload());
        return template.id;
      }
      return (await post<{ id: number }>("/evaluations/templates", payload())).id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: evalKeys.templates });
      queryClient.invalidateQueries({ queryKey: evalKeys.template(id) });
      queryClient.invalidateQueries({ queryKey: ["evaluations", "sheet"] });
      toast(template ? "テンプレートを保存しました" : "テンプレートを作成しました");
      if (!template) navigate(`/evaluations/templates/${id}`, { replace: true });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: () => del(`/evaluations/templates/${template!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evalKeys.templates });
      toast("テンプレートを削除しました");
      navigate("/evaluations?tab=manage");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const moveItem = (i: number, dir: -1 | 1) => {
    const items = [...draft.items];
    const [x] = items.splice(i, 1);
    items.splice(i + dir, 0, x!);
    set({ items });
  };
  const setItem = (key: string, patch: Partial<ItemDraft>) =>
    set({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const setRank = (key: string, patch: Partial<RankDraft>) =>
    set({ rankRules: draft.rankRules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  const sortedRanks = [...draft.rankRules]
    .filter((r) => r.rank.trim() && r.min !== "")
    .sort((a, b) => Number(b.min) - Number(a.min));

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
        <Link to="/evaluations?tab=manage" className="hover:text-ai-700">
          評価の運用管理
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-ink-2">{template ? template.name : "テンプレートを作成"}</span>
      </nav>
      <PageHeader
        title={template ? "テンプレートを編集" : "テンプレートを作成"}
        description={
          template?.periodCount
            ? `${template.periodCount}件の評価期間で使われています。実施中・終了した期間で使われている場合、評価項目は削除できません（名称や説明は変更できます）。`
            : "点数の段階、目標と行動の配分、ランクの基準、行動評価の項目を設定します。"
        }
        actions={
          <>
            {template && (
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                disabled={template.periodCount > 0}
                title={template.periodCount > 0 ? "評価期間で使われているため削除できません" : undefined}
                loading={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `「${template.name}」を削除しますか？`,
                      message: "このテンプレートは元に戻せません。",
                      confirmLabel: "削除",
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                削除
              </Button>
            )}
            <Button
              variant="primary"
              loading={save.isPending}
              onClick={() => {
                setTried(true);
                if (hasErrors) {
                  toast("入力内容を確認してください", "error");
                  return;
                }
                save.mutate();
              }}
            >
              {template ? "保存" : "作成する"}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="基本設定">
          <div className="grid gap-4">
            <Field label="テンプレート名" htmlFor="tpl-name" required error={err("name")}>
              <Input
                id="tpl-name"
                value={draft.name}
                maxLength={60}
                placeholder="例：総合評価（目標＋行動）"
                aria-invalid={err("name") ? true : undefined}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="説明" htmlFor="tpl-desc" help="運用管理のテンプレート一覧に表示されます">
              <Textarea
                id="tpl-desc"
                rows={3}
                maxLength={1000}
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <Field label="点数の段階" htmlFor="tpl-scale" help={`各項目を1〜${draft.scaleMax}点で評価します`}>
              <Select
                id="tpl-scale"
                className="w-40"
                value={draft.scaleMax}
                onChange={(e) => set({ scaleMax: Number(e.target.value) })}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}段階
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="目標と行動の配分"
              htmlFor="tpl-goal"
              help="総合点は、目標の平均点と行動評価の平均点をこの比率で合成します。目標を0%にすると目標の設定は行いません。"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-ink-2">目標</span>
                  <Input
                    id="tpl-goal"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={5}
                    className="tabular w-20 text-right"
                    value={draft.goalWeight}
                    onChange={(e) =>
                      set({ goalWeight: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })
                    }
                  />
                  <span className="text-sm text-ink-3">%</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-ink-2">行動</span>
                  <Input
                    aria-label="行動の配分"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={5}
                    className="tabular w-20 text-right"
                    value={competencyWeight}
                    onChange={(e) =>
                      set({
                        goalWeight: 100 - Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))),
                      })
                    }
                  />
                  <span className="text-sm text-ink-3">%</span>
                </span>
                <span className="tabular rounded-md bg-wakaba-100 px-2 py-1 text-[13px] font-bold text-wakaba">
                  合計 {draft.goalWeight + competencyWeight}%
                </span>
              </div>
              <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-line-2" aria-hidden>
                <span className="bg-ai-500" style={{ width: `${draft.goalWeight}%` }} />
                <span className="bg-yamabuki" style={{ width: `${competencyWeight}%` }} />
              </div>
            </Field>
          </div>
        </Panel>

        <Panel
          title="ランクの基準"
          description="総合点が下限以上のうち、最も高いランクになります"
          bodyClassName="p-0"
        >
          {draft.rankRules.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2 font-normal">ランク</th>
                    <th className="px-3 py-2 font-normal">下限点（以上）</th>
                    <th className="w-12 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {draft.rankRules.map((r) => (
                    <tr key={r.key} className="align-top">
                      <td className="px-4 py-2">
                        <Input
                          aria-label="ランク名"
                          className="w-20"
                          maxLength={4}
                          value={r.rank}
                          aria-invalid={err(`rank-${r.key}`) && !r.rank.trim() ? true : undefined}
                          onChange={(e) => setRank(r.key, { rank: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`${r.rank || "ランク"}の下限点`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={draft.scaleMax}
                          step={0.05}
                          className="tabular w-28 text-right"
                          value={r.min}
                          aria-invalid={err(`rank-${r.key}`) && r.rank.trim() ? true : undefined}
                          onChange={(e) =>
                            setRank(r.key, { min: e.target.value === "" ? "" : Number(e.target.value) })
                          }
                        />
                        {err(`rank-${r.key}`) && (
                          <p className="mt-1 text-xs text-beni" role="alert">
                            {err(`rank-${r.key}`)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <IconButton
                          label="ランクを削除"
                          className="hover:bg-beni-100 hover:text-beni"
                          onClick={() => set({ rankRules: draft.rankRules.filter((x) => x.key !== r.key) })}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-line-2 px-4 py-3">
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              disabled={draft.rankRules.length >= 10}
              onClick={() => set({ rankRules: [...draft.rankRules, { key: k(), rank: "", min: 0 }] })}
            >
              ランクを追加
            </Button>
            {err("rank") && (
              <p className="text-xs text-beni" role="alert">
                {err("rank")}
              </p>
            )}
          </div>
          {sortedRanks.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-2 px-4 py-2.5 text-xs text-ink-3">
              <span>判定の順</span>
              {sortedRanks.map((r, i) => (
                <span key={r.key} className="tabular flex items-center gap-1">
                  <RankBadge rank={r.rank.trim()} />
                  {i === sortedRanks.length - 1 && Number(r.min) > 0
                    ? `${r.min}点以上（それ未満もこのランク）`
                    : `${r.min}点以上`}
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="行動評価の項目"
        description={
          competencyWeight === 0
            ? "行動の配分が0%のため、項目は総合点に反映されません"
            : "重みは項目の平均点を出すときの比重です（1〜10）"
        }
        className="mt-5"
        bodyClassName="p-0"
      >
        {draft.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-2">
            評価項目を追加すると、評価シートの行動評価として表示されます。
          </p>
        ) : (
          <ol className="divide-y divide-line-2">
            {draft.items.map((it, i) => (
              <li key={it.key} className="flex gap-3 px-4 py-4">
                <span className="tabular mt-7 flex size-6 shrink-0 items-center justify-center rounded-full bg-ai-100 text-xs font-bold text-ai-800">
                  {i + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6rem]">
                  <Field
                    label="評価項目"
                    htmlFor={`item-title-${it.key}`}
                    required
                    error={err(`item-${it.key}`)}
                  >
                    <Input
                      id={`item-title-${it.key}`}
                      value={it.title}
                      maxLength={60}
                      placeholder="例：主体性"
                      aria-invalid={err(`item-${it.key}`) ? true : undefined}
                      onChange={(e) => setItem(it.key, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="説明" htmlFor={`item-desc-${it.key}`}>
                    <Input
                      id={`item-desc-${it.key}`}
                      value={it.description}
                      maxLength={400}
                      placeholder="評価の観点"
                      onChange={(e) => setItem(it.key, { description: e.target.value })}
                    />
                  </Field>
                  <Field label="重み" htmlFor={`item-weight-${it.key}`}>
                    <Select
                      id={`item-weight-${it.key}`}
                      className="tabular"
                      value={it.weight}
                      onChange={(e) => setItem(it.key, { weight: Number(e.target.value) })}
                    >
                      {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 pt-5 sm:flex-row sm:items-start sm:pt-6">
                  <IconButton label="上へ移動" disabled={i === 0} onClick={() => moveItem(i, -1)}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton
                    label="下へ移動"
                    disabled={i === draft.items.length - 1}
                    onClick={() => moveItem(i, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton
                    label="評価項目を削除"
                    className="hover:bg-beni-100 hover:text-beni"
                    onClick={() => set({ items: draft.items.filter((x) => x.key !== it.key) })}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div
          className={cx(
            "flex flex-wrap items-center gap-3 border-t border-line-2 px-4 py-3",
            draft.items.length === 0 && "border-t-0",
          )}
        >
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            disabled={draft.items.length >= 30}
            onClick={() =>
              set({ items: [...draft.items, { key: k(), title: "", description: "", weight: 1 }] })
            }
          >
            評価項目を追加
          </Button>
          {err("items") && (
            <p className="text-xs text-beni" role="alert">
              {err("items")}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
