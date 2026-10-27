import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ClipboardCopy,
  CornerUpLeft,
  History,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useParams } from "react-router";
import { EVAL_STEP_LABELS, type EvalPhase } from "../../../shared/constants";
import { formatDateTimeJa } from "../../../shared/dates";
import {
  nextStep,
  previousStep,
  rankFor,
  totalScore,
  validateGoalWeights,
  weightedAverage,
} from "../../../shared/evaluation";
import type { EvaluationScoreEntry, EvaluationSheetDetail } from "../../../shared/types";
import { Face, MemberChip, StatusBadge } from "../../components/Face";
import {
  Badge,
  Button,
  cx,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Panel,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { errorMessage, get, post, put } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import {
  evalKeys,
  formatScore,
  invalidateEvaluationLists,
  PeriodStatusBadge,
  PHASE_LABELS,
  PHASE_ORDER,
  RankBadge,
  StepProgress,
  stepsOf,
} from "./parts";

type Detail = EvaluationSheetDetail;
type GoalDraft = { key: string; title: string; description: string; weight: number };
type Row = {
  key: string;
  kind: "goal" | "item";
  title: string;
  description: string;
  weight: number;
};

let keySeq = 0;
const newKey = () => `g${++keySeq}`;

export default function EvaluationSheetPage() {
  const { id } = useParams();
  const sheetId = Number(id);
  const query = useQuery({
    queryKey: evalKeys.sheet(sheetId),
    queryFn: () => get<Detail>(`/evaluations/sheets/${sheetId}`),
    enabled: Number.isFinite(sheetId),
  });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data)
    return (
      <div>
        <Breadcrumb />
        <ErrorBox error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  const d = query.data;
  return <SheetView key={`${d.id}-${d.step}-${d.editable ?? "none"}`} detail={d} />;
}

function Breadcrumb({ current }: { current?: string }) {
  return (
    <nav aria-label="パンくず" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
      <Link to="/evaluations" className="hover:text-ai-700">
        評価
      </Link>
      {current && (
        <span className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          <span className="text-ink-2">{current}</span>
        </span>
      )}
    </nav>
  );
}

function waitingText(d: Detail): string {
  if (d.step === "done") return "評価が確定しました。";
  if (d.periodStatus === "draft") return "評価期間が始まると入力できるようになります。";
  if (d.periodStatus === "closed") return "評価期間が終了したため、入力できません。";
  const name = (m: Detail["firstEvaluator"]) => (m ? `${m.lastName} ${m.firstName}さん` : "人事");
  switch (d.step) {
    case "goal":
      return `${d.member.lastName} ${d.member.firstName}さんの目標設定を待っています。`;
    case "self":
      return `${d.member.lastName} ${d.member.firstName}さんの自己評価を待っています。`;
    case "first":
      return `一次評価者（${name(d.firstEvaluator)}）の評価を待っています。`;
    case "second":
      return `二次評価者（${name(d.secondEvaluator)}）の評価を待っています。`;
    case "final":
      return "人事による最終確定を待っています。";
    default:
      return "";
  }
}

const YOUR_TURN: Record<NonNullable<Detail["editable"]>, string> = {
  goal: "今期の目標を設定し、ウェイトの合計を100にして提出してください。",
  self: "目標と行動評価の各項目に、自己評価の点数とコメントを入力して提出してください。",
  first: "一次評価を入力してください。本人の自己評価を参考にできます。",
  second: "二次評価を入力してください。一次評価までの内容を参考にできます。",
  final: "最終評価を入力して確定してください。確定すると本人も結果を確認できます。",
};

function SheetView({ detail: d }: { detail: Detail }) {
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const editable = d.editable;
  const phase: EvalPhase | null = editable && editable !== "goal" ? editable : null;
  const template = d.template;
  const isSelf = me.user.memberId === d.member.id;

  // ───────── 目標の下書き ─────────
  const [goals, setGoals] = useState<GoalDraft[]>(() =>
    d.goals.map((g) => ({ key: newKey(), title: g.title, description: g.description, weight: g.weight })),
  );
  // ───────── 点数の下書き ─────────
  const rows: Row[] = useMemo(
    () => [
      ...d.goals.map((g) => ({
        key: `goal:${g.id}`,
        kind: "goal" as const,
        title: g.title,
        description: g.description,
        weight: g.weight,
      })),
      ...template.items.map((i) => ({
        key: `item:${i.id}`,
        kind: "item" as const,
        title: i.title,
        description: i.description,
        weight: i.weight,
      })),
    ],
    [d.goals, template.items],
  );
  const [scores, setScores] = useState<Record<string, EvaluationScoreEntry>>(() => {
    const src = (phase && d.scores[phase]) || {};
    return Object.fromEntries(rows.map((r) => [r.key, src[r.key] ?? { score: null, comment: "" }]));
  });
  const [phaseComment, setPhaseComment] = useState(() => (phase ? (d.phaseComments[phase] ?? "") : ""));
  const [dirty, setDirty] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [goalErrors, setGoalErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remanding, setRemanding] = useState(false);

  const setCell = (key: string, patch: Partial<EvaluationScoreEntry>) => {
    setScores((s) => ({ ...s, [key]: { ...(s[key] ?? { score: null, comment: "" }), ...patch } }));
    setDirty(true);
  };
  const updateGoals = (fn: (g: GoalDraft[]) => GoalDraft[]) => {
    setGoals(fn);
    setDirty(true);
  };

  // 未保存のまま離れるときは確認する
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload((e) => {
    if (dirty) e.preventDefault();
  });
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || asking.current) return;
    asking.current = true;
    confirm({
      title: "保存していない変更があります",
      message: "このまま移動すると、入力した内容は失われます。",
      confirmLabel: "保存せずに移動",
      danger: true,
    }).then((ok) => {
      asking.current = false;
      if (ok) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, confirm]);

  const goalWeightError =
    template.goalWeight > 0 ? validateGoalWeights(goals.map((g) => g.weight || 0)) : null;
  const goalTitleMissing = goals.some((g) => !g.title.trim());

  const applyDetail = (next: Detail) => {
    queryClient.setQueryData(evalKeys.sheet(d.id), next);
  };

  const saveGoals = () =>
    put<Detail>(`/evaluations/sheets/${d.id}/goals`, {
      goals: goals.map((g) => ({
        title: g.title.trim(),
        description: g.description.trim(),
        weight: Math.round(g.weight || 0),
      })),
    });
  const saveScores = () =>
    put<Detail>(`/evaluations/sheets/${d.id}/scores`, { phase, scores, comment: phaseComment });

  const save = useMutation({
    mutationFn: async () => {
      if (editable === "goal") {
        if (goalTitleMissing) {
          setGoalErrors(true);
          throw new Error("目標のタイトルを入力してください");
        }
        return saveGoals();
      }
      return saveScores();
    },
    onSuccess: (next) => {
      setDirty(false);
      if (editable === "goal") {
        // 目標は保存のたびに作り直されるため、新しい ID で読み直す
        applyDetail(next);
        invalidateEvaluationLists();
      } else {
        applyDetail(next);
      }
      toast("一時保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const missingKeys = phase ? rows.filter((r) => scores[r.key]?.score == null).map((r) => r.key) : [];

  const submit = useMutation({
    mutationFn: async (comment: string) => {
      if (editable === "goal") {
        if (template.goalWeight > 0 || goals.length > 0) await saveGoals();
      } else if (dirty) {
        await saveScores();
      }
      return post<Detail>(`/evaluations/sheets/${d.id}/submit`, { comment });
    },
    onSuccess: (next) => {
      setDirty(false);
      setSubmitting(false);
      applyDetail(next);
      invalidateEvaluationLists(d.member.id);
      toast(editable === "final" ? "評価を確定しました" : "提出しました");
      window.scrollTo({ top: 0 });
    },
    onError: (e) => {
      setSubmitting(false);
      queryClient.invalidateQueries({ queryKey: evalKeys.sheet(d.id) });
      toast(errorMessage(e), "error");
    },
  });

  const remand = useMutation({
    mutationFn: (comment: string) => post<Detail>(`/evaluations/sheets/${d.id}/remand`, { comment }),
    onSuccess: (next) => {
      setDirty(false);
      setRemanding(false);
      applyDetail(next);
      invalidateEvaluationLists(d.member.id);
      toast("差し戻しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const reopen = useMutation({
    mutationFn: () => post<Detail>(`/evaluations/sheets/${d.id}/reopen`),
    onSuccess: (next) => {
      applyDetail(next);
      invalidateEvaluationLists(d.member.id);
      toast("確定を取り消しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const startSubmit = () => {
    if (editable === "goal") {
      if (goalTitleMissing) {
        setGoalErrors(true);
        toast("目標のタイトルを入力してください", "error");
        return;
      }
      if (goalWeightError) {
        toast(goalWeightError, "error");
        return;
      }
    } else if (missingKeys.length > 0) {
      setShowMissing(true);
      toast(`未入力の評価が${missingKeys.length}件あります。すべての項目に点数をつけてください`, "error");
      document.getElementById(`cell-${missingKeys[0]}`)?.scrollIntoView({ block: "center" });
      return;
    }
    setSubmitting(true);
  };

  // 表に出すフェーズ（到達済み・入力中・データありのもの）
  const stepIndex = stepsOf(true).indexOf(d.step);
  const phases = PHASE_ORDER.filter((p) => {
    if (!d.visiblePhases.includes(p)) return false;
    if (p === editable) return true;
    if (p === "second" && !d.useSecondStep && !d.scores.second) return false;
    const hasData = !!d.scores[p] && Object.keys(d.scores[p]!).length > 0;
    return hasData || stepsOf(true).indexOf(p) < stepIndex;
  });

  const lastEvent = d.events[0];
  const remandNotice =
    lastEvent && lastEvent.action === "remand" && lastEvent.toStep === d.step ? lastEvent : null;
  const next = nextStep(d.step, d.useSecondStep);
  const prev = previousStep(d.step, d.useSecondStep);
  const showGoalsEditor = editable === "goal" && template.goalWeight > 0;
  // 評価表が出ないとき（目標設定中、または評価者がまだ入力前の段階）は目標だけを表示する
  const showGoalsView = editable !== "goal" && template.goalWeight > 0 && phases.length === 0;
  const hasActions = !!editable || d.canRemand;

  return (
    <div className={cx(hasActions && "pb-4")}>
      <Breadcrumb current={`${d.periodName} ${d.member.lastName} ${d.member.firstName}`} />

      {/* ヘッダー */}
      <section className="mb-5 rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-5">
          <div className="flex w-full min-w-0 items-center gap-4 md:w-auto md:flex-1">
            <Face member={d.member} size={64} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>{d.periodName}</span>
                <PeriodStatusBadge status={d.periodStatus} />
              </p>
              <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-[22px] leading-tight font-bold">
                <Link to={`/members/${d.member.id}`} className="hover:text-ai-700">
                  {d.member.lastName} {d.member.firstName}
                </Link>
                <StatusBadge status={d.member.status} />
                {isSelf && <Badge tone="ai">あなた</Badge>}
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-2">
                {d.member.departmentName ?? "所属なし"}
                {d.member.jobTitleName && <span className="ml-2">{d.member.jobTitleName}</span>}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">{template.name}</p>
            </div>
          </div>
          <dl className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-8 md:w-auto">
            <div className="min-w-0">
              <dt className="mb-1 text-xs text-ink-3">一次評価者</dt>
              <dd>
                {d.firstEvaluator ? (
                  <MemberChip member={d.firstEvaluator} size={32} />
                ) : (
                  <span className="text-sm text-ink-3">未設定（人事が評価）</span>
                )}
              </dd>
            </div>
            {d.useSecondStep && (
              <div className="min-w-0">
                <dt className="mb-1 text-xs text-ink-3">二次評価者</dt>
                <dd>
                  {d.secondEvaluator ? (
                    <MemberChip member={d.secondEvaluator} size={32} />
                  ) : (
                    <span className="text-sm text-ink-3">未設定（人事が評価）</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="overflow-x-auto border-t border-line-2 px-5 py-3">
          <StepProgress step={d.step} useSecond={d.useSecondStep} />
        </div>
        <div
          className={cx(
            "flex flex-wrap items-center gap-3 border-t px-5 py-3 text-sm",
            editable ? "border-yamabuki/60 bg-yamabuki-50" : "border-line-2 bg-canvas/50 text-ink-2",
          )}
        >
          {editable ? (
            <p className="min-w-0 flex-1">
              <span className="mr-2 font-bold text-ink">あなたの{EVAL_STEP_LABELS[d.step]}の番です。</span>
              {YOUR_TURN[editable]}
            </p>
          ) : (
            <p className="min-w-0 flex-1">{waitingText(d)}</p>
          )}
          {d.canReopen && (
            <Button
              size="sm"
              icon={<RotateCcw className="size-4" />}
              loading={reopen.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: "確定を取り消しますか？",
                    message:
                      "総合点とランクが取り消され、最終確定のステップに戻ります。入力済みの点数はそのまま残ります。",
                    confirmLabel: "確定を取り消す",
                    danger: true,
                  })
                )
                  reopen.mutate();
              }}
            >
              確定を取り消す
            </Button>
          )}
        </div>
      </section>

      {remandNotice && (
        <div className="mb-5 flex gap-3 rounded-lg border border-beni/30 bg-beni-100 px-4 py-3 text-sm">
          <CornerUpLeft className="mt-0.5 size-4 shrink-0 text-beni" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold text-beni">
              {EVAL_STEP_LABELS[remandNotice.fromStep]}から差し戻されました
              <span className="ml-2 text-xs font-normal text-ink-3">
                {remandNotice.userName && `${remandNotice.userName} `}
                {formatDateTimeJa(remandNotice.createdAt)}
              </span>
            </p>
            {remandNotice.comment && (
              <p className="mt-1 whitespace-pre-wrap text-ink">{remandNotice.comment}</p>
            )}
          </div>
        </div>
      )}

      {d.step === "done" && d.finalScore !== null && (
        <section className="mb-5 flex flex-wrap items-center gap-x-10 gap-y-3 rounded-lg border border-wakaba/40 bg-white px-5 py-4">
          <div>
            <p className="text-xs text-ink-3">最終の総合点</p>
            <p className="tabular text-[36px] leading-tight font-bold">
              {formatScore(d.finalScore)}
              <span className="ml-1 text-sm font-normal text-ink-3">/ {template.scaleMax}</span>
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-3">ランク</p>
            <RankBadge rank={d.finalRank} large />
          </div>
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            目標 {template.goalWeight}% と行動 {template.competencyWeight}% の配分で算出しています。
          </p>
        </section>
      )}

      {showGoalsEditor && (
        <GoalsEditor
          goals={goals}
          onChange={updateGoals}
          showErrors={goalErrors}
          weightError={goalWeightError}
        />
      )}
      {editable === "goal" && template.goalWeight === 0 && (
        <Panel title="目標" className="mb-5">
          <p className="text-sm text-ink-2">
            このテンプレートには目標の設定がありません。提出すると自己評価に進みます。
          </p>
        </Panel>
      )}
      {showGoalsView && <GoalsView goals={d.goals} />}

      {phases.length > 0 && (
        <ScoreTable
          detail={d}
          rows={rows}
          phases={phases}
          editPhase={phase}
          draft={scores}
          onCell={setCell}
          phaseComment={phaseComment}
          onPhaseComment={(v) => {
            setPhaseComment(v);
            setDirty(true);
          }}
          showMissing={showMissing}
          onCopy={(from) => {
            const src = d.scores[from] ?? {};
            setScores(
              Object.fromEntries(
                rows.map((r) => [r.key, src[r.key] ? { ...src[r.key]! } : { score: null, comment: "" }]),
              ),
            );
            setDirty(true);
            toast(`${PHASE_LABELS[from]}の点数とコメントを写しました`);
          }}
        />
      )}

      <EventHistory events={d.events} />

      {hasActions && (
        <div className="sticky bottom-0 z-30 -mx-4 mt-5 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="flex w-full items-center gap-2 text-[13px] text-ink-2 sm:mr-auto sm:w-auto"
              aria-live="polite"
            >
              {editable && (
                <>
                  <span
                    className={cx("size-2 rounded-full", dirty ? "bg-yamabuki" : "bg-wakaba")}
                    aria-hidden
                  />
                  {dirty ? "保存していない変更があります" : "保存済みです"}
                  {phase && missingKeys.length > 0 && (
                    <span className="tabular text-ink-3">（未入力 {missingKeys.length}件）</span>
                  )}
                </>
              )}
            </p>
            {d.canRemand && prev && (
              <Button
                variant="danger"
                className="flex-1 sm:flex-none"
                icon={<CornerUpLeft className="size-4" />}
                onClick={() => setRemanding(true)}
              >
                差し戻す
              </Button>
            )}
            {editable && (
              <>
                <Button
                  className="flex-1 sm:flex-none"
                  loading={save.isPending}
                  disabled={!dirty || submit.isPending}
                  onClick={() => save.mutate()}
                >
                  一時保存
                </Button>
                <Button
                  variant="primary"
                  className="flex-1 sm:flex-none"
                  icon={<Send className="size-4" />}
                  loading={submit.isPending}
                  onClick={startSubmit}
                >
                  {editable === "final" ? "確定する" : "提出する"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <SubmitDialog
        open={submitting}
        onClose={() => setSubmitting(false)}
        loading={submit.isPending}
        isFinal={editable === "final"}
        title={editable === "final" ? "評価を確定しますか？" : `${EVAL_STEP_LABELS[d.step]}を提出しますか？`}
        message={
          editable === "final"
            ? "確定すると評価が完了し、本人も総合点とランクを確認できるようになります。"
            : `提出すると「${EVAL_STEP_LABELS[next]}」に進み、あなたはこのステップの内容を編集できなくなります。`
        }
        onSubmit={(comment) => submit.mutate(comment)}
      />
      <RemandDialog
        open={remanding}
        onClose={() => setRemanding(false)}
        loading={remand.isPending}
        to={prev ? EVAL_STEP_LABELS[prev] : ""}
        onSubmit={(comment) => remand.mutate(comment)}
      />
    </div>
  );
}

// ───────── 目標の編集 ─────────
function GoalsEditor({
  goals,
  onChange,
  showErrors,
  weightError,
}: {
  goals: GoalDraft[];
  onChange: (fn: (g: GoalDraft[]) => GoalDraft[]) => void;
  showErrors: boolean;
  weightError: string | null;
}) {
  const sum = goals.reduce((s, g) => s + (g.weight || 0), 0);
  const move = (i: number, dir: -1 | 1) =>
    onChange((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(i + dir, 0, x!);
      return next;
    });
  const set = (key: string, patch: Partial<GoalDraft>) =>
    onChange((list) => list.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  return (
    <Panel
      title="目標"
      description="今期取り組む目標と、その重み（ウェイト）を設定します。ウェイトの合計は100にします。"
      className="mb-5"
      actions={
        <span
          className={cx(
            "tabular rounded-md px-2 py-1 text-[13px] font-bold whitespace-nowrap",
            sum === 100 ? "bg-wakaba-100 text-wakaba" : "bg-yamabuki-100 text-[#7a5408]",
          )}
          aria-live="polite"
        >
          合計 {sum} / 100
        </span>
      }
      bodyClassName="p-0"
    >
      {goals.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-2">目標を追加して、今期取り組むことを書きましょう。</p>
      ) : (
        <ol className="divide-y divide-line-2">
          {goals.map((g, i) => (
            <li key={g.key} className="flex gap-3 px-4 py-4">
              <span className="tabular mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ai-100 text-xs font-bold text-ai-800">
                {i + 1}
              </span>
              <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
                <Field
                  label="目標"
                  htmlFor={`goal-title-${g.key}`}
                  required
                  error={showErrors && !g.title.trim() ? "目標を入力してください" : null}
                >
                  <Input
                    id={`goal-title-${g.key}`}
                    value={g.title}
                    maxLength={200}
                    aria-invalid={showErrors && !g.title.trim() ? true : undefined}
                    placeholder="例：主要機能を期日までにリリースする"
                    onChange={(e) => set(g.key, { title: e.target.value })}
                  />
                </Field>
                <Field label="ウェイト" htmlFor={`goal-weight-${g.key}`}>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`goal-weight-${g.key}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={5}
                      className="tabular text-right"
                      value={Number.isNaN(g.weight) ? "" : g.weight}
                      onChange={(e) =>
                        set(g.key, {
                          weight:
                            e.target.value === "" ? 0 : Math.max(0, Math.min(100, Number(e.target.value))),
                        })
                      }
                    />
                    <span className="text-sm text-ink-3">%</span>
                  </div>
                </Field>
                <Field label="達成の基準・進め方" htmlFor={`goal-desc-${g.key}`} className="md:col-span-2">
                  <Textarea
                    id={`goal-desc-${g.key}`}
                    rows={2}
                    maxLength={2000}
                    value={g.description}
                    placeholder="何をもって達成とするか、どう進めるか"
                    onChange={(e) => set(g.key, { description: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex shrink-0 flex-col gap-0.5 pt-5">
                <IconButton label="上へ移動" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="下へ移動" disabled={i === goals.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton
                  label="目標を削除"
                  className="hover:bg-beni-100 hover:text-beni"
                  onClick={() => onChange((list) => list.filter((x) => x.key !== g.key))}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-2 px-4 py-3">
        <Button
          size="sm"
          icon={<Plus className="size-4" />}
          disabled={goals.length >= 10}
          onClick={() =>
            onChange((list) => [
              ...list,
              { key: newKey(), title: "", description: "", weight: Math.max(0, 100 - sum) },
            ])
          }
        >
          目標を追加
        </Button>
        <p className={cx("text-xs", weightError ? "text-[#7a5408]" : "text-wakaba")}>
          {weightError ?? "ウェイトの合計が100になっています"}
        </p>
        {goals.length >= 10 && <p className="text-xs text-ink-3">目標は10件まで登録できます</p>}
      </div>
    </Panel>
  );
}

function GoalsView({ goals }: { goals: Detail["goals"] }) {
  return (
    <Panel title="目標" className="mb-5" bodyClassName="p-0">
      {goals.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">まだ目標が登録されていません。</p>
      ) : (
        <ol className="divide-y divide-line-2">
          {goals.map((g, i) => (
            <li key={g.id} className="flex gap-3 px-4 py-3">
              <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ai-100 text-xs font-bold text-ai-800">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{g.title}</p>
                {g.description && (
                  <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-2">{g.description}</p>
                )}
              </div>
              <span className="tabular shrink-0 text-sm font-bold text-ink-2">{g.weight}%</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ───────── 評価表 ─────────
function ScorePicker({
  value,
  max,
  onChange,
  label,
  invalid,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  invalid?: boolean;
}) {
  const name = useId();
  if (max > 6) {
    return (
      <Select
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="tabular h-8 w-24"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">未入力</option>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <fieldset
      aria-invalid={invalid || undefined}
      className={cx(
        "inline-flex rounded-md border bg-white p-0.5",
        invalid ? "border-beni ring-2 ring-beni-100" : "border-line",
      )}
    >
      <legend className="sr-only">{label}</legend>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <label
          key={n}
          className={cx(
            "tabular relative flex size-7 cursor-pointer items-center justify-center rounded text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ai-500",
            value === n ? "bg-ai-700 font-bold text-white" : "text-ink-2 hover:bg-ai-50",
          )}
        >
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="sr-only"
            aria-label={`${n}点`}
          />
          {n}
        </label>
      ))}
    </fieldset>
  );
}

function ScoreTable({
  detail: d,
  rows,
  phases,
  editPhase,
  draft,
  onCell,
  phaseComment,
  onPhaseComment,
  showMissing,
  onCopy,
}: {
  detail: Detail;
  rows: Row[];
  phases: EvalPhase[];
  editPhase: EvalPhase | null;
  draft: Record<string, EvaluationScoreEntry>;
  onCell: (key: string, patch: Partial<EvaluationScoreEntry>) => void;
  phaseComment: string;
  onPhaseComment: (v: string) => void;
  showMissing: boolean;
  onCopy: (from: EvalPhase) => void;
}) {
  const t = d.template;
  const entriesOf = (p: EvalPhase) => (p === editPhase ? draft : (d.scores[p] ?? {}));
  const goalRows = rows.filter((r) => r.kind === "goal");
  const itemRows = rows.filter((r) => r.kind === "item");
  const showItemWeight = itemRows.some((r) => r.weight !== 1);
  const editIndex = editPhase ? phases.indexOf(editPhase) : -1;
  const copyFrom = editIndex > 0 ? phases[editIndex - 1] : undefined;
  const canCopy =
    !!copyFrom && !!d.scores[copyFrom] && Object.values(d.scores[copyFrom]!).some((e) => e.score !== null);

  const totalOf = (p: EvalPhase) => {
    if (p !== editPhase && p === "final" && d.step === "done" && d.finalScore !== null) return d.finalScore;
    if (p !== editPhase) return d.phaseTotals[p] ?? null;
    return totalScore({
      goals: goalRows.map((r) => ({ weight: r.weight, score: draft[r.key]?.score ?? null })),
      items: itemRows.map((r) => ({ weight: r.weight, score: draft[r.key]?.score ?? null })),
      goalWeight: t.goalWeight,
      competencyWeight: t.competencyWeight,
    });
  };
  const sectionAvg = (p: EvalPhase, list: Row[]) => {
    const e = entriesOf(p);
    const v = weightedAverage(list.map((r) => ({ weight: r.weight, score: e[r.key]?.score ?? null })));
    return v === null ? null : Math.round(v * 100) / 100;
  };

  const colWidth = (p: EvalPhase) =>
    p === editPhase ? "min-w-[216px] sm:min-w-[260px]" : "min-w-[140px] sm:min-w-[160px]";
  const headCell = "sticky left-0 z-10 bg-white";

  const section = (label: string, weight: number, list: Row[]) => (
    <>
      <tr className="border-t border-line bg-canvas/70">
        <th
          scope="rowgroup"
          className={cx(headCell, "bg-canvas px-3 py-2 text-left text-[13px] font-bold sm:px-4")}
        >
          {label}
          <span className="tabular ml-2 text-xs font-normal text-ink-3">配分 {weight}%</span>
        </th>
        {phases.map((p) => (
          <td key={p} className="tabular px-3 py-2 text-xs text-ink-3">
            平均 <span className="font-bold text-ink-2">{formatScore(sectionAvg(p, list))}</span>
          </td>
        ))}
      </tr>
      {list.map((r) => (
        <tr key={r.key} className="border-t border-line-2 align-top">
          <th
            scope="row"
            className={cx(
              headCell,
              "w-[240px] min-w-[136px] px-3 py-3 text-left font-normal sm:min-w-[180px] sm:px-4",
            )}
          >
            <span className="block text-sm font-bold">{r.title}</span>
            {r.description && (
              <span className="mt-0.5 block text-xs leading-relaxed whitespace-pre-wrap text-ink-3">
                {r.description}
              </span>
            )}
            {r.kind === "goal" ? (
              <span className="tabular mt-1 inline-block text-xs text-ink-2">ウェイト {r.weight}%</span>
            ) : (
              showItemWeight && (
                <span className="tabular mt-1 inline-block text-xs text-ink-2">重み {r.weight}</span>
              )
            )}
          </th>
          {phases.map((p) => {
            const e = entriesOf(p)[r.key];
            if (p === editPhase) {
              const missing = showMissing && (e?.score ?? null) === null;
              return (
                <td key={p} id={`cell-${r.key}`} className="bg-yamabuki-50/60 px-3 py-3">
                  <ScorePicker
                    label={`${r.title}の${PHASE_LABELS[p]}`}
                    max={t.scaleMax}
                    value={e?.score ?? null}
                    invalid={missing}
                    onChange={(v) => onCell(r.key, { score: v })}
                  />
                  {missing && <p className="mt-1 text-xs text-beni">点数を選んでください</p>}
                  <Textarea
                    aria-label={`${r.title}の${PHASE_LABELS[p]}コメント`}
                    rows={2}
                    maxLength={2000}
                    placeholder="コメント（任意）"
                    className="mt-2 text-[13px]"
                    value={e?.comment ?? ""}
                    onChange={(ev) => onCell(r.key, { comment: ev.target.value })}
                  />
                </td>
              );
            }
            return (
              <td key={p} className="px-3 py-3">
                <span className="tabular text-lg leading-none font-bold">
                  {e?.score ?? <span className="text-sm font-normal text-ink-3">—</span>}
                </span>
                {e?.comment && (
                  <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-ink-2">{e.comment}</p>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );

  return (
    <Panel
      title="評価"
      description={`各項目を1〜${t.scaleMax}の${t.scaleMax}段階で評価します。総合点は目標と行動を配分で合成した点数です。`}
      className="mb-5"
      bodyClassName="p-0"
    >
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className={cx(headCell, "px-3 py-2.5 text-xs font-normal text-ink-3 sm:px-4")}>
                項目
              </th>
              {phases.map((p) => (
                <th
                  key={p}
                  scope="col"
                  className={cx(
                    "px-3 py-2.5 align-bottom text-[13px] font-bold",
                    colWidth(p),
                    p === editPhase && "bg-yamabuki-50",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {PHASE_LABELS[p]}
                    {p === editPhase && <Badge tone="yamabuki">入力中</Badge>}
                  </span>
                  {p === editPhase && canCopy && copyFrom && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 -ml-2"
                      icon={<ClipboardCopy className="size-3.5" />}
                      onClick={() => onCopy(copyFrom)}
                    >
                      {PHASE_LABELS[copyFrom]}の点数を写す
                    </Button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {goalRows.length > 0 && section("目標", t.goalWeight, goalRows)}
            {itemRows.length > 0 && section("行動評価", t.competencyWeight, itemRows)}
            <tr className="border-t-2 border-line align-top">
              <th scope="row" className={cx(headCell, "px-3 py-3 text-left text-[13px] font-bold sm:px-4")}>
                総評
              </th>
              {phases.map((p) =>
                p === editPhase ? (
                  <td key={p} className="bg-yamabuki-50/60 px-3 py-3">
                    <Textarea
                      aria-label={`${PHASE_LABELS[p]}の総評`}
                      rows={3}
                      maxLength={4000}
                      placeholder="期間全体を振り返ってのコメント"
                      className="text-[13px]"
                      value={phaseComment}
                      onChange={(e) => onPhaseComment(e.target.value)}
                    />
                  </td>
                ) : (
                  <td key={p} className="px-3 py-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
                    {d.phaseComments[p] || <span className="text-ink-3">—</span>}
                  </td>
                ),
              )}
            </tr>
            <tr className="border-t border-line bg-ai-50/60 align-top">
              <th
                scope="row"
                className={cx(headCell, "bg-ai-50 px-3 py-3 text-left text-[13px] font-bold sm:px-4")}
              >
                総合点
                <span className="block text-xs font-normal text-ink-3">想定ランク</span>
              </th>
              {phases.map((p) => {
                const total = totalOf(p);
                const rank =
                  p === "final" && d.step === "done" && p !== editPhase
                    ? (d.finalRank ?? rankFor(total, t.rankRules))
                    : rankFor(total, t.rankRules);
                return (
                  <td key={p} className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <span className="tabular text-xl leading-none font-bold">{formatScore(total)}</span>
                      <RankBadge rank={rank} />
                    </span>
                    {p === editPhase && (
                      <span className="mt-1 block text-[11px] text-ink-3">入力内容から計算しています</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <RankRules rules={t.rankRules} />
    </Panel>
  );
}

function RankRules({ rules }: { rules: Detail["template"]["rankRules"] }) {
  const sorted = [...rules].sort((a, b) => b.min - a.min);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-2 px-4 py-2.5 text-xs text-ink-3">
      <span>ランクの基準</span>
      {sorted.map((r) => (
        <span key={r.rank} className="tabular flex items-center gap-1">
          <RankBadge rank={r.rank} />
          {r.min > 0 ? `${r.min}点以上` : "それ未満"}
        </span>
      ))}
    </div>
  );
}

// ───────── 履歴 ─────────
const EVENT_ICON: Record<Detail["events"][number]["action"], ReactNode> = {
  submit: <Send className="size-3.5" />,
  remand: <CornerUpLeft className="size-3.5" />,
  reopen: <RotateCcw className="size-3.5" />,
};

function eventText(e: Detail["events"][number]): string {
  if (e.action === "submit") {
    return e.fromStep === "final" ? "最終評価を確定" : `${EVAL_STEP_LABELS[e.fromStep]}を提出`;
  }
  if (e.action === "remand")
    return `${EVAL_STEP_LABELS[e.fromStep]}から${EVAL_STEP_LABELS[e.toStep]}へ差し戻し`;
  return "確定を取り消し";
}

function EventHistory({ events }: { events: Detail["events"] }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <History className="size-4 text-ink-3" aria-hidden />
          履歴
        </span>
      }
      bodyClassName="px-4 py-3"
    >
      {events.length === 0 ? (
        <p className="py-2 text-sm text-ink-3">まだ提出の記録はありません。</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-line">
          {events.map((e) => (
            <li key={e.id} className="relative flex gap-3">
              <span
                className={cx(
                  "z-[1] flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white",
                  e.action === "remand"
                    ? "bg-beni-100 text-beni"
                    : e.action === "reopen"
                      ? "bg-yamabuki-100 text-[#7a5408]"
                      : "bg-ai-100 text-ai-700",
                )}
                aria-hidden
              >
                {EVENT_ICON[e.action]}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm">
                  <span className="font-bold">{eventText(e)}</span>
                  {e.userName && <span className="ml-2 text-ink-2">{e.userName}</span>}
                </p>
                <p className="tabular text-xs text-ink-3">{formatDateTimeJa(e.createdAt)}</p>
                {e.comment && (
                  <p className="mt-1.5 rounded-md bg-canvas px-3 py-2 text-[13px] whitespace-pre-wrap text-ink-2">
                    {e.comment}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ───────── ダイアログ ─────────
function SubmitDialog({
  open,
  onClose,
  loading,
  title,
  message,
  isFinal,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  title: string;
  message: string;
  isFinal: boolean;
  onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={loading} onClick={() => onSubmit(comment.trim())}>
            {isFinal ? "確定する" : "提出する"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-ink-2">{message}</p>
      <Field label="ひとこと（任意）" htmlFor="submit-comment" help="履歴に残り、関係者が確認できます">
        <Textarea
          id="submit-comment"
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

function RemandDialog({
  open,
  onClose,
  loading,
  to,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  to: string;
  onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const empty = !comment.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="差し戻しますか？"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (!empty) onSubmit(comment.trim());
            }}
          >
            差し戻す
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-ink-2">
        「{to}」のステップに戻します。理由は履歴に残り、相手に表示されます。
      </p>
      <Field
        label="差し戻しの理由"
        htmlFor="remand-comment"
        required
        error={touched && empty ? "差し戻しの理由を入力してください" : null}
      >
        <Textarea
          id="remand-comment"
          rows={4}
          maxLength={1000}
          aria-invalid={touched && empty ? true : undefined}
          placeholder="例：目標2の振り返りを具体的に書いてください"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
