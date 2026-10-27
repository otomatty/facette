import { useQuery } from "@tanstack/react-query";
import { Info, ShieldCheck } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { SURVEY_STATUS_LABELS, type SurveyQuestionType } from "../../../shared/constants";
import { formatDateJa, todayJst } from "../../../shared/dates";
import type { Survey, SurveyQuestion } from "../../../shared/types";
import { Badge, Button, cx, Textarea, useConfirm } from "../../components/ui";
import { get } from "../../lib/api";

export function useSurvey(id: number, enabled = true) {
  return useQuery({
    queryKey: ["survey", id],
    queryFn: () => get<Survey>(`/surveys/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/**
 * 入力途中でページを離れようとしたら確認する。
 * 保存・送信の直後に遷移するときは 返り値の関数を呼んでから navigate する。
 */
export function useLeaveGuard(when: boolean, message: string) {
  const confirm = useConfirm();
  const allowRef = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && !allowRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const blocked = blocker.state === "blocked";
  useEffect(() => {
    if (!blocked) return;
    confirm({ title: "このページを離れますか？", message, confirmLabel: "離れる", danger: true }).then(
      (ok) => {
        const b = blockerRef.current;
        if (b.state !== "blocked") return;
        if (ok) b.proceed();
        else b.reset();
      },
    );
  }, [blocked, confirm, message]);
  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);
  return useCallback(() => {
    allowRef.current = true;
  }, []);
}

export const SURVEY_KIND_LABELS: Record<Survey["kind"], string> = {
  survey: "アンケート",
  pulse: "パルスサーベイ",
};

export type AnswerValue = string | string[] | number | null;
export type PreviewQuestion = Pick<SurveyQuestion, "type" | "text" | "options" | "required">;

export const isChoice = (t: SurveyQuestionType) => t === "single" || t === "multi";

export function isAnswered(v: AnswerValue | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** パルスサーベイのひな形（やりがい・上司とのコミュニケーション・コンディション・推奨度・自由記述） */
export const PULSE_TEMPLATE: PreviewQuestion[] = [
  { type: "scale", text: "今の仕事にやりがいを感じていますか", options: [], required: true },
  { type: "scale", text: "上司と十分にコミュニケーションが取れていますか", options: [], required: true },
  { type: "scale", text: "心身ともに良いコンディションで働けていますか", options: [], required: true },
  { type: "nps", text: "この職場を親しい友人や知人に勧めたいと思いますか", options: [], required: true },
  {
    type: "text",
    text: "最近の困りごとや、会社に伝えたいことがあれば教えてください",
    options: [],
    required: false,
  },
];

// ───────── 日付・数値 ─────────

/** DB の UTC 日時 "YYYY-MM-DD HH:MM:SS" を日本時間の日付 "YYYY-MM-DD" にする */
export function jstDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  return todayJst(d);
}

export function daysUntil(date: string, today = todayJst()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** 回答率（%、小数第1位まで） */
export function rate(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

export function DeadlineText({ survey, className }: { survey: Survey; className?: string }) {
  if (!survey.closesAt) return <span className={cx("text-ink-3", className)}>締切なし</span>;
  const d = daysUntil(survey.closesAt);
  return (
    <span className={className}>
      <span className="tabular">{formatDateJa(survey.closesAt)}</span>
      {survey.status === "open" && (
        <span
          className={cx(
            "ml-1 text-xs whitespace-nowrap",
            d < 0 ? "font-bold text-beni" : d <= 3 ? "font-bold text-ink" : "text-ink-3",
          )}
        >
          （{d < 0 ? "締切日を過ぎています" : d === 0 ? "本日締切" : `あと${d}日`}）
        </span>
      )}
    </span>
  );
}

// ───────── バッジ ─────────

export function SurveyStatusBadge({ status }: { status: Survey["status"] }) {
  const tone = status === "open" ? "wakaba" : status === "draft" ? "yamabuki" : "neutral";
  return <Badge tone={tone}>{SURVEY_STATUS_LABELS[status]}</Badge>;
}

export function SurveyKindBadge({ kind }: { kind: Survey["kind"] }) {
  return <Badge tone={kind === "pulse" ? "fuji" : "ai"}>{SURVEY_KIND_LABELS[kind]}</Badge>;
}

export function AnonymousBadge({ anonymous }: { anonymous: boolean }) {
  return anonymous ? <Badge tone="ai">匿名</Badge> : <Badge>記名</Badge>;
}

// ───────── リンクのボタン ─────────

const LINK_VARIANTS = {
  primary: "bg-ai-700 text-white hover:bg-ai-800 active:bg-ai-900",
  secondary: "border border-line bg-white text-ink hover:border-ai-200 hover:bg-ai-50",
  ghost: "text-ink-2 hover:bg-ai-50 hover:text-ink",
} as const;

export function LinkButton({
  to,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
}: {
  to: string;
  variant?: keyof typeof LINK_VARIANTS;
  size?: "sm" | "md";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-bold whitespace-nowrap transition-colors",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        LINK_VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ───────── 匿名性の説明 ─────────

export function AnonymityNote({ anonymous, className }: { anonymous: boolean; className?: string }) {
  if (anonymous)
    return (
      <div
        className={cx(
          "flex items-start gap-2.5 rounded-md border border-ai-200 bg-ai-50 px-4 py-3 text-[13px] text-ai-900",
          className,
        )}
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ai-600" aria-hidden />
        <p>回答は匿名で集計され、個人が特定される形では共有されません。</p>
      </div>
    );
  return (
    <div
      className={cx(
        "flex items-start gap-2.5 rounded-md border border-line bg-white px-4 py-3 text-[13px] text-ink-2",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <p>記名式のアンケートです。回答は氏名とともに人事担当者に共有されます。</p>
    </div>
  );
}

// ───────── 回答の入力 ─────────

function ScalePicker({
  name,
  min,
  max,
  low,
  high,
  value,
  onChange,
  invalid,
}: {
  name: string;
  min: number;
  max: number;
  low: string;
  high: string;
  value: AnswerValue | undefined;
  onChange: (v: number) => void;
  invalid?: boolean;
}) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const many = values.length > 5;
  return (
    <div className={many ? "max-w-2xl" : "max-w-md"}>
      <div className={cx("grid", many ? "grid-cols-11 gap-1" : "grid-cols-5 gap-1.5 sm:gap-2")}>
        {values.map((n) => (
          <label key={n} className="relative block">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-invalid={invalid || undefined}
              aria-label={n === min ? `${n}（${low}）` : n === max ? `${n}（${high}）` : String(n)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cx(
                "tabular flex h-11 cursor-pointer items-center justify-center rounded-md border border-line bg-white font-bold text-ink-2 transition-colors select-none",
                "hover:border-ai-300 hover:bg-ai-50 peer-checked:border-ai-700 peer-checked:bg-ai-700 peer-checked:text-white",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ai-500",
                many ? "text-sm" : "text-base",
              )}
            >
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-xs text-ink-3" aria-hidden>
        <span>{low}</span>
        <span className="text-right">{high}</span>
      </div>
    </div>
  );
}

function OptionRow({
  type,
  name,
  label,
  checked,
  onChange,
  invalid,
}: {
  type: "radio" | "checkbox";
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
        checked ? "border-ai-500 bg-ai-50" : "border-line bg-white hover:border-ai-200 hover:bg-ai-50/50",
      )}
    >
      <input
        type={type}
        name={name}
        value={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="mt-[3px] size-4 shrink-0 accent-ai-700"
      />
      <span className={cx("min-w-0 break-words", checked && "font-bold")}>{label}</span>
    </label>
  );
}

export function AnswerControl({
  question,
  name,
  value,
  onChange,
  labelledBy,
  invalid,
}: {
  question: PreviewQuestion;
  name: string;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  labelledBy?: string;
  invalid?: boolean;
}) {
  switch (question.type) {
    case "single":
    case "multi": {
      const options = question.options.filter((o) => o.trim());
      if (!options.length) return <p className="text-xs text-ink-3">選択肢を入力すると表示されます</p>;
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="grid gap-2">
          {question.type === "multi" && (
            <p className="-mt-1 text-xs text-ink-3">当てはまるものをすべて選んでください</p>
          )}
          {options.map((o, i) =>
            question.type === "single" ? (
              <OptionRow
                key={`${i}-${o}`}
                type="radio"
                name={name}
                label={o}
                checked={value === o}
                onChange={() => onChange(o)}
                invalid={invalid}
              />
            ) : (
              <OptionRow
                key={`${i}-${o}`}
                type="checkbox"
                name={name}
                label={o}
                checked={selected.includes(o)}
                onChange={(on) => onChange(on ? [...selected, o] : selected.filter((x) => x !== o))}
                invalid={invalid}
              />
            ),
          )}
        </div>
      );
    }
    case "scale":
      return (
        <ScalePicker
          name={name}
          min={1}
          max={5}
          low="そう思わない"
          high="そう思う"
          value={value}
          onChange={onChange}
          invalid={invalid}
        />
      );
    case "nps":
      return (
        <ScalePicker
          name={name}
          min={0}
          max={10}
          low="まったく思わない"
          high="非常にそう思う"
          value={value}
          onChange={onChange}
          invalid={invalid}
        />
      );
    case "text": {
      const text = typeof value === "string" ? value : "";
      return (
        <div>
          <Textarea
            aria-labelledby={labelledBy}
            aria-invalid={invalid || undefined}
            value={text}
            maxLength={4000}
            rows={4}
            placeholder="自由にご記入ください"
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="tabular mt-1 text-right text-[11px] text-ink-3">{text.length} / 4000</p>
        </div>
      );
    }
  }
}

export function QuestionCard({
  id,
  index,
  question,
  name,
  value,
  onChange,
  error,
  compact,
}: {
  id?: string;
  index: number;
  question: PreviewQuestion;
  name: string;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  error?: string | null;
  compact?: boolean;
}) {
  const legendId = useId();
  return (
    <div
      id={id}
      className={cx(
        "scroll-mt-24 rounded-lg border bg-white",
        compact ? "p-3.5" : "p-4 sm:p-5",
        error ? "border-beni ring-2 ring-beni-100" : "border-line",
      )}
    >
      <fieldset className="min-w-0">
        <legend
          id={legendId}
          className={cx("mb-3 w-full leading-relaxed font-bold", compact ? "text-sm" : "text-[15px]")}
        >
          <span className="tabular mr-2 text-ai-700">Q{index + 1}</span>
          {question.text.trim() || <span className="font-normal text-ink-3">質問文が未入力です</span>}
          <span className="ml-2 inline-block align-[1px]">
            {question.required ? <Badge tone="beni">必須</Badge> : <Badge>任意</Badge>}
          </span>
        </legend>
        <AnswerControl
          question={question}
          name={name}
          value={value}
          onChange={onChange}
          labelledBy={legendId}
          invalid={!!error}
        />
        {error && (
          <p className="mt-2 text-xs font-bold text-beni" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    </div>
  );
}

/** 回答画面のプレビュー（入力は試せるが送信はしない） */
export function SurveyPreview({
  title,
  description,
  anonymous,
  questions,
}: {
  title: string;
  description: string;
  anonymous: boolean;
  questions: (PreviewQuestion & { key: string })[];
}) {
  const uid = useId();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg leading-snug font-bold break-words">
          {title.trim() || <span className="font-normal text-ink-3">タイトルが未入力です</span>}
        </h3>
        {description.trim() && (
          <p className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
            {description}
          </p>
        )}
      </div>
      <AnonymityNote anonymous={anonymous} />
      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-[13px] text-ink-3">
          質問を追加すると、ここに表示されます
        </p>
      ) : (
        questions.map((q, i) => (
          <QuestionCard
            key={q.key}
            compact
            index={i}
            question={q}
            name={`${uid}-${q.key}`}
            value={answers[q.key]}
            onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
          />
        ))
      )}
      <div className="flex justify-end">
        <Button variant="primary" disabled title="プレビューでは送信できません">
          送信する
        </Button>
      </div>
    </div>
  );
}
