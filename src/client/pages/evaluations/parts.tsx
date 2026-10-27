import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import {
  EVAL_PERIOD_STATUS_LABELS,
  EVAL_STEP_LABELS,
  EVAL_STEPS,
  type EvalPhase,
  type EvalStep,
} from "../../../shared/constants";
import { Badge, cx } from "../../components/ui";
import { queryClient } from "../../lib/queries";

type Tone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

export const PHASE_LABELS: Record<EvalPhase, string> = {
  self: "自己評価",
  first: "一次評価",
  second: "二次評価",
  final: "最終評価",
};

export const PHASE_ORDER: EvalPhase[] = ["self", "first", "second", "final"];

/** 評価期間で使うステップ（二次評価なしならスキップ） */
export function stepsOf(useSecond: boolean): EvalStep[] {
  return useSecond
    ? ["goal", "self", "first", "second", "final", "done"]
    : ["goal", "self", "first", "final", "done"];
}

export const evalKeys = {
  my: ["evaluations", "my"] as const,
  periods: ["evaluations", "periods"] as const,
  period: (id: number) => ["evaluations", "period", id] as const,
  templates: ["evaluations", "templates"] as const,
  template: (id: number) => ["evaluations", "template", id] as const,
  sheet: (id: number) => ["evaluations", "sheet", id] as const,
};

/** シートの状態が変わったときに一覧・ホームなどを更新する */
export function invalidateEvaluationLists(memberId?: number) {
  queryClient.invalidateQueries({ queryKey: evalKeys.my });
  queryClient.invalidateQueries({ queryKey: evalKeys.periods });
  queryClient.invalidateQueries({ queryKey: ["evaluations", "period"] });
  queryClient.invalidateQueries({ queryKey: ["home"] });
  if (memberId) queryClient.invalidateQueries({ queryKey: ["member", memberId, "evaluations"] });
}

const STEP_TONE: Record<EvalStep, Tone> = {
  goal: "neutral",
  self: "ai",
  first: "ai",
  second: "fuji",
  final: "yamabuki",
  done: "wakaba",
};

export function StepBadge({ step, className }: { step: EvalStep; className?: string }) {
  return (
    <Badge tone={STEP_TONE[step]} className={className}>
      {EVAL_STEP_LABELS[step]}
    </Badge>
  );
}

const PERIOD_TONE: Record<keyof typeof EVAL_PERIOD_STATUS_LABELS, Tone> = {
  draft: "yamabuki",
  active: "wakaba",
  closed: "neutral",
};

export function PeriodStatusBadge({ status }: { status: keyof typeof EVAL_PERIOD_STATUS_LABELS }) {
  return <Badge tone={PERIOD_TONE[status]}>{EVAL_PERIOD_STATUS_LABELS[status]}</Badge>;
}

const RANK_TONE: Record<string, Tone> = { S: "wakaba", A: "ai", B: "neutral", C: "yamabuki", D: "beni" };

export function RankBadge({ rank, large }: { rank: string | null; large?: boolean }) {
  if (!rank) return <span className="text-ink-3">—</span>;
  return (
    <Badge
      tone={RANK_TONE[rank] ?? "neutral"}
      className={large ? "h-10 min-w-10 justify-center px-3 text-[22px]" : undefined}
    >
      {rank}
    </Badge>
  );
}

const LINK_BUTTON = {
  primary: "bg-ai-700 text-white hover:bg-ai-800 active:bg-ai-900",
  secondary: "bg-white text-ink border border-line hover:bg-ai-50 hover:border-ai-200",
  accent: "bg-yamabuki text-ink hover:bg-yamabuki-600 hover:text-white",
};

/** ボタンの見た目をしたリンク */
export function LinkButton({
  to,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  to: string;
  variant?: keyof typeof LINK_BUTTON;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-bold whitespace-nowrap transition-colors",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        LINK_BUTTON[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(2);
}

/** ステップ別件数の積み上げバーの色（テーマのトークンのみ） */
const STEP_BAR: Record<EvalStep, string> = {
  goal: "bg-line",
  self: "bg-ai-200",
  first: "bg-ai-300",
  second: "bg-ai-500",
  final: "bg-yamabuki",
  done: "bg-wakaba",
};

export function StepBar({
  counts,
  useSecond,
  className,
}: {
  counts: Partial<Record<EvalStep, number>>;
  useSecond: boolean;
  className?: string;
}) {
  const steps = EVAL_STEPS.filter((s) => stepsOf(useSecond).includes(s) || (counts[s] ?? 0) > 0);
  const total = steps.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const label = steps.map((s) => `${EVAL_STEP_LABELS[s]} ${counts[s] ?? 0}件`).join("、");
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={cx("flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-line-2", className)}
    >
      {total > 0 &&
        steps.map((s) =>
          (counts[s] ?? 0) > 0 ? (
            <span key={s} className={STEP_BAR[s]} style={{ flexGrow: counts[s], flexBasis: 0 }} />
          ) : null,
        )}
    </div>
  );
}

export function StepBarLegend({ useSecond }: { useSecond: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
      {stepsOf(useSecond).map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span className={cx("size-2.5 rounded-sm", STEP_BAR[s])} />
          {EVAL_STEP_LABELS[s]}
        </li>
      ))}
    </ul>
  );
}

/** 目標設定から完了までの進行表示。現在地を強調する */
export function StepProgress({ step, useSecond }: { step: EvalStep; useSecond: boolean }) {
  const steps = stepsOf(useSecond);
  const current = steps.indexOf(step);
  return (
    <ol className="flex min-w-max items-center gap-1" aria-label="評価の進行状況">
      {steps.map((s, i) => {
        const done = i < current || step === "done";
        const active = i === current && step !== "done";
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span className={cx("h-px w-4 sm:w-6", done || active ? "bg-ai-500" : "bg-line")} />}
            <span
              aria-current={i === current ? "step" : undefined}
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] whitespace-nowrap",
                active
                  ? "border-yamabuki bg-yamabuki-50 font-bold text-ink"
                  : done
                    ? "border-ai-200 bg-ai-50 text-ai-800"
                    : "border-line bg-white text-ink-3",
              )}
            >
              <span
                className={cx(
                  "tabular flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
                  active ? "bg-yamabuki text-ink" : done ? "bg-ai-600 text-white" : "bg-line-2 text-ink-3",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {EVAL_STEP_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
