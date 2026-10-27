import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { SKILL_LEVEL_LABELS } from "../../../shared/constants";
import type { JobPosition, PositionMatch } from "../../../shared/types";
import { Meter } from "../../components/charts";
import { Face } from "../../components/Face";
import {
  Button,
  cx,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Panel,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get } from "../../lib/api";
import { queryClient, useAuth } from "../../lib/queries";
import { PositionFormDialog } from "./PositionFormDialog";
import { PositionStatusBadge } from "./PositionsPage";

const PAGE = 20;

export default function PositionDetailPage() {
  const { id } = useParams();
  const positionId = Number(id);
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const canManage = me.capabilities.manageTalent;
  const canSeeMatches = me.user.role !== "member";

  const position = useQuery({
    queryKey: ["position", positionId],
    queryFn: () => get<JobPosition>(`/positions/${positionId}`),
  });
  const remove = useMutation({
    mutationFn: () => del(`/positions/${positionId}`),
    onSuccess: () => {
      toast("ポジションを削除しました");
      navigate("/positions");
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.removeQueries({ queryKey: ["position", positionId] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (position.isLoading) return <Loading />;
  if (position.error || !position.data)
    return <ErrorBox error={position.error} onRetry={() => position.refetch()} />;
  const p = position.data;

  return (
    <div>
      <nav aria-label="パンくず" className="mb-3 flex items-center gap-1 text-xs text-ink-3">
        <Link to="/positions" className="hover:text-ai-700">
          ポジション
        </Link>
        <ChevronRight className="size-3" />
        <span className="truncate">{p.name}</span>
      </nav>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {p.name}
            <PositionStatusBadge status={p.status} />
          </span>
        }
        actions={
          canManage && (
            <>
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                編集
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                loading={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `「${p.name}」を削除しますか？`,
                      message: "必要スキルの設定も削除され、元に戻せません。",
                      confirmLabel: "削除",
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                削除
              </Button>
            </>
          )
        }
      >
        <p className="mt-1 text-[13px] text-ink-2">
          {p.departmentName ?? "部署の指定なし"}
          <span className="ml-3">
            募集人数 <span className="tabular font-bold text-ink">{p.headcount}</span> 名
          </span>
        </p>
      </PageHeader>

      <div className={cx("grid items-start gap-5", canSeeMatches && "xl:grid-cols-[360px_minmax(0,1fr)]")}>
        <div className="space-y-5">
          <Panel title="ミッション">
            {p.mission ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{p.mission}</p>
            ) : (
              <p className="text-sm text-ink-3">まだ書かれていません。</p>
            )}
          </Panel>
          <Panel title="職務内容">
            {p.description ? (
              <p className="max-w-[72ch] text-sm leading-relaxed whitespace-pre-wrap text-ink-2">
                {p.description}
              </p>
            ) : (
              <p className="text-sm text-ink-3">まだ書かれていません。</p>
            )}
          </Panel>
          <Panel title="必要スキル" bodyClassName="p-0">
            {p.requirements.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">必要スキルは設定されていません。</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-line-2 text-left text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2 font-normal">スキル</th>
                    <th className="px-2 py-2 font-normal">必要レベル</th>
                    <th className="px-4 py-2 text-right font-normal">重み</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {p.requirements.map((r) => (
                    <tr key={r.skillId}>
                      <td className="px-4 py-2 font-bold">{r.skillName}</td>
                      <td className="px-2 py-2">
                        <span className="tabular block font-bold text-ai-700">Lv{r.minLevel}以上</span>
                        <span className="block text-[11px] leading-tight text-ink-3">
                          {SKILL_LEVEL_LABELS[r.minLevel]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <WeightMark weight={r.weight} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {canSeeMatches && <Candidates position={p} />}
      </div>

      {editing && <PositionFormDialog open onClose={() => setEditing(false)} position={p} />}
    </div>
  );
}

function WeightMark({ weight }: { weight: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("size-1.5 rounded-full", i <= weight ? "bg-ai-600" : "bg-line")} />
        ))}
      </span>
      <span className="tabular text-xs text-ink-2">{weight}</span>
    </span>
  );
}

function Candidates({ position }: { position: JobPosition }) {
  const [shown, setShown] = useState(PAGE);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["position", position.id, "matches"],
    queryFn: () => get<{ items: PositionMatch[] }>(`/positions/${position.id}/matches`),
  });
  const items = data?.items ?? [];
  return (
    <Panel
      title="候補者"
      description="マッチ度が高い順。スキルの数字は「必要レベル / 保有レベル」で、満たしている要件は緑、足りない要件は黄で示します。"
      bodyClassName="p-0"
    >
      {isLoading && <Loading />}
      {error && (
        <div className="p-4">
          <ErrorBox error={error} onRetry={() => refetch()} />
        </div>
      )}
      {data && position.requirements.length === 0 && (
        <EmptyState title="必要スキルが設定されていません">
          必要スキルを設定すると、スキルが合うメンバーを候補者として表示します。
        </EmptyState>
      )}
      {data && position.requirements.length > 0 && items.length === 0 && (
        <EmptyState icon={<Users className="size-10" />} title="条件に合う候補者がいません">
          必要スキルを1つでも持つ在籍中のメンバーがいると、ここに表示されます。
        </EmptyState>
      )}
      {items.length > 0 && (
        <>
          <ol className="divide-y divide-line-2">
            {items.slice(0, shown).map((c, i) => (
              <CandidateRow key={c.member.id} rank={i + 1} match={c} />
            ))}
          </ol>
          <div className="flex items-center justify-between gap-3 border-t border-line-2 px-4 py-2.5 text-[13px] text-ink-2">
            <span className="tabular">
              {items.length}名中 {Math.min(shown, items.length)}名を表示
            </span>
            {shown < items.length && (
              <Button size="sm" onClick={() => setShown((s) => s + PAGE)}>
                さらに表示
              </Button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function CandidateRow({ rank, match }: { rank: number; match: PositionMatch }) {
  const m = match.member;
  const tone = match.score >= 80 ? "wakaba" : match.score >= 50 ? "ai" : "yamabuki";
  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[2rem_minmax(0,220px)_150px_minmax(0,1fr)] md:items-center">
      <span
        className={cx(
          "tabular hidden text-center text-sm font-bold md:block",
          rank <= 3 ? "text-ai-800" : "text-ink-3",
        )}
      >
        {rank}
      </span>
      <Link to={`/members/${m.id}`} className="group flex min-w-0 items-center gap-2.5">
        <span className="tabular w-6 shrink-0 text-center text-sm font-bold text-ink-3 md:hidden">
          {rank}
        </span>
        <Face member={m} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold group-hover:text-ai-700">
            {m.lastName} {m.firstName}
          </span>
          <span className="block truncate text-xs text-ink-3">
            {m.departmentName ?? "所属なし"}
            {m.jobTitleName && m.jobTitleName !== "メンバー" && ` ${m.jobTitleName}`}
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3 md:block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-ink-3">マッチ度</span>
          <span className="tabular text-base font-bold">
            {match.score}
            <span className="text-xs font-normal text-ink-3">%</span>
          </span>
        </div>
        <div className="w-24 md:mt-1 md:w-auto">
          <Meter value={match.score} tone={tone} />
        </div>
        <p className="tabular text-[11px] text-ink-3 md:mt-1">
          要件 {match.met} / {match.total} を満たす
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="スキルごとの必要レベルと保有レベル">
        {match.details.map((d) => {
          const ok = d.actual >= d.required;
          return (
            <li
              key={d.skillId}
              title={`${d.skillName}：必要 Lv${d.required} / 保有 ${d.actual ? `Lv${d.actual}` : "なし"}`}
              className={cx(
                "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs",
                ok ? "bg-wakaba-100 text-wakaba" : "bg-yamabuki-100 text-[#7a5408]",
              )}
            >
              <span className="font-bold">{d.skillName}</span>
              <span className="tabular">
                {d.required} / {d.actual || "—"}
              </span>
              <span className="sr-only">{ok ? "満たしている" : "不足"}</span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
