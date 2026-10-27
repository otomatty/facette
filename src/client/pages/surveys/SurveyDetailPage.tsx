import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  CircleCheck,
  CircleStop,
  Download,
  Lock,
  MessageSquareText,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatDateJa, formatDateTimeJa, todayJst } from "../../../shared/dates";
import type { Survey, SurveyResults } from "../../../shared/types";
import { Meter } from "../../components/charts";
import { DepartmentOptions } from "../../components/pickers";
import {
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
  Select,
  Tabs,
  useConfirm,
  useToast,
} from "../../components/ui";
import { ApiError, del, downloadText, errorMessage, get, post } from "../../lib/api";
import {
  buildDeptTree,
  type DeptNode,
  descendantIds,
  flattenDeptTree,
  queryClient,
  useAllMembers,
  useAuth,
  useMasters,
} from "../../lib/queries";
import {
  AnonymityNote,
  AnonymousBadge,
  DeadlineText,
  daysUntil,
  LinkButton,
  rate,
  SurveyKindBadge,
  SurveyPreview,
  SurveyStatusBadge,
  useSurvey,
} from "./parts";
import { SurveyResultsView } from "./SurveyResults";

export default function SurveyDetailPage() {
  const { id } = useParams();
  const surveyId = Number(id);
  const me = useAuth();
  const survey = useSurvey(surveyId);

  if (survey.isLoading) return <Loading />;
  if (survey.error instanceof ApiError && survey.error.status === 404)
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState
          icon={<MessageSquareText className="size-10" />}
          title="このアンケートは表示できません"
          action={<LinkButton to="/surveys">アンケート一覧</LinkButton>}
        >
          アンケートが削除されたか、あなたは回答の対象ではありません。
        </EmptyState>
      </div>
    );
  if (survey.error || !survey.data) return <ErrorBox error={survey.error} onRetry={() => survey.refetch()} />;
  const s = survey.data;
  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex min-w-0 items-center gap-1 text-xs text-ink-3">
        <Link to="/surveys" className="shrink-0 hover:text-ai-700">
          アンケート
        </Link>
        <ChevronRight className="size-3 shrink-0" />
        <span className="truncate">{s.title}</span>
      </nav>
      {me.capabilities.manageSurveys ? <ManageDetail survey={s} /> : <MemberDetail survey={s} />}
    </div>
  );
}

// ───────── 一般社員 ─────────

