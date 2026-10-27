import { useQuery } from "@tanstack/react-query";
import { CircleCheck, MessageSquareText, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { SURVEY_STATUS_LABELS } from "../../../shared/constants";
import { formatDateJa } from "../../../shared/dates";
import type { Survey } from "../../../shared/types";
import { Meter } from "../../components/charts";
import { cx, EmptyState, ErrorBox, Loading, PageHeader, Panel, Tabs } from "../../components/ui";
import { get } from "../../lib/api";
import { useAuth } from "../../lib/queries";
import {
  AnonymousBadge,
  DeadlineText,
  jstDate,
  LinkButton,
  rate,
  SurveyKindBadge,
  SurveyStatusBadge,
} from "./parts";

function useSurveys() {
  return useQuery({
    queryKey: ["surveys"],
    queryFn: async () => (await get<{ items: Survey[] }>("/surveys")).items,
  });
}

export default function SurveysPage() {
  const me = useAuth();
  return me.capabilities.manageSurveys ? <ManageView /> : <MyView />;
}

// ───────── 一般社員：自分が対象のアンケート ─────────

function MyView() {
  const { data, error, isLoading, refetch } = useSurveys();
  const items = data ?? [];
  const todo = items.filter((s) => s.status === "open" && !s.responded);
  const rest = items.filter((s) => !(s.status === "open" && !s.responded));

  return (
    <div>
      <PageHeader
        title="アンケート"
        description="あなたが回答の対象になっているアンケートです。受付中のものは締切日までに回答してください。"
      />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<MessageSquareText className="size-10" />} title="回答するアンケートはありません">
            人事からアンケートが配信されると、ここに表示されます。
          </EmptyState>
        </div>
      )}
      {data && items.length > 0 && (
        <div className="space-y-5">
          <section aria-labelledby="todo-heading">
            <h2 id="todo-heading" className="mb-2 text-[15px] font-bold">
              回答をお願いしているもの
              <span className="tabular ml-2 text-sm font-normal text-ink-3">{todo.length}件</span>
            </h2>
            {todo.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-5 text-sm text-ink-2">
                <CircleCheck className="size-5 shrink-0 text-wakaba" aria-hidden />
                受付中のアンケートにはすべて回答済みです。
              </div>
            ) : (
              <ul className="space-y-3">
                {todo.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-4 rounded-lg border border-yamabuki bg-yamabuki-50 p-4 sm:flex-row sm:items-center sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <SurveyKindBadge kind={s.kind} />
                        <AnonymousBadge anonymous={s.anonymous} />
                      </div>
                      <h3 className="text-base leading-snug font-bold break-words">{s.title}</h3>
                      {s.description && (
                        <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{s.description}</p>
                      )}
                      <p className="mt-2 text-[13px] text-ink-2">
                        締切 <DeadlineText survey={s} className="font-bold text-ink" />
                        <span className="ml-3 text-ink-3">質問 {s.questions.length}問</span>
                      </p>
                    </div>
                    <LinkButton
                      to={`/surveys/${s.id}/answer`}
                      variant="primary"
                      className="h-10 px-5 sm:self-center"
                    >
                      回答する
                    </LinkButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {rest.length > 0 && (
            <Panel title="これまでのアンケート" bodyClassName="p-0">
              <ul className="divide-y divide-line-2">
                {rest.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/surveys/${s.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-ai-50"
                    >
                      <span className="min-w-0 flex-1 basis-60">
                        <span className="block truncate text-sm font-bold">{s.title}</span>
                        <span className="block text-xs text-ink-3">
                          {s.closesAt ? `締切日 ${formatDateJa(s.closesAt)}` : SURVEY_STATUS_LABELS[s.status]}
                        </span>
                      </span>
                      <MyStatus survey={s} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function MyStatus({ survey }: { survey: Survey }) {
  if (survey.responded)
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-bold text-wakaba">
        <CircleCheck className="size-4" aria-hidden />
        回答済み
      </span>
    );
  return <span className="text-[13px] text-ink-3">締め切られました（未回答）</span>;
}

// ───────── 人事：すべてのアンケート ─────────

type StatusTab = "all" | Survey["status"];

function ManageView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("status") as StatusTab | null) ?? "all";
  const { data, error, isLoading, refetch } = useSurveys();
  const items = data ?? [];
  const counts = useMemo(
    () => ({
      all: items.length,
      open: items.filter((s) => s.status === "open").length,
      draft: items.filter((s) => s.status === "draft").length,
      closed: items.filter((s) => s.status === "closed").length,
    }),
    [items],
  );
  const shown = tab === "all" ? items : items.filter((s) => s.status === tab);

  return (
    <div>
      <PageHeader
        title="アンケート"
        description="社員アンケートとパルスサーベイを作成・配信し、回答状況と結果を確認できます。"
        actions={
          <LinkButton to="/surveys/new/edit" variant="primary" icon={<Plus className="size-4" />}>
            アンケートを作成
          </LinkButton>
        }
      />
      <Tabs<StatusTab>
        className="mb-4"
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === "all") next.delete("status");
          else next.set("status", v);
          setParams(next, { replace: true });
        }}
        tabs={[
          { value: "all", label: "すべて", count: counts.all },
          { value: "open", label: SURVEY_STATUS_LABELS.open, count: counts.open },
          { value: "draft", label: SURVEY_STATUS_LABELS.draft, count: counts.draft },
          { value: "closed", label: SURVEY_STATUS_LABELS.closed, count: counts.closed },
        ]}
      />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && shown.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<MessageSquareText className="size-10" />}
            title={
              tab === "all"
                ? "アンケートはまだありません"
                : `${SURVEY_STATUS_LABELS[tab]}のアンケートはありません`
            }
            action={
              tab === "all" || tab === "draft" ? (
                <LinkButton to="/surveys/new/edit" variant="primary" icon={<Plus className="size-4" />}>
                  アンケートを作成
                </LinkButton>
              ) : undefined
            }
          >
            アンケートを作成すると、ここに表示されます。
          </EmptyState>
        </div>
      )}
      {shown.length > 0 && (
        <>
          {/* 広い画面：表 */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-normal">タイトル</th>
                  <th className="px-3 py-2 font-normal">状態</th>
                  <th className="px-3 py-2 font-normal">種類</th>
                  <th className="px-3 py-2 font-normal">集計</th>
                  <th className="px-3 py-2 font-normal">締切日</th>
                  <th className="w-48 px-3 py-2 font-normal">回答率</th>
                  <th className="px-4 py-2 font-normal">作成日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {shown.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer hover:bg-ai-50/60"
                    onClick={() => navigate(`/surveys/${s.id}`)}
                  >
                    <td className="max-w-md px-4 py-3">
                      <Link
                        to={`/surveys/${s.id}`}
                        className="block truncate font-bold hover:text-ai-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.title}
                      </Link>
                      <span className="text-xs text-ink-3">質問 {s.questions.length}問</span>
                    </td>
                    <td className="px-3 py-3">
                      <SurveyStatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-3">
                      <SurveyKindBadge kind={s.kind} />
                    </td>
                    <td className="px-3 py-3">
                      <AnonymousBadge anonymous={s.anonymous} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                      <DeadlineText survey={s} />
                    </td>
                    <td className="px-3 py-3">
                      <ResponseRate survey={s} />
                    </td>
                    <td className="tabular px-4 py-3 whitespace-nowrap text-ink-2">
                      {formatDateJa(jstDate(s.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ：カード */}
          <ul className="space-y-2.5 md:hidden">
            {shown.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/surveys/${s.id}`}
                  className="block rounded-lg border border-line bg-white p-4 hover:border-ai-200"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <SurveyStatusBadge status={s.status} />
                    <SurveyKindBadge kind={s.kind} />
                    <AnonymousBadge anonymous={s.anonymous} />
                  </div>
                  <p className="font-bold break-words">{s.title}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                    <dt className="text-ink-3">締切日</dt>
                    <dd className="text-ink-2">
                      <DeadlineText survey={s} />
                    </dd>
                    <dt className="text-ink-3">作成日</dt>
                    <dd className="tabular text-ink-2">{formatDateJa(jstDate(s.createdAt))}</dd>
                  </dl>
                  <div className="mt-3">
                    <ResponseRate survey={s} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ResponseRate({ survey }: { survey: Survey }) {
  if (survey.status === "draft") return <span className="text-xs text-ink-3">配信前</span>;
  const r = rate(survey.responseCount, survey.targetCount);
  return (
    <div className="min-w-32">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className={cx("tabular font-bold", survey.targetCount ? "text-ink" : "text-ink-3")}>{r}%</span>
        <span className="tabular text-ink-3">
          {survey.responseCount}/{survey.targetCount}名
        </span>
      </div>
      <Meter value={r} tone={r >= 80 ? "wakaba" : "ai"} />
    </div>
  );
}
