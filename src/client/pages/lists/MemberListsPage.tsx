import { useQuery } from "@tanstack/react-query";
import { ListChecks, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { MemberList } from "../../../shared/types";
import { FaceStack } from "../../components/Face";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { get } from "../../lib/api";
import { useAuth } from "../../lib/queries";
import { ListColorMark, ListFormDialog } from "./ListFormDialog";

export default function MemberListsPage() {
  const me = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["lists"],
    queryFn: () => get<{ items: MemberList[] }>("/lists"),
  });
  const items = data?.items ?? [];
  // isOwner は「編集できるか」（管理者は他人のリストも true）なので、作成者かどうかは ownerUserId で判定する
  const own = items.filter((l) => l.ownerUserId === me.user.id);
  const shared = items.filter((l) => l.ownerUserId !== me.user.id);

  return (
    <div>
      <PageHeader
        title="社員リスト"
        description="気になるメンバーをリストにまとめておけます。共有したリストは社内の全員が閲覧できます。"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            リストを作成
          </Button>
        }
      />

      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-8">
          <section aria-labelledby="own-lists">
            <h2 id="own-lists" className="mb-3 flex items-center gap-2 text-[15px] font-bold">
              自分のリスト
              <span className="tabular text-xs font-normal text-ink-3">{own.length}件</span>
            </h2>
            {own.length === 0 ? (
              <div className="rounded-lg border border-line bg-white">
                <EmptyState
                  icon={<ListChecks className="size-10" />}
                  title="自分のリストはまだありません"
                  action={
                    <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                      リストを作成
                    </Button>
                  }
                >
                  リストを作成すると、ここに表示されます。メンバー一覧で複数人を選んで追加することもできます。
                </EmptyState>
              </div>
            ) : (
              <ListGrid lists={own} />
            )}
          </section>

          <section aria-labelledby="shared-lists">
            <h2 id="shared-lists" className="mb-3 flex items-center gap-2 text-[15px] font-bold">
              共有されたリスト
              <span className="tabular text-xs font-normal text-ink-3">{shared.length}件</span>
            </h2>
            {shared.length === 0 ? (
              <div className="rounded-lg border border-line bg-white">
                <EmptyState title="共有されたリストはありません">
                  ほかの人がリストを共有すると、ここに表示されます。
                </EmptyState>
              </div>
            ) : (
              <ListGrid lists={shared} />
            )}
          </section>
        </div>
      )}

      {creating && <ListFormDialog open onClose={() => setCreating(false)} />}
    </div>
  );
}

function ListGrid({ lists }: { lists: MemberList[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {lists.map((l) => (
        <li key={l.id}>
          <ListCard list={l} />
        </li>
      ))}
    </ul>
  );
}

function ListCard({ list }: { list: MemberList }) {
  return (
    <Link
      to={`/lists/${list.id}`}
      className="group flex h-full flex-col rounded-lg border border-line bg-white p-4 transition-[border-color,box-shadow] hover:border-ai-300 hover:shadow-[0_4px_14px_-6px_rgba(22,38,61,.35)]"
    >
      <div className="flex items-start gap-2.5">
        <ListColorMark color={list.color} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold group-hover:text-ai-700">{list.name}</h3>
          <p className="truncate text-xs text-ink-3">作成者 {list.ownerName}</p>
        </div>
        {list.shared ? <Badge tone="ai">共有</Badge> : <Badge>自分のみ</Badge>}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.6em] text-[13px] leading-relaxed text-ink-2">
        {list.description || <span className="text-ink-3">説明はありません</span>}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-2 pt-3">
        {list.previewMembers.length > 0 ? (
          <FaceStack members={list.previewMembers} max={6} />
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <Users className="size-4" />
            まだメンバーがいません
          </span>
        )}
        <span className="shrink-0 text-sm text-ink-2">
          <span className="tabular text-base font-bold text-ink">{list.memberCount}</span> 名
        </span>
      </div>
    </Link>
  );
}
