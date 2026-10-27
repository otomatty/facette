import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Inbox, MessageSquareText, Pin } from "lucide-react";
import { Link } from "react-router";
import { formatDateJa, formatDateTimeJa, todayJst } from "../../shared/dates";
import type { HomeSummary } from "../../shared/types";
import { Face } from "../components/Face";
import { ErrorBox, Loading, Panel } from "../components/ui";
import { get } from "../lib/api";
import { useAuth } from "../lib/queries";

const TODO_ICON = {
  evaluation: <ClipboardCheck className="size-5 text-ai-600" />,
  survey: <MessageSquareText className="size-5 text-wakaba" />,
  request: <Inbox className="size-5 text-yamabuki-600" />,
};

export default function HomePage() {
  const me = useAuth();
  const { data, error, refetch, isLoading } = useQuery({
    queryKey: ["home"],
    queryFn: () => get<HomeSummary>("/home"),
  });
  const today = todayJst();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${today}T00:00:00+09:00`).getDay()];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-3">
            {formatDateJa(today)}（{weekday}）
          </p>
          <h1 className="mt-0.5 text-[22px] font-bold">
            {me.member ? `${me.member.lastName}さん、おつかれさまです` : "ホーム"}
          </h1>
        </div>
        {data && (
          <dl className="flex gap-6 text-right">
            {[
              ["従業員", data.stats.headcount, "名"],
              ["今月の入社", data.stats.joinedThisMonth, "名"],
              ["休職中", data.stats.onLeave, "名"],
              ["部署", data.stats.departments, ""],
            ].map(([label, value, unit]) => (
              <div key={label}>
                <dt className="text-[11px] text-ink-3">{label}</dt>
                <dd className="tabular text-xl font-bold">
                  {value}
                  <span className="ml-0.5 text-xs font-normal text-ink-3">{unit}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Panel title="あなたのやること" bodyClassName="p-0">
              {data.todos.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-6 text-sm text-ink-2">
                  <CheckCircle2 className="size-5 text-wakaba" />
                  対応が必要なことはありません。
                </div>
              ) : (
                <ul className="divide-y divide-line-2">
                  {data.todos.map((t) => (
                    <li key={t.href + t.title}>
                      <Link to={t.href} className="flex items-center gap-3 px-4 py-3 hover:bg-ai-50">
                        {TODO_ICON[t.kind]}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold">{t.title}</span>
                          {t.detail && <span className="block truncate text-xs text-ink-3">{t.detail}</span>}
                        </span>
                        <span className="text-xs font-bold text-ai-700">開く</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="お知らせ"
              bodyClassName="p-0"
              actions={
                me.capabilities.manageAnnouncements ? (
                  <Link
                    to="/settings/announcements"
                    className="text-xs font-bold text-ai-700 hover:underline"
                  >
                    お知らせを管理
                  </Link>
                ) : null
              }
            >
              {data.announcements.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-3">お知らせはまだありません。</p>
              ) : (
                <ul className="divide-y divide-line-2">
                  {data.announcements.map((a) => (
                    <li key={a.id} className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {a.pinned && (
                          <Pin className="size-3.5 shrink-0 text-yamabuki-600" aria-label="固定" />
                        )}
                        <h3 className="text-sm font-bold">{a.title}</h3>
                      </div>
                      {a.body && (
                        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">{a.body}</p>
                      )}
                      <p className="mt-1.5 text-[11px] text-ink-3">
                        {formatDateTimeJa(a.publishedAt)}
                        {a.authorName && ` ${a.authorName}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="新しく加わったメンバー" description="直近90日の入社">
              {data.newcomers.length === 0 ? (
                <p className="text-sm text-ink-3">直近の入社はありません。</p>
              ) : (
                <ul className="grid grid-cols-4 gap-3">
                  {data.newcomers.map((m) => (
                    <li key={m.id}>
                      <Link to={`/members/${m.id}`} className="group block text-center">
                        <Face member={m} size={72} className="mx-auto w-full! h-auto! aspect-square" />
                        <span className="mt-1 block truncate text-xs font-bold group-hover:text-ai-700">
                          {m.lastName} {m.firstName}
                        </span>
                        <span className="block truncate text-[11px] text-ink-3">{m.departmentName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="今月の入社記念日">
              {data.anniversaries.length === 0 ? (
                <p className="text-sm text-ink-3">今月が入社記念月のメンバーはいません。</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.anniversaries.map(({ member, years }) => (
                    <li key={member.id}>
                      <Link to={`/members/${member.id}`} className="group flex items-center gap-3">
                        <Face member={member} size={36} rounded="full" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold group-hover:text-ai-700">
                            {member.lastName} {member.firstName}
                          </span>
                          <span className="block truncate text-xs text-ink-3">{member.departmentName}</span>
                        </span>
                        <span className="tabular rounded bg-yamabuki-50 px-2 py-0.5 text-xs font-bold text-[#7a5408]">
                          {years}周年
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
