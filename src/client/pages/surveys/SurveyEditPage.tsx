import { useMutation } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleDot,
  Copy,
  Gauge,
  Lock,
  Plus,
  SquareCheck,
  TextCursorInput,
  ThumbsUp,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_QUESTION_TYPES,
  type SurveyQuestionType,
} from "../../../shared/constants";
import { todayJst } from "../../../shared/dates";
import type { Survey } from "../../../shared/types";
import {
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  PageHeader,
  Panel,
  Segmented,
  Select,
  Textarea,
  useToast,
} from "../../components/ui";
import { errorMessage, patch, post } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import {
  isChoice,
  LinkButton,
  type PreviewQuestion,
  PULSE_TEMPLATE,
  SURVEY_KIND_LABELS,
  SurveyPreview,
  SurveyStatusBadge,
  useLeaveGuard,
  useSurvey,
} from "./parts";

type OptionDraft = { key: string; value: string };
type QuestionDraft = {
  key: string;
  type: SurveyQuestionType;
  text: string;
  options: OptionDraft[];
  required: boolean;
};
type FormState = {
  title: string;
  description: string;
  kind: Survey["kind"];
  anonymous: boolean;
  closesAt: string;
  questions: QuestionDraft[];
};
type Errors = Record<string, string>;

const LIMITS = { title: 100, description: 2000, question: 400, option: 100, options: 30, questions: 50 };

let seq = 0;
const newKey = () => `k${++seq}`;
const opt = (value = ""): OptionDraft => ({ key: newKey(), value });

function newQuestion(type: SurveyQuestionType = "single"): QuestionDraft {
  return {
    key: newKey(),
    type,
    text: "",
    options: isChoice(type) ? [opt(), opt()] : [],
    required: type !== "text",
  };
}

function fromPreview(q: PreviewQuestion): QuestionDraft {
  return {
    key: newKey(),
    type: q.type,
    text: q.text,
    options: q.options.map((o) => opt(o)),
    required: q.required,
  };
}

function initialState(s: Survey | undefined): FormState {
  if (!s)
    return {
      title: "",
      description: "",
      kind: "survey",
      anonymous: false,
      closesAt: "",
      questions: [newQuestion("single")],
    };
  return {
    title: s.title,
    description: s.description,
    kind: s.kind,
    anonymous: s.anonymous,
    closesAt: s.closesAt ?? "",
    questions: s.questions.map(fromPreview),
  };
}

/** 比較用（key を除いた内容） */
function snapshot(f: FormState): string {
  return JSON.stringify({
    ...f,
    questions: f.questions.map((q) => ({ ...q, key: undefined, options: q.options.map((o) => o.value) })),
  });
}

function validate(f: FormState, locked: boolean, initialClosesAt: string): Errors {
  const e: Errors = {};
  if (!f.title.trim()) e.title = "タイトルを入力してください";
  else if (f.title.trim().length > LIMITS.title)
    e.title = `タイトルは${LIMITS.title}文字以内で入力してください`;
  if (f.description.trim().length > LIMITS.description)
    e.description = `説明は${LIMITS.description}文字以内で入力してください`;
  if (f.closesAt && f.closesAt !== initialClosesAt && f.closesAt < todayJst())
    e.closesAt = "締切日には今日以降の日付を指定してください";
  if (locked) return e;
  if (f.questions.length === 0) e.questions = "質問を1つ以上追加してください";
  if (f.questions.length > LIMITS.questions) e.questions = `質問は${LIMITS.questions}問までです`;
  for (const q of f.questions) {
    if (!q.text.trim()) e[`${q.key}.text`] = "質問文を入力してください";
    else if (q.text.trim().length > LIMITS.question)
      e[`${q.key}.text`] = `質問文は${LIMITS.question}文字以内で入力してください`;
    if (!isChoice(q.type)) continue;
    const values = q.options.map((o) => o.value.trim());
    const filled = values.filter(Boolean);
    if (filled.length < 2) e[`${q.key}.options`] = "選択肢を2つ以上入力してください";
    else if (q.options.length > LIMITS.options) e[`${q.key}.options`] = `選択肢は${LIMITS.options}個までです`;
    else if (new Set(filled).size !== filled.length) e[`${q.key}.options`] = "同じ選択肢が重複しています";
    else if (filled.some((v) => v.length > LIMITS.option))
      e[`${q.key}.options`] = `選択肢は${LIMITS.option}文字以内で入力してください`;
  }
  return e;
}

