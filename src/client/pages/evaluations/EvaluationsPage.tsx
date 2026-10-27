import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileText, PenLine, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EVAL_STEP_LABELS } from "../../../shared/constants";
import { formatDateJa, todayJst } from "../../../shared/dates";
import type { EvaluationPeriod, EvaluationSheetSummary, EvaluationTemplate } from "../../../shared/types";
import { MemberChip } from "../../components/Face";
import { DepartmentOptions } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Segmented,
  Select,
  Tabs,
  useToast,
} from "../../components/ui";
import { errorMessage, get, post } from "../../lib/api";
import { useAuth, useMasters } from "../../lib/queries";
import {
  evalKeys,
  formatScore,
  invalidateEvaluationLists,
  LinkButton,
  PeriodStatusBadge,
  RankBadge,
  StepBadge,
  StepBar,
  StepBarLegend,
} from "./parts";

type Tab = "own" | "evaluator" | "manage";
type MyResponse = { own: EvaluationSheetSummary[]; evaluator: EvaluationSheetSummary[] };

const ACTION_LABEL: Record<string, string> = {
  goal: "目標を設定してください",
  self: "自己評価を入力してください",
  first: "一次評価を入力してください",
  second: "二次評価を入力してください",
  final: "最終評価を確定してください",
};

export default function EvaluationsPage() {
  const me = useAuth();
  const [params, setParams] = useSearchParams();
  const canManage = me.capabilities.manageEvaluations;
  const my = useQuery({ queryKey: evalKeys.my, queryFn: () => get<MyResponse>("/evaluations/my") });

  const ownTurn = (my.data?.own ?? []).filter((s) => s.myTurn).length;
  const evalTurn = (my.data?.evaluator ?? []).filter((s) => s.myTurn).length;
  const hasEvaluator = (my.data?.evaluator.length ?? 0) > 0;

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "own", label: "自分の評価", count: ownTurn || undefined },
    ...(hasEvaluator || me.user.role === "manager"
      ? [{ value: "evaluator" as const, label: "評価者として", count: evalTurn || undefined }]
      : []),
    ...(canManage ? [{ value: "manage" as const, label: "運用管理" }] : []),
  ];
  const requested = params.get("tab") as Tab | null;
  // 指定がなければ、自分の番のシートがあるタブを開く（一般社員は「自分の評価」）
  const fallback: Tab = ownTurn > 0 ? "own" : evalTurn > 0 ? "evaluator" : canManage ? "manage" : "own";
  const tab: Tab =
    requested && (tabs.some((t) => t.value === requested) || (requested === "evaluator" && !my.data))
      ? requested
      : my.data
        ? fallback
        : "own";

  return (
    <div>
      <PageHeader
        title="評価"
        description="目標設定から自己評価、上長の評価、最終確定までを順に進めます。あなたの番になったシートから入力してください。"
      />
      <Tabs
        className="mb-5"
        tabs={tabs}
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          next.set("tab", v);
          setParams(next, { replace: true });
        }}
      />
      {tab === "manage" && canManage ? (
        <ManageTab />
      ) : my.isLoading ? (
        <Loading />
      ) : my.error || !my.data ? (
        <ErrorBox error={my.error} onRetry={() => my.refetch()} />
      ) : tab === "evaluator" ? (
        <EvaluatorTab sheets={my.data.evaluator} />
      ) : (
        <OwnTab sheets={my.data.own} />
      )}
    </div>
  );
}

