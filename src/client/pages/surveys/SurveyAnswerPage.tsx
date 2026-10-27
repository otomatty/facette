import { useMutation } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, Lock, MessageSquareText } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Survey } from "../../../shared/types";
import { Meter } from "../../components/charts";
import { Button, EmptyState, ErrorBox, Loading, useToast } from "../../components/ui";
import { ApiError, errorMessage, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import {
  AnonymityNote,
  type AnswerValue,
  DeadlineText,
  isAnswered,
  LinkButton,
  QuestionCard,
  SurveyKindBadge,
  useLeaveGuard,
  useSurvey,
} from "./parts";

export default function SurveyAnswerPage() {
  const { id } = useParams();
  const surveyId = Number(id);
  const survey = useSurvey(surveyId);
  const [done, setDone] = useState(false);

  if (survey.isLoading) return <Loading />;
  if (survey.error instanceof ApiError && survey.error.status === 404)
    return (
      <Unavailable
        title="このアンケートは表示できません"
        message="アンケートが削除されたか、あなたは回答の対象ではありません。"
      />
    );
  if (survey.error || !survey.data) return <ErrorBox error={survey.error} onRetry={() => survey.refetch()} />;
  const s = survey.data;

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="パンくず" className="mb-3 flex min-w-0 items-center gap-1 text-xs text-ink-3">
        <Link to="/surveys" className="shrink-0 hover:text-ai-700">
          アンケート
        </Link>
        <ChevronRight className="size-3 shrink-0" />
        <span className="truncate">{s.title}</span>
      </nav>
      {done ? (
        <Completed survey={s} />
      ) : !s.isTarget ? (
        <Unavailable
          survey={s}
          title="このアンケートの回答対象ではありません"
          message="配信対象に含まれていないため、回答できません。"
        />
      ) : s.responded ? (
        <Unavailable
          survey={s}
          icon={<CircleCheck className="size-10 text-wakaba" />}
          title="回答済みです"
          message="このアンケートにはすでに回答しています。ご協力ありがとうございました。"
        />
      ) : s.status !== "open" ? (
        <Unavailable
          survey={s}
          icon={<Lock className="size-10" />}
          title={
            s.status === "closed"
              ? "このアンケートは締め切られました"
              : "このアンケートはまだ配信されていません"
          }
          message={
            s.status === "closed" ? "回答の受付は終了しています。" : "配信されると回答できるようになります。"
          }
        />
      ) : (
        <AnswerForm survey={s} onDone={() => setDone(true)} />
      )}
    </div>
  );
}

function SurveyHeading({ survey }: { survey: Survey }) {
  return (
    <header className="mb-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <SurveyKindBadge kind={survey.kind} />
      </div>
      <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words">{survey.title}</h1>
      {survey.description && (
        <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">
          {survey.description}
        </p>
      )}
      <p className="mt-2 text-[13px] text-ink-2">
        締切 <DeadlineText survey={survey} className="font-bold text-ink" />
        <span className="ml-3 text-ink-3">質問 {survey.questions.length}問</span>
      </p>
    </header>
  );
}

function AnswerForm({ survey, onDone }: { survey: Survey; onDone: () => void }) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const touched = Object.values(answers).some(isAnswered);
  const allowLeave = useLeaveGuard(touched, "入力した回答は送信されず、失われます。");

  const required = survey.questions.filter((q) => q.required);
  const missing = useMemo(
    () => survey.questions.filter((q) => q.required && !isAnswered(answers[String(q.id)])),
    [survey.questions, answers],
  );
  const answeredCount = survey.questions.filter((q) => isAnswered(answers[String(q.id)])).length;

  const submit = useMutation({
    mutationFn: () => {
      const body: Record<string, AnswerValue> = {};
      for (const q of survey.questions) {
        const v = answers[String(q.id)];
        body[String(q.id)] = isAnswered(v) ? (typeof v === "string" ? v.trim() : v!) : null;
      }
      return post(`/surveys/${survey.id}/responses`, { answers: body });
    },
    onSuccess: () => {
      allowLeave();
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      queryClient.invalidateQueries({ queryKey: ["survey", survey.id] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      window.scrollTo({ top: 0 });
      onDone();
    },
    onError: (e) => {
      toast(errorMessage(e), "error");
      // 締切・回答済みなどで状態が変わっている可能性があるので取り直す
      if (e instanceof ApiError && e.status < 500)
        queryClient.invalidateQueries({ queryKey: ["survey", survey.id] });
    },
  });

  const onSubmit = () => {
    setTriedSubmit(true);
    const first = missing[0];
    if (first) {
      toast(`未回答の必須質問が${missing.length}問あります`, "error");
      const el = document.getElementById(`q-${first.id}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
      return;
    }
    submit.mutate();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <SurveyHeading survey={survey} />
      <AnonymityNote anonymous={survey.anonymous} className="mb-5" />
      <div className="space-y-3">
        {survey.questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            id={`q-${q.id}`}
            index={i}
            question={q}
            name={`q-${q.id}`}
            value={answers[String(q.id)]}
            onChange={(v) => setAnswers((a) => ({ ...a, [String(q.id)]: v }))}
            error={
              triedSubmit && q.required && !isAnswered(answers[String(q.id)])
                ? "この質問は回答が必須です"
                : null
            }
          />
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-40 flex-1">
            <p className="text-[13px] text-ink-2" aria-live="polite">
              <span className="tabular font-bold text-ink">
                {answeredCount}/{survey.questions.length}
              </span>
              問に回答
              {missing.length > 0 ? (
                <span className="ml-2 text-xs text-ink-3">
                  必須の未回答 <span className="tabular">{missing.length}</span>問
                </span>
              ) : (
                required.length > 0 && (
                  <span className="ml-2 text-xs text-wakaba">必須の質問はすべて回答済み</span>
                )
              )}
            </p>
            <div className="mt-1 max-w-64">
              <Meter value={answeredCount} max={Math.max(1, survey.questions.length)} tone="wakaba" />
            </div>
          </div>
          <Button type="submit" variant="primary" className="h-10 px-6" loading={submit.isPending}>
            送信する
          </Button>
        </div>
      </div>
    </form>
  );
}

function Completed({ survey }: { survey: Survey }) {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<CircleCheck className="size-12 text-wakaba" />}
        title="回答を送信しました"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <LinkButton to="/" variant="primary">
              ホームへ戻る
            </LinkButton>
            <LinkButton to="/surveys">アンケート一覧</LinkButton>
          </div>
        }
      >
        <p>「{survey.title}」へのご協力ありがとうございました。</p>
        {survey.anonymous && <p className="mt-1">回答は匿名で集計されます。</p>}
      </EmptyState>
    </div>
  );
}

function Unavailable({
  survey,
  icon,
  title,
  message,
}: {
  survey?: Survey;
  icon?: ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div>
      {survey && <SurveyHeading survey={survey} />}
      <div className="rounded-lg border border-line bg-white">
        <EmptyState
          icon={icon ?? <MessageSquareText className="size-10" />}
          title={title}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton to="/surveys">アンケート一覧</LinkButton>
              <LinkButton to="/">ホームへ戻る</LinkButton>
            </div>
          }
        >
          {message}
        </EmptyState>
      </div>
    </div>
  );
}
