import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { JobPosition } from "../../../shared/types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  IconButton,
  Loading,
  PageHeader,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { PositionFormDialog } from "./PositionFormDialog";

export function PositionStatusBadge({ status }: { status: JobPosition["status"] }) {
  return status === "open" ? <Badge tone="wakaba">募集中</Badge> : <Badge>募集終了</Badge>;
}

/** 必要スキルのチップ（スキル名と必要レベル） */
export function RequirementChips({ position, max }: { position: JobPosition; max?: number }) {
  const reqs = max ? position.requirements.slice(0, max) : position.requirements;
  const rest = position.requirements.length - reqs.length;
  if (!position.requirements.length)
    return <span className="text-xs text-ink-3">必要スキルは未設定です</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {reqs.map((r) => (
        <li
          key={r.skillId}
          className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-0.5 text-[13px]"
        >
          {r.skillName}
          <span className="tabular text-[11px] font-bold text-ai-700">Lv{r.minLevel}以上</span>
        </li>
      ))}
      {rest > 0 && <li className="px-1 py-0.5 text-xs text-ink-3">ほか{rest}件</li>}
    </ul>
  );
}

export default function PositionsPage() {
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = me.capabilities.manageTalent;
  const [editing, setEditing] = useState<JobPosition | "new" | null>(null);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["positions"],
    queryFn: () => get<{ items: JobPosition[] }>("/positions"),
  });
  const remove = useMutation({
    mutationFn: (p: JobPosition) => del(`/positions/${p.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      toast("ポジションを削除しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const items = data?.items ?? [];
  const openCount = items.filter((p) => p.status === "open").length;

  return (
    <div>
      <PageHeader
        title="ポジション"
        description={
          me.user.role === "member"
            ? "社内で募集しているポジションと、求められるスキルを確認できます。"
            : "社内で募集しているポジションと必要なスキルです。ポジションを開くと、スキルが合う候補者を確認できます。"
        }
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
              ポジションを作成
            </Button>
          )
        }
      />

      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<Target className="size-10" />}
            title="ポジションはまだありません"
            action={
              canManage && (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                  ポジションを作成
                </Button>
              )
            }
          >
            {canManage
              ? "必要なスキルを決めてポジションを作成すると、スキルが合う候補者を探せます。"
              : "人事がポジションを作成すると、ここに表示されます。"}
          </EmptyState>
        </div>
      )}

      {items.length > 0 && (
        <>
          <p className="mb-3 text-sm text-ink-2">
            募集中 <span className="tabular text-lg font-bold text-ink">{openCount}</span> 件
            <span className="ml-3 text-xs text-ink-3">全{items.length}件</span>
          </p>
          <ul className="divide-y divide-line-2 rounded-lg border border-line bg-white">
            {items.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/positions/${p.id}`}
                      className="text-[15px] font-bold hover:text-ai-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <PositionStatusBadge status={p.status} />
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">
                    {p.departmentName ?? "部署の指定なし"}
                    <span className="ml-3">
                      募集人数 <span className="tabular font-bold text-ink">{p.headcount}</span> 名
                    </span>
                  </p>
                  {p.mission && (
                    <p className="mt-1.5 line-clamp-2 max-w-[72ch] text-[13px] text-ink-2">{p.mission}</p>
                  )}
                  <div className="mt-2.5">
                    <RequirementChips position={p} max={6} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 sm:pt-0.5">
                  <Link
                    to={`/positions/${p.id}`}
                    className="inline-flex h-8 items-center rounded-md border border-line bg-white px-2.5 text-[13px] font-bold text-ink transition-colors hover:border-ai-200 hover:bg-ai-50"
                  >
                    {me.user.role === "member" ? "詳細を見る" : "候補者を見る"}
                  </Link>
                  {canManage && (
                    <>
                      <IconButton label={`${p.name}を編集`} onClick={() => setEditing(p)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label={`${p.name}を削除`}
                        className="hover:text-beni"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `「${p.name}」を削除しますか？`,
                              message:
                                "必要スキルの設定も削除され、元に戻せません。募集を締め切るだけなら「募集終了」にしてください。",
                              confirmLabel: "削除",
                              danger: true,
                            })
                          )
                            remove.mutate(p);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <PositionFormDialog
          open
          onClose={() => setEditing(null)}
          position={editing === "new" ? undefined : editing}
        />
      )}
    </div>
  );
}