// ───────── 自分の評価 ─────────
function OwnTab({ sheets }: { sheets: EvaluationSheetSummary[] }) {
  if (sheets.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState icon={<ClipboardCheck className="size-10" />} title="あなたの評価シートはまだありません">
          人事が評価期間を開始すると、ここに表示されます。
        </EmptyState>
      </div>
    );
  }
  const turn = sheets.filter((s) => s.myTurn);
  const rest = sheets.filter((s) => !s.myTurn);
  return (
    <div className="space-y-5">
      {turn.map((s) => (
        <Link
          key={s.id}
          to={`/evaluations/sheets/${s.id}`}
          className="group flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-yamabuki bg-yamabuki-50 px-4 py-4 ring-2 ring-yamabuki-100 hover:border-yamabuki-600 sm:px-5"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-yamabuki text-ink">
            <PenLine className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-xs text-ink-2">
              {s.periodName}
              <StepBadge step={s.step} />
            </span>
            <span className="mt-0.5 block text-base font-bold">
              {ACTION_LABEL[s.step] ?? "入力してください"}
            </span>
          </span>
          <span className="inline-flex h-9 w-full items-center justify-center rounded-md bg-ai-700 px-3.5 text-sm font-bold text-white group-hover:bg-ai-800 sm:w-auto">
            入力する
          </span>
        </Link>
      ))}
      <Panel title="評価シート" bodyClassName="p-0">
        <SheetList sheets={turn.length ? rest : sheets} showMember={false} />
        {turn.length > 0 && rest.length === 0 && (
          <p className="px-4 py-4 text-sm text-ink-3">過去の評価はまだありません。</p>
        )}
      </Panel>
    </div>
  );
}

