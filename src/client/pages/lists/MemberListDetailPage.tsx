import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Filter, Pencil, Plus, Trash2, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { MemberList, MemberSummary } from "../../../shared/types";
import { FaceTile } from "../../components/Face";
import { MemberPicker } from "../../components/pickers";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, post } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { ListColorMark, ListFormDialog } from "./ListFormDialog";

type ListDetail = { list: MemberList; members: MemberSummary[] };

export default function MemberListDetailPage() {
  const { id } = useParams();
  const listId = Number(id);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<MemberSummary | null>(null);

  const query = useQuery({
    queryKey: ["list", listId],
    queryFn: () => get<ListDetail>(`/lists/${listId}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["list", listId] });
    queryClient.invalidateQueries({ queryKey: ["lists"] });
    queryClient.invalidateQueries({ queryKey: ["member"] });
  };

  const addMember = useMutation({
    mutationFn: (m: MemberSummary) => post(`/lists/${listId}/members`, { memberIds: [m.id] }),
    onSuccess: (_, m) => {
      invalidate();
      setPicked(null);
      toast(`${m.lastName} ${m.firstName}さんをリストに追加しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const removeMember = useMutation({
    mutationFn: (m: MemberSummary) => del(`/lists/${listId}/members/${m.id}`),
    onSuccess: (_, m) => {
      invalidate();
      toast(`${m.lastName} ${m.firstName}さんをリストから外しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const removeList = useMutation({
    mutationFn: () => del(`/lists/${listId}`),
    onSuccess: () => {
      toast("リストを削除しました");
      navigate("/lists");
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      queryClient.removeQueries({ queryKey: ["list", listId] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;

  const { list, members } = query.data;
  const editable = list.isOwner;

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex items-center gap-1 text-xs text-ink-3">
        <Link to="/lists" className="hover:text-ai-700">
          社員リスト
        </Link>
        <ChevronRight className="size-3" />
        <span className="truncate">{list.name}</span>
      </nav>

      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <ListColorMark color={list.color} className="size-3.5" />
            <span className="min-w-0 break-words">{list.name}</span>
          </span>
        }
        description={list.description || undefined}
        actions={
          <>
            <Link
              to={`/members?listId=${list.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3.5 text-sm font-bold text-ink transition-colors hover:border-ai-200 hover:bg-ai-50"
            >
              <Filter className="size-4" />
              メンバー一覧で絞り込む
            </Link>
            {editable && (
              <>
                <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  編集
                </Button>
                <Button
                  variant="danger"
                  icon={<Trash2 className="size-4" />}
                  loading={removeList.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `「${list.name}」を削除しますか？`,
                        message: "リストだけが削除され、社員の情報は残ります。元に戻せません。",
                        confirmLabel: "削除",
                        danger: true,
                      })
                    )
                      removeList.mutate();
                  }}
                >
                  削除
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {list.shared ? <Badge tone="ai">共有</Badge> : <Badge>自分のみ</Badge>}
          <span>作成者 {list.ownerName}</span>
          <span>
            <span className="tabular font-bold text-ink">{list.memberCount}</span> 名
          </span>
        </div>
      </PageHeader>

      {editable && (
        <section className="mb-5 rounded-lg border border-line bg-white p-4">
          <Field label="メンバーを追加" htmlFor="list-add-member">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1 sm:max-w-md">
                <MemberPicker
                  id="list-add-member"
                  value={picked}
                  onChange={setPicked}
                  excludeIds={members.map((m) => m.id)}
                />
              </div>
              <Button
                variant="primary"
                icon={<Plus className="size-4" />}
                disabled={!picked}
                loading={addMember.isPending}
                onClick={() => picked && addMember.mutate(picked)}
              >
                追加
              </Button>
            </div>
          </Field>
          <p className="mt-2 text-xs text-ink-3">
            まとめて追加するときは、
            <Link to="/members" className="font-bold text-ai-700 hover:underline">
              メンバー
            </Link>
            で「選択」から複数人を選んでください。
          </p>
        </section>
      )}

      {members.length === 0 ? (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<Users className="size-10" />} title="このリストにはまだメンバーがいません">
            {editable
              ? "上の検索欄からメンバーを追加すると、ここに顔写真で表示されます。"
              : "作成者がメンバーを追加すると、ここに表示されます。"}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
          {members.map((m) => (
            <li key={m.id} className="flex flex-col">
              <FaceTile member={m} href={`/members/${m.id}`} />
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 text-ink-3 hover:text-beni"
                  icon={<UserMinus className="size-3.5" />}
                  aria-label={`${m.lastName} ${m.firstName}さんをリストから外す`}
                  disabled={removeMember.isPending && removeMember.variables?.id === m.id}
                  onClick={() => removeMember.mutate(m)}
                >
                  リストから外す
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <ListFormDialog open onClose={() => setEditing(false)} list={list} />}
    </div>
  );
}