function MemberDetail({ survey: s }: { survey: Survey }) {
  const canAnswer = s.status === "open" && s.isTarget && !s.responded;
  return (
    <div className="max-w-3xl">
      <PageHeader title={s.title}>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SurveyStatusBadge status={s.status} />
          <SurveyKindBadge kind={s.kind} />
        </div>
      </PageHeader>
      <div className="space-y-4 rounded-lg border border-line bg-white p-5">
        {s.description && (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">
            {s.description}
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-ink-3">締切日</dt>
          <dd>
            <DeadlineText survey={s} />
          </dd>
          <dt className="text-ink-3">質問数</dt>
          <dd className="tabular">{s.questions.length}問</dd>
        </dl>
        <AnonymityNote anonymous={s.anonymous} />
        <div className="border-t border-line-2 pt-4">
          {canAnswer ? (
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton to={`/surveys/${s.id}/answer`} variant="primary" className="h-10 px-6">
                回答する
              </LinkButton>
              <span className="text-[13px] text-ink-2">まだ回答していません。</span>
            </div>
          ) : s.responded ? (
            <p className="flex items-center gap-2 text-sm font-bold text-wakaba">
              <CircleCheck className="size-5" aria-hidden />
              回答済みです。ご協力ありがとうございました。
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Lock className="size-4 text-ink-3" aria-hidden />
              {s.status === "closed"
                ? "締め切られたため回答できません。"
                : "現在は回答を受け付けていません。"}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-3">集計結果は人事担当者が確認します。</p>
    </div>
  );
}

// ───────── 人事 ─────────

function ManageDetail({ survey: s }: { survey: Survey }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [tab, setTab] = useState<"results" | "questions">("results");
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["survey", s.id] });
    queryClient.invalidateQueries({ queryKey: ["surveys"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
  };

  const close = useMutation({
    mutationFn: () => post(`/surveys/${s.id}/close`),
    onSuccess: () => {
      invalidate();
      toast("締め切りました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const reopen = useMutation({
    mutationFn: (body: { closesAt?: string | null }) => post(`/surveys/${s.id}/reopen`, body),
    onSuccess: () => {
      invalidate();
      setReopening(false);
      toast("回答の受付を再開しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const remove = useMutation({
    mutationFn: () => del(`/surveys/${s.id}`),
    onSuccess: () => {
      // 遷移中もこの画面はしばらく表示されたままなので、ここでは再取得させずに古い扱いにだけしておく
      queryClient.invalidateQueries({ queryKey: ["survey", s.id], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      toast("アンケートを削除しました");
      navigate("/surveys", { replace: true });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const exportCsv = useMutation({
    mutationFn: () => get<{ filename: string; csv: string }>(`/surveys/${s.id}/export`),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv);
      toast("CSV を出力しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const pending = s.targetCount - s.responseCount;
  const deadlinePassed = !!s.closesAt && s.closesAt < todayJst();

  const actions = (
    <>
      {s.status !== "draft" && (
        <Button
          icon={<Download className="size-4" />}
          loading={exportCsv.isPending}
          disabled={s.responseCount === 0 || (s.anonymous && s.responseCount < 3)}
          title={
            s.responseCount === 0
              ? "回答がまだありません"
              : s.anonymous && s.responseCount < 3
                ? "匿名アンケートの回答は3件以上集まってから出力できます"
                : undefined
          }
          onClick={() => exportCsv.mutate()}
        >
          CSV出力
        </Button>
      )}
      <LinkButton to={`/surveys/${s.id}/edit`} icon={<Pencil className="size-4" />}>
        編集
      </LinkButton>
      <Button
        variant="danger"
        icon={<Trash2 className="size-4" />}
        loading={remove.isPending}
        onClick={async () => {
          if (
            await confirm({
              title: `「${s.title}」を削除しますか？`,
              message:
                s.responseCount > 0
                  ? `集まった回答${s.responseCount}件もすべて削除され、元に戻せません。結果を残す場合は先に CSV を出力してください。`
                  : "元に戻せません。",
              confirmLabel: "削除",
              danger: true,
            })
          )
            remove.mutate();
        }}
      >
        削除
      </Button>
      {s.status === "draft" && (
        <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setPublishing(true)}>
          配信する
        </Button>
      )}
      {s.status === "open" && (
        <Button
          variant="primary"
          icon={<CircleStop className="size-4" />}
          loading={close.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: "回答の受付を締め切りますか？",
                message:
                  pending > 0
                    ? `未回答の${pending}名は回答できなくなります。締め切ったあとも再開できます。`
                    : "締め切ったあとも再開できます。",
                confirmLabel: "締め切る",
              })
            )
              close.mutate();
          }}
        >
          締め切る
        </Button>
      )}
      {s.status === "closed" && (
        <Button
          variant="primary"
          icon={<RotateCcw className="size-4" />}
          loading={reopen.isPending}
          onClick={async () => {
            // 締切日を過ぎている場合は、新しい締切日を決めてから再開する
            if (deadlinePassed) {
              setReopening(true);
              return;
            }
            if (
              await confirm({
                title: "回答の受付を再開しますか？",
                message: "未回答の対象者が回答できるようになります。",
                confirmLabel: "再開",
              })
            )
              reopen.mutate({});
          }}
        >
          再開
        </Button>
      )}
    </>
  );

  return (
    <div>
      <PageHeader title={<span className="break-words">{s.title}</span>} actions={actions}>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SurveyStatusBadge status={s.status} />
          <SurveyKindBadge kind={s.kind} />
          <AnonymousBadge anonymous={s.anonymous} />
        </div>
        {s.description && (
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
            {s.description}
          </p>
        )}
      </PageHeader>

      {s.status === "open" && s.isTarget && !s.responded && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-yamabuki bg-yamabuki-50 px-4 py-2.5 text-[13px]">
          <span>あなたもこのアンケートの回答対象です。</span>
          <LinkButton to={`/surveys/${s.id}/answer`} size="sm" variant="primary">
            回答する
          </LinkButton>
        </div>
      )}

      <Summary survey={s} />

      {s.status === "draft" ? (
        <DraftBody survey={s} onPublish={() => setPublishing(true)} />
      ) : (
        <>
          <Tabs
            className="mb-5"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "results", label: "集計結果" },
              { value: "questions", label: "質問と回答画面", count: s.questions.length },
            ]}
          />
          {tab === "results" ? <ResultsSection survey={s} /> : <QuestionsPreview survey={s} />}
        </>
      )}

      {publishing && <PublishDialog survey={s} onClose={() => setPublishing(false)} onDone={invalidate} />}
      {reopening && (
        <ReopenDialog
          survey={s}
          loading={reopen.isPending}
          onClose={() => setReopening(false)}
          onSubmit={(closesAt) => reopen.mutate({ closesAt })}
        />
      )}
    </div>
  );
}

function Summary({ survey: s }: { survey: Survey }) {
  const r = rate(s.responseCount, s.targetCount);
  const items: { label: string; value: ReactNode }[] =
    s.status === "draft"
      ? [
          { label: "締切日", value: <DeadlineText survey={s} /> },
          { label: "質問数", value: <span className="tabular">{s.questions.length}問</span> },
          { label: "作成日時", value: <span className="tabular">{formatDateTimeJa(s.createdAt)}</span> },
        ]
      : [
          { label: "締切日", value: <DeadlineText survey={s} /> },
          { label: "配信日時", value: <span className="tabular">{formatDateTimeJa(s.publishedAt)}</span> },
          { label: "質問数", value: <span className="tabular">{s.questions.length}問</span> },
        ];
  return (
    <section className="mb-5 rounded-lg border border-line bg-white" aria-label="概要">
      <div className="grid gap-x-8 gap-y-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {s.status !== "draft" && (
          <div>
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="text-xs text-ink-3">回答率</dt>
                <dd className="tabular text-[28px] leading-tight font-bold">
                  {r}
                  <span className="ml-0.5 text-sm font-normal text-ink-3">%</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">回答数</dt>
                <dd className="tabular text-[28px] leading-tight font-bold">
                  {s.responseCount}
                  <span className="ml-0.5 text-sm font-normal text-ink-3">件</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">対象者数</dt>
                <dd className="tabular text-[28px] leading-tight font-bold">
                  {s.targetCount}
                  <span className="ml-0.5 text-sm font-normal text-ink-3">名</span>
                </dd>
              </div>
            </dl>
            <div className="mt-3 max-w-md">
              <Meter value={r} tone={r >= 80 ? "wakaba" : "ai"} />
              <p className="tabular mt-1 text-xs text-ink-3">
                未回答 {Math.max(0, s.targetCount - s.responseCount)}名
              </p>
            </div>
          </div>
        )}
        <dl
          className={cx(
            "grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-2 text-sm",
            s.status !== "draft" && "lg:border-l lg:border-line-2 lg:pl-8",
          )}
        >
          {items.map((it) => (
            <div key={it.label} className="contents">
              <dt className="text-ink-3">{it.label}</dt>
              <dd className="min-w-0">{it.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function DraftBody({ survey: s, onPublish }: { survey: Survey; onPublish: () => void }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
      <Panel title="配信の準備">
        <div className="space-y-3 text-sm text-ink-2">
          <p>このアンケートは下書きです。対象者には表示されていません。</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>右のプレビューで、回答画面の見え方を確認します。</li>
            <li>必要なら「編集」から質問や締切日を直します。</li>
            <li>「配信する」で対象（全社または部署）を選ぶと、回答の受付が始まります。</li>
          </ol>
          <p className="text-xs text-ink-3">配信後は質問・種類・集計方法を変更できません。</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" icon={<Send className="size-4" />} onClick={onPublish}>
              配信する
            </Button>
            <LinkButton to={`/surveys/${s.id}/edit`} icon={<Pencil className="size-4" />}>
              編集
            </LinkButton>
          </div>
        </div>
      </Panel>
      <QuestionsPreview survey={s} />
    </div>
  );
}

function QuestionsPreview({ survey: s }: { survey: Survey }) {
  return (
    <div className="max-w-3xl rounded-lg border border-line bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-2.5">
        <h2 className="text-[15px] font-bold">回答画面のプレビュー</h2>
        <span className="text-xs text-ink-3">入力を試せます（送信はされません）</span>
      </header>
      <div className="bg-canvas/70 p-3 sm:p-4">
        <SurveyPreview
          title={s.title}
          description={s.description}
          anonymous={s.anonymous}
          questions={s.questions.map((q) => ({ ...q, key: String(q.id) }))}
        />
      </div>
    </div>
  );
}

function ResultsSection({ survey: s }: { survey: Survey }) {
  const results = useQuery({
    queryKey: ["survey", s.id, "results"],
    queryFn: () => get<SurveyResults>(`/surveys/${s.id}/results`),
  });
  if (results.isLoading) return <Loading label="集計しています" />;
  if (results.error || !results.data)
    return <ErrorBox error={results.error} onRetry={() => results.refetch()} />;
  if (results.data.survey.responseCount === 0)
    return (
      <div className="rounded-lg border border-line bg-white">
        <EmptyState icon={<MessageSquareText className="size-10" />} title="まだ回答がありません">
          {s.status === "open"
            ? "回答が集まると、ここに質問ごとの結果と部署別の状況が表示されます。"
            : "回答がないまま締め切られました。再開すると回答を受け付けます。"}
        </EmptyState>
      </div>
    );
  return <SurveyResultsView results={results.data} />;
}

// ───────── 配信ダイアログ ─────────

function collectSubtree(roots: DeptNode[], ids: number[]): Set<number> {
  const out = new Set<number>();
  const walk = (list: DeptNode[]) => {
    for (const n of list) {
      if (ids.includes(n.id)) for (const d of descendantIds(n)) out.add(d);
      else walk(n.children);
    }
  };
  walk(roots);
  return out;
}

function PublishDialog({
  survey: s,
  onClose,
  onDone,
}: {
  survey: Survey;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const masters = useMasters();
  const members = useAllMembers();
  const [scope, setScope] = useState<"all" | "departments">("all");
  const [deptIds, setDeptIds] = useState<number[]>([]);
  const tree = useMemo(() => (masters.data ? buildDeptTree(masters.data.departments) : []), [masters.data]);
  const flat = useMemo(() => flattenDeptTree(tree), [tree]);

  const estimate = useMemo(() => {
    if (!members.data) return null;
    const active = members.data.filter((m) => m.status === "active");
    if (scope === "all") return active.length;
    const ids = collectSubtree(tree, deptIds);
    return active.filter((m) => m.departmentId !== null && ids.has(m.departmentId)).length;
  }, [members.data, scope, deptIds, tree]);

  const publish = useMutation({
    mutationFn: () =>
      post<{ targets: number }>(`/surveys/${s.id}/publish`, {
        departmentIds: scope === "all" ? [] : deptIds,
      }),
    onSuccess: (r) => {
      onDone();
      toast(`${r.targets}名に配信しました`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const deadlinePassed = !!s.closesAt && daysUntil(s.closesAt) < 0;
  const invalid = scope === "departments" && deptIds.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="アンケートを配信する"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            icon={<Send className="size-4" />}
            loading={publish.isPending}
            disabled={invalid || estimate === 0}
            onClick={() => publish.mutate()}
          >
            配信する
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          「<span className="font-bold text-ink">{s.title}</span>
          」の回答の受付を始めます。対象者のホームに回答の依頼が表示されます。
        </p>
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold text-ink-2">配信対象</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: "all", label: "全社", help: "在籍中のすべての社員" },
                { value: "departments", label: "部署を選ぶ", help: "選んだ部署と配下の部署の社員" },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={cx(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5",
                  scope === o.value ? "border-ai-500 bg-ai-50" : "border-line hover:bg-ai-50/50",
                )}
              >
                <input
                  type="radio"
                  name="publish-scope"
                  className="mt-1 size-4 accent-ai-700"
                  checked={scope === o.value}
                  onChange={() => setScope(o.value)}
                />
                <span>
                  <span className="block text-sm font-bold">{o.label}</span>
                  <span className="block text-xs text-ink-3">{o.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {scope === "departments" && (
          <div>
            <label htmlFor="publish-dept" className="mb-1.5 block text-[13px] font-bold text-ink-2">
              部署を追加
            </label>
            <Select
              id="publish-dept"
              value=""
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v && !deptIds.includes(v)) setDeptIds([...deptIds, v]);
              }}
            >
              <option value="">部署を選んでください</option>
              <DepartmentOptions />
            </Select>
            {deptIds.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="選んだ部署">
                {flat
                  .filter((d) => deptIds.includes(d.id))
                  .map((d) => (
                    <li
                      key={d.id}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-ai-200 bg-ai-50 pr-0.5 pl-2 text-[13px] text-ai-900"
                    >
                      {d.name}
                      <button
                        type="button"
                        aria-label={`${d.name}を外す`}
                        className="rounded p-1 text-ai-700 hover:bg-ai-100"
                        onClick={() => setDeptIds(deptIds.filter((x) => x !== d.id))}
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-ink-3">1つ以上の部署を選んでください。複数選べます。</p>
            )}
          </div>
        )}
        <div className="rounded-md bg-canvas px-4 py-3">
          <p className="text-sm">
            配信対象
            <span className="tabular mx-1.5 text-xl font-bold">{estimate ?? "—"}</span>名
          </p>
          <p className="text-xs text-ink-3">休職中・退職済みの社員には配信されません。</p>
          {estimate === 0 && !invalid && (
            <p className="mt-1 text-xs font-bold text-beni">
              対象の社員がいません。部署を選び直してください。
            </p>
          )}
        </div>
        <ul className="space-y-1 text-xs text-ink-2">
          <li>締切日：{s.closesAt ? formatDateJa(s.closesAt) : "なし（締め切るまで受付）"}</li>
          <li>集計方法：{s.anonymous ? "匿名" : "記名"}</li>
          <li>配信後は質問・種類・集計方法を変更できません。</li>
        </ul>
        {deadlinePassed && (
          <p className="rounded-md border border-beni/30 bg-beni-100 px-3 py-2 text-xs text-beni">
            締切日が過去の日付です。配信する前に「編集」から締切日を変更してください。
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 締切日を過ぎて締め切られたアンケートを、新しい締切日を決めて再開する */
function ReopenDialog({
  survey: s,
  loading,
  onClose,
  onSubmit,
}: {
  survey: Survey;
  loading: boolean;
  onClose: () => void;
  onSubmit: (closesAt: string | null) => void;
}) {
  const today = todayJst();
  const [noDeadline, setNoDeadline] = useState(false);
  const [date, setDate] = useState(() => addDaysIso(today, 7));
  const invalid = !noDeadline && (!date || date < today);
  return (
    <Modal
      open
      onClose={onClose}
      title="回答の受付を再開する"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            icon={<RotateCcw className="size-4" />}
            loading={loading}
            disabled={invalid}
            onClick={() => onSubmit(noDeadline ? null : date)}
          >
            再開
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink-2">
          締切日（{formatDateJa(s.closesAt)}
          ）を過ぎたため締め切られています。新しい締切日を決めると、未回答の対象者が回答できるようになります。
        </p>
        <Field
          label="新しい締切日"
          htmlFor="reopen-closes-at"
          error={invalid && !noDeadline ? "今日以降の日付を指定してください" : null}
        >
          <Input
            id="reopen-closes-at"
            type="date"
            min={today}
            className="max-w-48"
            value={date}
            disabled={noDeadline}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Checkbox
          label="締切日を設けない（締め切るまで受け付ける）"
          checked={noDeadline}
          onChange={(e) => setNoDeadline(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