function SheetList({ sheets, showMember }: { sheets: EvaluationSheetSummary[]; showMember: boolean }) {
  if (sheets.length === 0) return null;
  return (
    <ul className="divide-y divide-line-2">
      {sheets.map((s) => (
        <li key={s.id}>
          <Link
            to={`/evaluations/sheets/${s.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-ai-50/60"
          >
            {showMember ? (
              <span className="min-w-0 flex-1">
                <MemberChip member={s.member} link={false} />
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{s.periodName}</span>
                <span className="block text-xs text-ink-3">
                  一次評価者{" "}
                  {s.firstEvaluator ? `${s.firstEvaluator.lastName} ${s.firstEvaluator.firstName}` : "未設定"}
                </span>
              </span>
            )}
            <StepBadge step={s.step} />
            <span className="flex w-28 items-center justify-end gap-2">
              {s.step === "done" ? (
                <>
                  <span className="tabular text-sm font-bold">{formatScore(s.finalScore)}</span>
                  <RankBadge rank={s.finalRank} />
                </>
              ) : (
                <span className="text-xs text-ink-3">評価中</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ───────── 評価者として ─────────
type Filter = "turn" | "all";

function EvaluatorTab({ sheets }: { sheets: EvaluationSheetSummary[] }) {
  const me = useAuth();
  const myId = me.user.memberId;
  const turnCount = sheets.filter((s) => s.myTurn).length;
  const [filter, setFilter] = useState<Filter>(turnCount > 0 ? "turn" : "all");
  const groups = useMemo(() => {
    const map = new Map<
      number,
      { name: string; status: EvaluationSheetSummary["periodStatus"]; items: EvaluationSheetSummary[] }
    >();
    for (const s of sheets) {
      if (filter === "turn" && !s.myTurn) continue;
      const g = map.get(s.periodId) ?? { name: s.periodName, status: s.periodStatus, items: [] };
      g.items.push(s);
      map.set(s.periodId, g);
    }
    for (const g of map.values()) g.items.sort((a, b) => Number(b.myTurn) - Number(a.myTurn));
    return [...map.entries()];
  }, [sheets, filter]);

  if (sheets.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState
          icon={<ClipboardCheck className="size-10" />}
          title="評価者になっているシートはありません"
        >
          一次評価者・二次評価者に設定されると、部下の評価シートがここに表示されます。
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-ink-2">
          {turnCount > 0 ? (
            <>
              あなたの評価を待っているシートが
              <span className="tabular mx-1 text-lg font-bold text-ink">{turnCount}</span>件あります。
            </>
          ) : (
            "いま入力が必要なシートはありません。"
          )}
        </p>
        <Segmented
          label="表示するシート"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "turn", label: `自分の番（${turnCount}）` },
            { value: "all", label: `すべて（${sheets.length}）` },
          ]}
        />
      </div>
      {groups.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState title="いま入力が必要なシートはありません">
            「すべて」に切り替えると、評価者になっているシートをすべて確認できます。
          </EmptyState>
        </div>
      )}
      {groups.map(([periodId, g]) => (
        <Panel
          key={periodId}
          title={
            <span className="flex items-center gap-2">
              {g.name}
              <PeriodStatusBadge status={g.status} />
            </span>
          }
          description={`${g.items.length}名`}
          bodyClassName="p-0"
        >
          <div
            className="hidden border-b border-line bg-canvas/60 px-4 py-2 text-xs text-ink-3 md:grid md:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_10rem] md:gap-3"
            aria-hidden
          >
            <span>対象者</span>
            <span>あなたの役割</span>
            <span>ステップ</span>
            <span className="text-right">総合点</span>
            <span />
          </div>
          <ul className="divide-y divide-line-2">
            {g.items.map((s) => {
              const roles = [
                s.firstEvaluator?.id === myId ? "一次評価" : null,
                s.secondEvaluator?.id === myId ? "二次評価" : null,
              ].filter((r): r is string => r !== null);
              return (
                <li
                  key={s.id}
                  className={cx(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_10rem] md:py-2.5",
                    s.myTurn ? "border-l-4 border-yamabuki bg-yamabuki-50 pl-3" : "hover:bg-ai-50/60",
                  )}
                >
                  <div className="min-w-0">
                    <MemberChip member={s.member} />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                    {roles.map((r) => (
                      <Badge key={r} tone={r === "一次評価" ? "ai" : "fuji"}>
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 md:block">
                    <span className="text-xs text-ink-3 md:hidden">ステップ</span>
                    <StepBadge step={s.step} />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs text-ink-3 md:hidden">総合点</span>
                    <span className="tabular">{formatScore(s.finalScore)}</span>
                    {s.finalRank && <RankBadge rank={s.finalRank} />}
                  </div>
                  <div className="col-span-2 md:col-span-1 md:text-right">
                    {s.myTurn ? (
                      <LinkButton
                        to={`/evaluations/sheets/${s.id}`}
                        variant="primary"
                        size="sm"
                        className="w-full md:w-auto"
                      >
                        {EVAL_STEP_LABELS[s.step]}を入力
                      </LinkButton>
                    ) : (
                      <LinkButton to={`/evaluations/sheets/${s.id}`} size="sm" className="w-full md:w-auto">
                        開く
                      </LinkButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

// ───────── 運用管理 ─────────
function ManageTab() {
  const [creating, setCreating] = useState(false);
  const periods = useQuery({
    queryKey: evalKeys.periods,
    queryFn: async () => (await get<{ items: EvaluationPeriod[] }>("/evaluations/periods")).items,
  });
  const templates = useQuery({
    queryKey: evalKeys.templates,
    queryFn: async () => (await get<{ items: EvaluationTemplate[] }>("/evaluations/templates")).items,
  });

  const waitingFinal = (periods.data ?? []).filter(
    (p) => p.status === "active" && (p.stepCounts.final ?? 0) > 0,
  );

  return (
    <div className="space-y-5">
      {waitingFinal.map((p) => (
        <Link
          key={p.id}
          to={`/evaluations/periods/${p.id}?step=final`}
          className="group flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-yamabuki bg-yamabuki-50 px-4 py-3.5 hover:border-yamabuki-600 sm:px-5"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-yamabuki text-ink">
            <PenLine className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block text-xs text-ink-2">{p.name}</span>
            <span className="font-bold">
              最終確定を待っているシートが
              <span className="tabular mx-1 text-base">{p.stepCounts.final}</span>件あります
            </span>
          </span>
          <span className="inline-flex h-8 w-full items-center justify-center rounded-md bg-ai-700 px-2.5 text-[13px] font-bold text-white group-hover:bg-ai-800 sm:w-auto">
            確定待ちのシートを見る
          </span>
        </Link>
      ))}
      <Panel
        title="評価期間"
        description="期間ごとに対象者のシートを作成し、進捗を管理します。"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="size-4" />}
            disabled={!templates.data?.length}
            onClick={() => setCreating(true)}
          >
            評価期間を作成
          </Button>
        }
        bodyClassName="p-0"
      >
        {periods.isLoading ? (
          <Loading />
        ) : periods.error ? (
          <div className="p-4">
            <ErrorBox error={periods.error} onRetry={() => periods.refetch()} />
          </div>
        ) : !periods.data?.length ? (
          <EmptyState title="評価期間はまだありません">
            評価期間を作成すると、対象者の評価シートが作られ、ここで進捗を確認できます。
          </EmptyState>
        ) : (
          <>
            <div
              className="hidden border-b border-line bg-canvas/60 px-4 py-2 text-xs text-ink-3 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_15rem_5rem_17rem] lg:gap-3"
              aria-hidden
            >
              <span>評価期間</span>
              <span>テンプレート</span>
              <span>期間</span>
              <span>状態</span>
              <span>進捗</span>
            </div>
            <ul className="divide-y divide-line-2">
              {periods.data.map((p) => {
                const rate = p.sheetCount ? Math.round((p.doneCount / p.sheetCount) * 100) : 0;
                return (
                  <li key={p.id}>
                    <Link
                      to={`/evaluations/periods/${p.id}`}
                      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-ai-50/60 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_15rem_5rem_17rem]"
                    >
                      <span className="min-w-0">
                        <span className="block font-bold group-hover:text-ai-700">{p.name}</span>
                        <span className="block text-xs text-ink-3">
                          {p.useSecondStep ? "二次評価あり" : "二次評価なし"}
                        </span>
                      </span>
                      <span className="text-right lg:order-4 lg:text-left">
                        <PeriodStatusBadge status={p.status} />
                      </span>
                      <span className="col-span-2 min-w-0 truncate text-[13px] text-ink-2 lg:order-2 lg:col-span-1 lg:text-sm">
                        {p.templateName}
                      </span>
                      <span className="tabular col-span-2 text-[13px] text-ink-2 lg:order-3 lg:col-span-1 lg:text-sm">
                        {formatDateJa(p.startDate)} 〜 {formatDateJa(p.endDate)}
                      </span>
                      <span className="col-span-2 flex items-center gap-3 lg:order-5 lg:col-span-1">
                        <StepBar counts={p.stepCounts} useSecond={p.useSecondStep} className="flex-1" />
                        <span className="tabular shrink-0 text-right text-xs text-ink-2">
                          <span className="text-sm font-bold text-ink">{rate}%</span>（{p.doneCount}/
                          {p.sheetCount}）
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line-2 px-4 py-2.5">
              <StepBarLegend useSecond />
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="評価テンプレート"
        description="点数の段階・目標と行動の配分・ランク基準・行動評価の項目をまとめたものです。"
        actions={
          <LinkButton to="/evaluations/templates/new" size="sm">
            <Plus className="size-4" />
            テンプレートを作成
          </LinkButton>
        }
        bodyClassName="p-0"
      >
        {templates.isLoading ? (
          <Loading />
        ) : templates.error ? (
          <div className="p-4">
            <ErrorBox error={templates.error} onRetry={() => templates.refetch()} />
          </div>
        ) : !templates.data?.length ? (
          <EmptyState title="テンプレートはまだありません">
            テンプレートを作成すると、評価期間で使えるようになります。
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line-2">
            {templates.data.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/evaluations/templates/${t.id}`}
                  className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 hover:bg-ai-50/60"
                >
                  <FileText className="size-5 shrink-0 text-ai-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{t.name}</span>
                    {t.description && (
                      <span className="block truncate text-xs text-ink-3">{t.description}</span>
                    )}
                  </span>
                  <span className="tabular flex flex-wrap gap-x-4 text-xs text-ink-2">
                    <span>{t.scaleMax}段階</span>
                    <span>
                      目標 {t.goalWeight}% / 行動 {t.competencyWeight}%
                    </span>
                    <span>行動項目 {t.items.length}</span>
                    <span>{t.periodCount ? `${t.periodCount}期間で使用` : "未使用"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {creating && templates.data && (
        <CreatePeriodDialog templates={templates.data} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

function CreatePeriodDialog({
  templates,
  onClose,
}: {
  templates: EvaluationTemplate[];
  onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const masters = useMasters();
  const today = todayJst();
  const [form, setForm] = useState({
    name: "",
    templateId: templates[0]?.id ?? 0,
    startDate: today,
    endDate: "",
    useSecondStep: true,
    includeLeave: false,
  });
  const [scope, setScope] = useState<"all" | "departments">("all");
  const [deptIds, setDeptIds] = useState<number[]>([]);
  const [tried, setTried] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      post<{ id: number; created: number }>("/evaluations/periods", {
        ...form,
        name: form.name.trim(),
        targetDepartmentIds: scope === "all" ? [] : deptIds,
      }),
    onSuccess: (r) => {
      invalidateEvaluationLists();
      toast(`評価期間を作成しました（対象 ${r.created}名）`);
      onClose();
      navigate(`/evaluations/periods/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  // 一度「作成する」を押したあとは、入力に合わせてその場でエラーを更新する
  const problems: Record<string, string> = {};
  if (!form.name.trim()) problems.name = "評価期間名を入力してください";
  if (!form.startDate) problems.startDate = "開始日を入力してください";
  if (!form.endDate) problems.endDate = "終了日を入力してください";
  else if (form.startDate && form.endDate < form.startDate)
    problems.endDate = "終了日は開始日以降にしてください";
  if (scope === "departments" && deptIds.length === 0) problems.departments = "対象の部署を選んでください";
  const errors: Record<string, string> = tried ? problems : {};
  const submit = () => {
    setTried(true);
    if (Object.keys(problems).length === 0) create.mutate();
  };

  const depts = masters.data?.departments ?? [];
  const tpl = templates.find((t) => t.id === form.templateId);

  return (
    <Modal
      open
      onClose={onClose}
      title="評価期間を作成"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            作成する
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="評価期間名" htmlFor="period-name" required error={errors.name}>
          <Input
            id="period-name"
            value={form.name}
            maxLength={60}
            placeholder="例：2026年度 下期"
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field
          label="テンプレート"
          htmlFor="period-template"
          required
          help={
            tpl ? `${tpl.scaleMax}段階・目標 ${tpl.goalWeight}% / 行動 ${tpl.competencyWeight}%` : undefined
          }
        >
          <Select
            id="period-template"
            value={form.templateId}
            onChange={(e) => setForm({ ...form, templateId: Number(e.target.value) })}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="開始日" htmlFor="period-start" required error={errors.startDate}>
            <Input
              id="period-start"
              type="date"
              value={form.startDate}
              aria-invalid={errors.startDate ? true : undefined}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="終了日" htmlFor="period-end" required error={errors.endDate}>
            <Input
              id="period-end"
              type="date"
              value={form.endDate}
              min={form.startDate}
              aria-invalid={errors.endDate ? true : undefined}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>
        <Field label="評価の流れ">
          <Checkbox
            label="二次評価を使う（一次評価のあと、さらに上の上長が評価します）"
            checked={form.useSecondStep}
            onChange={(e) => setForm({ ...form, useSecondStep: e.target.checked })}
          />
        </Field>
        <Field label="対象者" error={errors.departments}>
          <div className="space-y-2">
            <Segmented
              label="対象者の範囲"
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "全社" },
                { value: "departments", label: "部署を選ぶ" },
              ]}
            />
            {scope === "departments" && (
              <DepartmentMultiSelect
                departments={depts}
                value={deptIds}
                onChange={setDeptIds}
                invalid={!!errors.departments}
              />
            )}
            <Checkbox
              label="休職中の社員も対象にする"
              checked={form.includeLeave}
              onChange={(e) => setForm({ ...form, includeLeave: e.target.checked })}
            />
            <p className="text-xs text-ink-3">
              選んだ部署の配下も含めて、在籍中の社員のシートを作成します。評価者は部署の長から自動で設定され、あとで変更できます。
            </p>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function DepartmentMultiSelect({
  departments,
  value,
  onChange,
  invalid,
}: {
  departments: { id: number; name: string }[];
  value: number[];
  onChange: (v: number[]) => void;
  invalid?: boolean;
}) {
  const byId = new Map(departments.map((d) => [d.id, d]));
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== id))}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-ai-200 bg-ai-50 px-2 text-[13px] text-ai-800 hover:border-beni/40 hover:bg-beni-100 hover:text-beni"
                aria-label={`${byId.get(id)?.name ?? ""}を外す`}
              >
                {byId.get(id)?.name ?? `部署${id}`}
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Select
        aria-label="部署を追加"
        aria-invalid={invalid || undefined}
        value=""
        onChange={(e) => {
          const id = Number(e.target.value);
          if (id && !value.includes(id)) onChange([...value, id]);
        }}
      >
        <option value="">部署を追加</option>
        <DepartmentOptions />
      </Select>
    </div>
  );
}