function toPayload(f: FormState) {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    kind: f.kind,
    anonymous: f.anonymous,
    closesAt: f.closesAt || null,
    questions: f.questions.map((q) => ({
      type: q.type,
      text: q.text.trim(),
      options: isChoice(q.type) ? q.options.map((o) => o.value.trim()).filter(Boolean) : [],
      required: q.required,
    })),
  };
}

export default function SurveyEditPage() {
  const { id } = useParams();
  const me = useAuth();
  const isNew = id === "new";
  const surveyId = Number(id);
  const survey = useSurvey(surveyId, !isNew);

  if (!me.capabilities.manageSurveys)
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState title="アンケートを編集する権限がありません">
          アンケートの作成は人事担当者が行います。
        </EmptyState>
      </div>
    );
  if (!isNew && !(Number.isInteger(surveyId) && surveyId > 0))
    return <ErrorBox error={new Error("アンケートが見つかりません。URL を確認してください。")} />;
  if (!isNew && survey.isLoading) return <Loading />;
  if (!isNew && (survey.error || !survey.data))
    return <ErrorBox error={survey.error} onRetry={() => survey.refetch()} />;
  return <Editor key={survey.data?.id ?? "new"} survey={isNew ? undefined : survey.data} />;
}

function Editor({ survey }: { survey: Survey | undefined }) {
  const toast = useToast();
  const navigate = useNavigate();
  const locked = !!survey && survey.status !== "draft";
  const [initial] = useState(() => initialState(survey));
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const dirty = useMemo(() => snapshot(form) !== snapshot(initial), [form, initial]);
  const allowLeave = useLeaveGuard(dirty, "保存していない変更は失われます。");
  const ids = useId();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (submitted) setErrors(validate(next, locked, initial.closesAt));
      return next;
    });
  };
  const setQuestions = (fn: (qs: QuestionDraft[]) => QuestionDraft[]) => {
    setForm((f) => {
      const next = { ...f, questions: fn(f.questions) };
      if (submitted) setErrors(validate(next, locked, initial.closesAt));
      return next;
    });
  };
  const updateQ = (key: string, patchQ: Partial<QuestionDraft>) =>
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patchQ } : q)));
  const moveQ = (index: number, delta: number) =>
    setQuestions((qs) => {
      const next = [...qs];
      const [q] = next.splice(index, 1);
      next.splice(index + delta, 0, q!);
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      const body = toPayload(form);
      if (!survey) return (await post<{ id: number }>("/surveys", body)).id;
      await patch(`/surveys/${survey.id}`, body);
      return survey.id;
    },
    onSuccess: (savedId) => {
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      queryClient.invalidateQueries({ queryKey: ["survey", savedId] });
      toast(survey ? "保存しました" : "アンケートを作成しました");
      allowLeave();
      navigate(`/surveys/${savedId}`, { replace: !survey });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const onSave = () => {
    setSubmitted(true);
    const e = validate(form, locked, initial.closesAt);
    setErrors(e);
    const keys = Object.keys(e);
    if (keys.length) {
      toast("入力内容を確認してください", "error");
      const first = keys[0]!;
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-error-key="${first}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
      });
      return;
    }
    save.mutate();
  };

  const insertTemplate = () => {
    const blank = form.questions.every((q) => !q.text.trim());
    const added = PULSE_TEMPLATE.map(fromPreview);
    setQuestions((qs) => (blank ? added : [...qs, ...added]));
    toast(blank ? "パルスサーベイのひな形を入れました" : "ひな形の質問を5問追加しました");
  };

  const backTo = survey ? `/surveys/${survey.id}` : "/surveys";
  const actions = (
    <>
      <LinkButton to={backTo}>キャンセル</LinkButton>
      <Button variant="primary" onClick={onSave} loading={save.isPending}>
        {survey ? "保存" : "作成する"}
      </Button>
    </>
  );

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex min-w-0 items-center gap-1 text-xs text-ink-3">
        <Link to="/surveys" className="shrink-0 hover:text-ai-700">
          アンケート
        </Link>
        {survey && (
          <>
            <ChevronRight className="size-3 shrink-0" />
            <Link to={`/surveys/${survey.id}`} className="truncate hover:text-ai-700">
              {survey.title}
            </Link>
          </>
        )}
        <ChevronRight className="size-3 shrink-0" />
        <span className="shrink-0">{survey ? "編集" : "新規作成"}</span>
      </nav>
      <PageHeader
        title={survey ? "アンケートを編集" : "アンケートを作成"}
        description={
          survey
            ? undefined
            : "質問を組み立てて保存すると下書きになります。対象者を選んで配信すると回答の受付が始まります。"
        }
        actions={actions}
      >
        {survey && (
          <div className="mt-1.5">
            <SurveyStatusBadge status={survey.status} />
          </div>
        )}
      </PageHeader>

      {locked && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-yamabuki bg-yamabuki-50 px-4 py-3 text-[13px] text-ink">
          <Lock className="mt-0.5 size-4 shrink-0 text-yamabuki-600" aria-hidden />
          <p>
            配信済みのため、質問・種類・集計方法は変更できません。タイトル・説明・締切日のみ編集できます。
          </p>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0 space-y-5">
          <Panel title="基本情報">
            <div className="grid gap-4">
              <div data-error-key="title">
                <Field label="タイトル" required htmlFor={`${ids}-title`} error={errors.title}>
                  <Input
                    id={`${ids}-title`}
                    value={form.title}
                    maxLength={LIMITS.title}
                    aria-invalid={!!errors.title || undefined}
                    placeholder="例：2026年11月 パルスサーベイ"
                    onChange={(e) => set("title", e.target.value)}
                  />
                </Field>
              </div>
              <div data-error-key="description">
                <Field
                  label="説明"
                  htmlFor={`${ids}-desc`}
                  error={errors.description}
                  help="回答画面の冒頭に表示されます。目的や結果の使い道を書くと回答率が上がります。"
                >
                  <Textarea
                    id={`${ids}-desc`}
                    rows={3}
                    value={form.description}
                    maxLength={LIMITS.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="種類">
                  {locked ? (
                    <p className="text-sm">{SURVEY_KIND_LABELS[form.kind]}</p>
                  ) : (
                    <div>
                      <Segmented<Survey["kind"]>
                        label="種類"
                        value={form.kind}
                        onChange={(v) => set("kind", v)}
                        options={[
                          { value: "survey", label: SURVEY_KIND_LABELS.survey },
                          { value: "pulse", label: SURVEY_KIND_LABELS.pulse },
                        ]}
                      />
                    </div>
                  )}
                </Field>
                <div data-error-key="closesAt">
                  <Field
                    label="締切日"
                    htmlFor={`${ids}-closes`}
                    error={errors.closesAt}
                    help="空欄にすると、締め切るまで回答を受け付けます。"
                  >
                    <Input
                      id={`${ids}-closes`}
                      type="date"
                      className="max-w-48"
                      min={todayJst()}
                      value={form.closesAt}
                      aria-invalid={!!errors.closesAt || undefined}
                      onChange={(e) => set("closesAt", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <Field label="集計方法">
                {locked ? (
                  <p className="text-sm">{form.anonymous ? "匿名で集計" : "記名で集計"}</p>
                ) : (
                  <div>
                    <Checkbox
                      label="匿名で集計する"
                      checked={form.anonymous}
                      onChange={(e) => set("anonymous", e.target.checked)}
                    />
                    <p className="mt-1 text-xs text-ink-3">
                      {form.anonymous
                        ? "回答者を記録しません。部署別の平均は回答3件未満の部署を伏せ、自由記述にも氏名を出しません。"
                        : "回答は氏名とともに記録され、集計画面と CSV に氏名が表示されます。"}
                    </p>
                    {form.kind === "pulse" && !form.anonymous && (
                      <p className="mt-1 text-xs font-bold text-yamabuki-600">
                        パルスサーベイは本音を集めるため、匿名での実施をおすすめします。
                      </p>
                    )}
                  </div>
                )}
              </Field>
            </div>
          </Panel>

          <Panel
            title={
              <span>
                質問
                <span className="tabular ml-2 text-sm font-normal text-ink-3">{form.questions.length}問</span>
              </span>
            }
            actions={
              !locked && (
                <Button size="sm" icon={<WandSparkles className="size-4" />} onClick={insertTemplate}>
                  パルスサーベイのひな形
                </Button>
              )
            }
            bodyClassName="p-3 sm:p-4"
          >
            {locked ? (
              <LockedQuestions questions={form.questions} />
            ) : (
              <div className="space-y-3" data-error-key="questions">
                {errors.questions && (
                  <p className="text-xs font-bold text-beni" role="alert">
                    {errors.questions}
                  </p>
                )}
                {form.questions.length === 0 && (
                  <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
                    下のボタンから質問を追加するか、パルスサーベイのひな形を入れてください。
                  </p>
                )}
                {form.questions.map((q, i) => (
                  <QuestionEditor
                    key={q.key}
                    index={i}
                    count={form.questions.length}
                    question={q}
                    errors={errors}
                    onChange={(p) => updateQ(q.key, p)}
                    onMove={(d) => moveQ(i, d)}
                    onDuplicate={() =>
                      setQuestions((qs) => {
                        const next = [...qs];
                        next.splice(i + 1, 0, {
                          ...q,
                          key: newKey(),
                          options: q.options.map((o) => opt(o.value)),
                        });
                        return next;
                      })
                    }
                    onRemove={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}
                  />
                ))}
                <AddQuestionBar
                  disabled={form.questions.length >= LIMITS.questions}
                  onAdd={(type) => {
                    const q = newQuestion(type);
                    setQuestions((qs) => [...qs, q]);
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLInputElement>(`[data-question-text="${q.key}"]`)?.focus(),
                    );
                  }}
                />
              </div>
            )}
          </Panel>

          <div className="flex justify-end gap-2">{actions}</div>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20" aria-label="回答画面のプレビュー">
          <div className="rounded-lg border border-line bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-2.5">
              <h2 className="text-[15px] font-bold">回答画面のプレビュー</h2>
              <span className="text-xs text-ink-3">入力を試せます</span>
            </header>
            <div className="bg-canvas/70 p-3 sm:p-4 lg:max-h-[calc(100dvh-160px)] lg:overflow-y-auto">
              <SurveyPreview
                title={form.title}
                description={form.description}
                anonymous={form.anonymous}
                questions={form.questions.map((q) => ({
                  key: q.key,
                  type: q.type,
                  text: q.text,
                  required: q.required,
                  options: q.options.map((o) => o.value),
                }))}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const TYPE_ICONS: Record<SurveyQuestionType, ReactNode> = {
  single: <CircleDot className="size-4" />,
  multi: <SquareCheck className="size-4" />,
  scale: <Gauge className="size-4" />,
  nps: <ThumbsUp className="size-4" />,
  text: <TextCursorInput className="size-4" />,
};

const TYPE_HELP: Partial<Record<SurveyQuestionType, string>> = {
  scale: "1（そう思わない）から5（そう思う）の5段階で回答します。集計では平均と分布を表示します。",
  nps: "0〜10の11段階で回答します。9〜10を推奨者、0〜6を批判者として NPS（推奨者の割合−批判者の割合）を計算します。",
  text: "4000文字まで自由に記入できます。",
};

function AddQuestionBar({ onAdd, disabled }: { onAdd: (t: SurveyQuestionType) => void; disabled: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-3">
      <p className="mb-2 text-[13px] font-bold text-ink-2">質問を追加</p>
      <div className="flex flex-wrap gap-2">
        {SURVEY_QUESTION_TYPES.map((t) => (
          <Button key={t} size="sm" icon={TYPE_ICONS[t]} disabled={disabled} onClick={() => onAdd(t)}>
            {SURVEY_QUESTION_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>
      {disabled && <p className="mt-2 text-xs text-ink-3">質問は{LIMITS.questions}問まで追加できます。</p>}
    </div>
  );
}

function QuestionEditor({
  index,
  count,
  question: q,
  errors,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  index: number;
  count: number;
  question: QuestionDraft;
  errors: Errors;
  onChange: (p: Partial<QuestionDraft>) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const uid = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const textError = errors[`${q.key}.text`];
  const optionsError = errors[`${q.key}.options`];
  const label = `Q${index + 1}`;

  const setOptions = (options: OptionDraft[]) => onChange({ options });
  const focusOption = (key: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLInputElement>(`[data-option="${key}"]`)?.focus(),
    );
  const addOption = (at = q.options.length) => {
    const o = opt();
    const next = [...q.options];
    next.splice(at, 0, o);
    setOptions(next);
    focusOption(o.key);
  };
  const moveOption = (i: number, delta: number) => {
    const next = [...q.options];
    const [o] = next.splice(i, 1);
    next.splice(i + delta, 0, o!);
    setOptions(next);
  };

  return (
    <section
      aria-label={`${label}の設定`}
      className={cx(
        "rounded-lg border bg-white",
        textError || optionsError ? "border-beni/60" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line-2 bg-canvas/50 px-3 py-2">
        <span className="tabular w-8 text-sm font-bold text-ai-700">{label}</span>
        <Select
          aria-label={`${label}の種類`}
          className="h-8 w-auto min-w-36 text-[13px]"
          value={q.type}
          onChange={(e) => {
            const type = e.target.value as SurveyQuestionType;
            const options = isChoice(type) && q.options.length === 0 ? [opt(), opt()] : q.options;
            onChange({ type, options });
          }}
        >
          {SURVEY_QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SURVEY_QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Checkbox
          label="必須"
          className="ml-1 text-[13px]"
          checked={q.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        <div className="ml-auto flex items-center">
          <IconButton label={`${label}を上へ移動`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label={`${label}を下へ移動`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton label={`${label}を複製`} onClick={onDuplicate}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton
            label={`${label}を削除`}
            className="hover:bg-beni-100 hover:text-beni"
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </header>
      <div className="space-y-3 p-3">
        <div data-error-key={`${q.key}.text`}>
          <Field label="質問文" required htmlFor={`${uid}-text`} error={textError}>
            <Input
              id={`${uid}-text`}
              data-question-text={q.key}
              value={q.text}
              maxLength={LIMITS.question}
              aria-invalid={!!textError || undefined}
              placeholder="例：今の仕事にやりがいを感じていますか"
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </Field>
        </div>
        {isChoice(q.type) ? (
          <div data-error-key={`${q.key}.options`}>
            <p className="mb-1.5 text-[13px] font-bold text-ink-2">
              選択肢
              <span className="ml-1 text-beni" aria-hidden>
                *
              </span>
              <span className="ml-2 text-xs font-normal text-ink-3">
                {q.type === "single" ? "1つだけ選べます" : "いくつでも選べます"}
              </span>
            </p>
            <ul ref={listRef} className="space-y-1.5">
              {q.options.map((o, i) => (
                <li key={o.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cx(
                      "size-4 shrink-0 border-2 border-line",
                      q.type === "single" ? "rounded-full" : "rounded-[3px]",
                    )}
                  />
                  <Input
                    data-option={o.key}
                    aria-label={`${label}の選択肢${i + 1}`}
                    aria-invalid={(!!optionsError && !o.value.trim()) || undefined}
                    value={o.value}
                    maxLength={LIMITS.option}
                    placeholder={`選択肢${i + 1}`}
                    className="h-8"
                    onChange={(e) =>
                      setOptions(
                        q.options.map((x) => (x.key === o.key ? { ...x, value: e.target.value } : x)),
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (q.options.length < LIMITS.options) addOption(i + 1);
                      }
                    }}
                  />
                  <div className="flex shrink-0 items-center">
                    <IconButton
                      label={`選択肢${i + 1}を上へ移動`}
                      disabled={i === 0}
                      onClick={() => moveOption(i, -1)}
                      className="size-7"
                    >
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`選択肢${i + 1}を下へ移動`}
                      disabled={i === q.options.length - 1}
                      onClick={() => moveOption(i, 1)}
                      className="size-7"
                    >
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`選択肢${i + 1}を削除`}
                      onClick={() => setOptions(q.options.filter((x) => x.key !== o.key))}
                      className="size-7 hover:bg-beni-100 hover:text-beni"
                    >
                      <X className="size-3.5" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-4" />}
                disabled={q.options.length >= LIMITS.options}
                onClick={() => addOption()}
              >
                選択肢を追加
              </Button>
              <span className="text-xs text-ink-3">Enter キーでも次の選択肢を追加できます</span>
            </div>
            {optionsError && (
              <p className="mt-1 text-xs font-bold text-beni" role="alert">
                {optionsError}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-3">{TYPE_HELP[q.type]}</p>
        )}
      </div>
    </section>
  );
}

function LockedQuestions({ questions }: { questions: QuestionDraft[] }) {
  return (
    <ol className="divide-y divide-line-2">
      {questions.map((q, i) => (
        <li key={q.key} className="flex gap-3 px-1 py-2.5">
          <span className="tabular w-8 shrink-0 text-sm font-bold text-ai-700">Q{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold break-words">{q.text}</p>
            <p className="mt-0.5 text-xs text-ink-3">
              {SURVEY_QUESTION_TYPE_LABELS[q.type]}
              <span className="ml-2">{q.required ? "必須" : "任意"}</span>
            </p>
            {isChoice(q.type) && (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <li key={o.key} className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">
                    {o.value}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
