import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  Play,
  RotateCcw,
  Search,
  Square,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { EVAL_STEP_LABELS, EVAL_STEPS, type EvalStep } from "../../../shared/constants";
import { formatDateJa } from "../../../shared/dates";
import type {
  ChartData,
  EvaluationPeriod,
  EvaluationSheetSummary,
  MemberSummary,
} from "../../../shared/types";
import { ColumnChart } from "../../components/charts";
import { MemberChip } from "../../components/Face";
import { MemberPicker } from "../../components/pickers";
import {
  Button,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, downloadText, errorMessage, get, patch, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import {
  evalKeys,
  formatScore,
  invalidateEvaluationLists,
  PeriodStatusBadge,
  RankBadge,
  StepBadge,
  StepBar,
  StepBarLegend,
  stepsOf,
} from "./parts";

export default function EvaluationPeriodPage() {
  const me = useAuth();
  if (!me.capabilities.manageEvaluations) return <Navigate to="/evaluations" replace />;
  return <PeriodView />;
}

function PeriodView() {
  const { id } = useParams();
  const periodId = Number(id);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [params] = useSearchParams();
  const [stepFilter, setStepFilter] = useState<EvalStep | "">(() => {
    const v = params.get("step");
    return v && (EVAL_STEPS as readonly string[]).includes(v) ? (v as EvalStep) : "";
  });
  const [editing, setEditing] = useState<EvaluationSheetSummary | null>(null);
  const [adding, setAdding] = useState(false);

  const periods = useQuery({
    queryKey: evalKeys.periods,
    queryFn: async () => (await get<{ items: EvaluationPeriod[] }>("/evaluations/periods")).items,
  });
  const detail = useQuery({
    queryKey: evalKeys.period(periodId),
    queryFn: () => get<{ sheets: EvaluationSheetSummary[] }>(`/evaluations/periods/${periodId}`),
  });
  const period = periods.data?.find((p) => p.id === periodId);
  const sheets = detail.data?.sheets ?? [];

  const refresh = () => {
    invalidateEvaluationLists();
  };

  const setStatus = useMutation({
    mutationFn: (v: { status: EvaluationPeriod["status"]; done: string }) =>
      patch(`/evaluations/periods/${periodId}`, { status: v.status }),
    onSuccess: (_, v) => {
      refresh();
      toast(v.done);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: () => del(`/evaluations/periods/${periodId}`),
    onSuccess: () => {
      refresh();
      toast("評価期間を削除しました");
      navigate("/evaluations?tab=manage");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const exportCsv = useMutation({
    mutationFn: () => get<{ filename: string; csv: string }>(`/evaluations/periods/${periodId}/export`),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv);
      toast("CSV を出力しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const removeSheet = useMutation({
    mutationFn: (sheetId: number) => del(`/evaluations/sheets/${sheetId}`),
    onSuccess: () => {
      refresh();
      toast("対象から外しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sheets.filter((s) => {
      if (stepFilter && s.step !== stepFilter) return false;
      if (!t) return true;
      const m = s.member;
      return [
        `${m.lastName}${m.firstName}`,
        `${m.lastName} ${m.firstName}`,
        `${m.lastNameKana}${m.firstNameKana}`,
        m.employeeCode,
        m.departmentName ?? "",
      ].some((x) => x.toLowerCase().includes(t));
    });
  }, [sheets, q, stepFilter]);

  const rankData: ChartData | null = useMemo(() => {
    const done = sheets.filter((s) => s.step === "done" && s.finalRank);
    if (!done.length) return null;
    const ranks = ["S", "A", "B", "C", "D"];
    for (const s of done) if (!ranks.includes(s.finalRank!)) ranks.push(s.finalRank!);
    return {
      labels: ranks,
      series: [{ name: "人数", values: ranks.map((r) => done.filter((s) => s.finalRank === r).length) }],
      total: done.length,
    };
  }, [sheets]);

  if (periods.isLoading || detail.isLoading) return <Loading />;
  if (periods.error || detail.error)
    return (
      <ErrorBox
        error={periods.error ?? detail.error}
        onRetry={() => {
          periods.refetch();
          detail.refetch();
        }}
      />
    );
  if (!period) {
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState
          title="評価期間が見つかりません"
          action={
            <Link to="/evaluations?tab=manage" className="text-sm font-bold text-ai-700 hover:underline">
              評価期間の一覧へ戻る
            </Link>
          }
        >
          削除されたか、URL が正しくない可能性があります。
        </EmptyState>
      </div>
    );
  }

  const steps = stepsOf(period.useSecondStep);
  const rate = period.sheetCount ? Math.round((period.doneCount / period.sheetCount) * 100) : 0;
  const memberIds = sheets.map((s) => s.member.id);

  const statusActions = (
    <>
      <Button
        icon={<Download className="size-4" />}
        loading={exportCsv.isPending}
        onClick={() => exportCsv.mutate()}
      >
        CSV出力
      </Button>
      {period.status === "draft" && (
        <>
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            loading={remove.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: `「${period.name}」を削除しますか？`,
                  message: `対象者 ${period.sheetCount}名分の評価シートも削除され、元に戻せません。`,
                  confirmLabel: "削除",
                  danger: true,
                })
              )
                remove.mutate();
            }}
          >
            削除
          </Button>
          <Button
            variant="primary"
            icon={<Play className="size-4" />}
            loading={setStatus.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: "評価を開始しますか？",
                  message: `対象者 ${period.sheetCount}名が目標設定を始められるようになります。開始後は準備中に戻せません。`,
                  confirmLabel: "評価を開始",
                })
              )
                setStatus.mutate({ status: "active", done: "評価を開始しました" });
            }}
          >
            評価を開始
          </Button>
        </>
      )}
      {period.status === "active" && (
        <Button
          icon={<Square className="size-4" />}
          loading={setStatus.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: "評価期間を終了しますか？",
                message: `未完了のシートが ${period.sheetCount - period.doneCount}件あります。終了すると入力・提出ができなくなります（あとで再開できます）。`,
                confirmLabel: "評価期間を終了",
                danger: true,
              })
            )
              setStatus.mutate({ status: "closed", done: "評価期間を終了しました" });
          }}
        >
          評価期間を終了
        </Button>
      )}
      {period.status === "closed" && (
        <Button
          icon={<RotateCcw className="size-4" />}
          loading={setStatus.isPending}
          onClick={() => setStatus.mutate({ status: "active", done: "評価期間を再開しました" })}
        >
          再開
        </Button>
      )}
    </>
  );

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
        <Link to="/evaluations?tab=manage" className="hover:text-ai-700">
          評価の運用管理
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-ink-2">{period.name}</span>
      </nav>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {period.name}
            <PeriodStatusBadge status={period.status} />
          </span>
        }
        description={`${formatDateJa(period.startDate)} 〜 ${formatDateJa(period.endDate)}　${period.templateName}　${period.useSecondStep ? "二次評価あり" : "二次評価なし"}`}
        actions={statusActions}
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Panel title="進捗" bodyClassName="p-4">
          <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <p className="text-xs text-ink-3">完了率</p>
              <p className="tabular text-[28px] leading-tight font-bold">
                {rate}
                <span className="ml-0.5 text-sm font-normal text-ink-3">%</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-3">完了 / 対象者</p>
              <p className="tabular text-lg font-bold">
                {period.doneCount}
                <span className="mx-1 text-sm font-normal text-ink-3">/</span>
                {period.sheetCount}
                <span className="ml-0.5 text-xs font-normal text-ink-3">名</span>
              </p>
            </div>
          </div>
          <StepBar counts={period.stepCounts} useSecond={period.useSecondStep} className="mb-3 h-3" />
          <StepBarLegend useSecond={period.useSecondStep} />
          <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {steps.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={stepFilter === s}
                  onClick={() => setStepFilter(stepFilter === s ? "" : s)}
                  className={cx(
                    "w-full rounded-md border px-2 py-2 text-left transition-colors",
                    stepFilter === s
                      ? "border-ai-600 bg-ai-50 ring-2 ring-ai-100"
                      : "border-line hover:bg-ai-50",
                  )}
                >
                  <span className="block truncate text-[11px] text-ink-3">{EVAL_STEP_LABELS[s]}</span>
                  <span className="tabular block text-lg leading-tight font-bold">
                    {period.stepCounts[s] ?? 0}
                    <span className="ml-0.5 text-[11px] font-normal text-ink-3">名</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="ランク分布" description="完了したシートの最終ランク">
          {rankData ? (
            <ColumnChart data={rankData} height={180} />
          ) : (
            <p className="py-10 text-center text-sm text-ink-3">
              完了したシートがあると、ここに分布を表示します。
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="評価シート"
        description={`${filtered.length}名を表示中（全${sheets.length}名）`}
        actions={
          period.status !== "closed" && (
            <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              対象者を追加
            </Button>
          )
        }
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              aria-label="氏名・部署で絞り込み"
              placeholder="氏名・部署・社員番号で絞り込み"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select
            aria-label="ステップで絞り込み"
            className="w-40"
            value={stepFilter}
            onChange={(e) => setStepFilter(e.target.value as EvalStep | "")}
          >
            <option value="">すべてのステップ</option>
            {steps.map((s) => (
              <option key={s} value={s}>
                {EVAL_STEP_LABELS[s]}（{period.stepCounts[s] ?? 0}）
              </option>
            ))}
          </Select>
        </div>
        {sheets.length === 0 ? (
          <EmptyState icon={<Users className="size-10" />} title="対象者がいません">
            「対象者を追加」から評価する社員を選んでください。
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="条件に合うシートがありません">絞り込みの条件を変えてお試しください。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-normal">対象者</th>
                  <th className="px-3 py-2 font-normal">一次評価者</th>
                  {period.useSecondStep && <th className="px-3 py-2 font-normal">二次評価者</th>}
                  <th className="px-3 py-2 font-normal">ステップ</th>
                  <th className="px-3 py-2 text-right font-normal">総合点</th>
                  <th className="px-3 py-2 text-center font-normal">ランク</th>
                  <th className="w-36 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer hover:bg-ai-50/60"
                    onClick={() => navigate(`/evaluations/sheets/${s.id}`)}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/evaluations/sheets/${s.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block min-w-0"
                      >
                        <MemberChip member={s.member} link={false} />
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <EvaluatorCell member={s.firstEvaluator} />
                    </td>
                    {period.useSecondStep && (
                      <td className="px-3 py-2.5">
                        <EvaluatorCell member={s.secondEvaluator} />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <StepBadge step={s.step} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{formatScore(s.finalScore)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <RankBadge rank={s.finalRank} />
                    </td>
                    <td
                      className="px-4 py-2.5 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        評価者を変更
                      </Button>
                      {period.status !== "closed" && (
                        <IconButton
                          label="対象から外す"
                          className="hover:bg-beni-100 hover:text-beni"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `${s.member.lastName} ${s.member.firstName}さんを対象から外しますか？`,
                                message: "この期間の評価シートと入力済みの内容が削除され、元に戻せません。",
                                confirmLabel: "対象から外す",
                                danger: true,
                              })
                            )
                              removeSheet.mutate(s.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && (
        <EvaluatorDialog sheet={editing} useSecond={period.useSecondStep} onClose={() => setEditing(null)} />
      )}
      {adding && (
        <AddMembersDialog periodId={periodId} excludeIds={memberIds} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function EvaluatorCell({ member }: { member: MemberSummary | null }) {
  if (!member) return <span className="text-xs text-ink-3">未設定</span>;
  return <MemberChip member={member} size={26} link={false} sub={member.jobTitleName ?? undefined} />;
}

function EvaluatorDialog({
  sheet,
  useSecond,
  onClose,
}: {
  sheet: EvaluationSheetSummary;
  useSecond: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [first, setFirst] = useState<MemberSummary | null>(sheet.firstEvaluator);
  const [second, setSecond] = useState<MemberSummary | null>(sheet.secondEvaluator);
  const save = useMutation({
    mutationFn: () =>
      patch(`/evaluations/sheets/${sheet.id}/evaluators`, {
        firstEvaluatorId: first?.id ?? null,
        secondEvaluatorId: second?.id ?? null,
      }),
    onSuccess: () => {
      invalidateEvaluationLists();
      queryClient.invalidateQueries({ queryKey: evalKeys.sheet(sheet.id) });
      toast("評価者を変更しました");
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const same = !!first && !!second && first.id === second.id;
  return (
    <Modal
      open
      onClose={onClose}
      title="評価者を変更"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} disabled={same} onClick={() => save.mutate()}>
            保存
          </Button>
        </>
      }
    >
      <div className="mb-4 rounded-md bg-canvas px-3 py-2">
        <MemberChip member={sheet.member} link={false} />
      </div>
      <div className="grid gap-4">
        <Field label="一次評価者" htmlFor="ev-first" help="未設定にすると人事が一次評価を行います">
          <MemberPicker id="ev-first" value={first} onChange={setFirst} excludeIds={[sheet.member.id]} />
        </Field>
        <Field
          label="二次評価者"
          htmlFor="ev-second"
          error={same ? "一次評価者と同じ人は選べません" : null}
          help={
            useSecond ? "未設定にすると人事が二次評価を行います" : "この評価期間は二次評価を使わない設定です"
          }
        >
          <MemberPicker id="ev-second" value={second} onChange={setSecond} excludeIds={[sheet.member.id]} />
        </Field>
      </div>
    </Modal>
  );
}

function AddMembersDialog({
  periodId,
  excludeIds,
  onClose,
}: {
  periodId: number;
  excludeIds: number[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<MemberSummary[]>([]);
  const add = useMutation({
    mutationFn: () =>
      post<{ created: number }>(`/evaluations/periods/${periodId}/sheets`, {
        memberIds: picked.map((m) => m.id),
      }),
    onSuccess: () => {
      invalidateEvaluationLists();
      toast(`${picked.length}名を対象者に追加しました`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="対象者を追加"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={picked.length === 0}
            onClick={() => add.mutate()}
          >
            {picked.length > 0 ? `${picked.length}名を追加` : "追加"}
          </Button>
        </>
      }
    >
      <Field label="社員を検索" htmlFor="add-member" help="評価者は部署の長から自動で設定されます">
        <MemberPicker
          id="add-member"
          value={null}
          excludeIds={[...excludeIds, ...picked.map((m) => m.id)]}
          onChange={(m) => m && setPicked((list) => [...list, m])}
        />
      </Field>
      {picked.length > 0 && (
        <ul className="mt-3 divide-y divide-line-2 rounded-md border border-line">
          {picked.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <MemberChip member={m} size={28} link={false} />
              </span>
              <IconButton
                label="選択を外す"
                onClick={() => setPicked((list) => list.filter((x) => x.id !== m.id))}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
