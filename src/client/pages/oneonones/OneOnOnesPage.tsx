import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, PenLine, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { formatDateJa, todayJst } from "../../../shared/dates";
import type { MemberSummary, OneOnOne } from "../../../shared/types";
import { FaceTile } from "../../components/Face";
import { MemberPicker } from "../../components/pickers";
import {
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Segmented,
} from "../../components/ui";
import { get, qs } from "../../lib/api";
import { useAllMembers, useAuth } from "../../lib/queries";
import { OneOnOneCard, OneOnOneEditor } from "../members/ProfileTabs";

const PAGE = 20;
const STALE_DAYS = 60;

function daysAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function OneOnOnesPage() {
  const me = useAuth();
  return me.capabilities.writeOneOnOnes ? <WriterView /> : <MemberView />;
}

/** 一般社員：自分に共有された記録 */
function MemberView() {
  const [shown, setShown] = useState(PAGE);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["one-on-ones", "list", { mine: "member" }],
    queryFn: () => get<{ items: OneOnOne[] }>("/one-on-ones?mine=member"),
  });
  const items = data?.items ?? [];
  return (
    <div>
      <PageHeader
        title="1on1・面談"
        description="上長や人事との面談で話したことと、次のアクションを振り返れます。共有された記録だけが表示されます。"
      />
      {isLoading && <Loading />}
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState
            icon={<MessagesSquare className="size-10" />}
            title="共有された面談記録はまだありません"
          >
            面談した相手が記録を共有すると、ここに表示されます。
          </EmptyState>
        </div>
      )}
      {items.length > 0 && (
        <RecordList items={items} shown={shown} onMore={() => setShown((s) => s + PAGE)} />
      )}
    </div>
  );
}

type Mine = "all" | "interviewer" | "member";

/** マネージャー・人事：面談の記録と、最近話せていないメンバー */
function WriterView() {
  const me = useAuth();
  const allMembers = useAllMembers();
  const [mine, setMine] = useState<Mine>("all");
  const [target, setTarget] = useState<MemberSummary | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [picking, setPicking] = useState(false);
  const [recordFor, setRecordFor] = useState<MemberSummary | null>(null);

  const list = useQuery({
    queryKey: ["one-on-ones", "list", { mine, memberId: target?.id ?? null }],
    queryFn: () =>
      get<{ items: OneOnOne[] }>(
        `/one-on-ones${qs({ mine: mine === "all" ? null : mine, memberId: target?.id, limit: 200 })}`,
      ),
  });
  // 最近話せていないメンバーを出すための、見られる範囲の直近の記録
  const recent = useQuery({
    queryKey: ["one-on-ones", "last-held"],
    queryFn: () => get<{ items: { memberId: number; lastHeldOn: string }[] }>("/one-on-ones/last-held"),
    enabled: me.capabilities.writeOneOnOnes,
  });

  // 管轄範囲（サーバーが判定した部署 ID。null は全社）
  const scopeIds = useMemo(
    () => (me.scopeDepartmentIds === null ? null : new Set(me.scopeDepartmentIds)),
    [me.scopeDepartmentIds],
  );

  const myMemberId = me.member?.id;
  const inScope = useCallback(
    (m: MemberSummary) =>
      m.id !== myMemberId && (scopeIds === null || (m.departmentId !== null && scopeIds.has(m.departmentId))),
    [scopeIds, myMemberId],
  );

  const stale = useMemo(() => {
    if (!allMembers.data || !recent.data) return null;
    const last = new Map<number, string>();
    for (const o of recent.data.items) last.set(o.memberId, o.lastHeldOn);
    const cutoff = daysAgo(todayJst(), STALE_DAYS);
    return allMembers.data
      .filter((m) => m.status === "active" && inScope(m))
      .map((m) => ({ member: m, last: last.get(m.id) ?? null }))
      .filter((x) => !x.last || x.last < cutoff)
      .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? ""));
  }, [allMembers.data, recent.data, inScope]);

  const items = list.data?.items ?? [];
  const filtered = mine !== "all" || target;

  return (
    <div>
      <PageHeader
        title="1on1・面談"
        description={
          me.user.role === "manager"
            ? "チームのメンバーとの面談を記録し、振り返れます。コンディションは本人には表示されません。"
            : "社員との面談を記録し、振り返れます。コンディションは本人には表示されません。"
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
            面談を記録
          </Button>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="oo-records" className="min-w-0">
          <h2 id="oo-records" className="sr-only">
            面談の記録
          </h2>
          <div className="mb-3 flex flex-col gap-3 rounded-lg border border-line bg-white p-3 sm:flex-row sm:items-center">
            {me.member && (
              <Segmented
                label="表示する記録"
                value={mine}
                onChange={(v) => {
                  setMine(v);
                  setShown(PAGE);
                }}
                options={[
                  { value: "all", label: "すべて" },
                  { value: "interviewer", label: "自分が面談者" },
                  { value: "member", label: "自分が受けた面談" },
                ]}
              />
            )}
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <MemberPicker
                value={target}
                onChange={(m) => {
                  setTarget(m);
                  setShown(PAGE);
                }}
                placeholder="対象者で絞り込む"
              />
            </div>
            <p className="text-sm text-ink-2 sm:ml-auto" aria-live="polite">
              <span className="tabular text-lg font-bold text-ink">{list.data ? items.length : "—"}</span> 件
              {list.isFetching && !list.isLoading && <span className="ml-2 text-xs text-ink-3">更新中</span>}
            </p>
          </div>

          {list.isLoading && <Loading />}
          {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
          {list.data && items.length === 0 && (
            <div className="rounded-lg border border-line bg-white">
              <EmptyState
                icon={<MessagesSquare className="size-10" />}
                title={filtered ? "条件に合う面談記録がありません" : "面談記録はまだありません"}
                action={
                  !filtered && (
                    <Button icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
                      面談を記録
                    </Button>
                  )
                }
              >
                {filtered
                  ? "絞り込みの条件を変えてお試しください。"
                  : "面談を記録すると、ここに新しい順で表示されます。"}
              </EmptyState>
            </div>
          )}
          {items.length > 0 && (
            <RecordList items={items} showMember shown={shown} onMore={() => setShown((s) => s + PAGE)} />
          )}
        </section>

        <aside className="order-first min-w-0 xl:sticky xl:top-20 xl:order-none">
          <StalePanel
            stale={stale}
            loading={allMembers.isLoading || recent.isLoading}
            onRecord={setRecordFor}
            scopeLabel={me.user.role === "manager" ? "自部署と配下の部署" : "全社"}
          />
        </aside>
      </div>

      {picking && (
        <TargetPickerDialog
          inScope={inScope}
          onClose={() => setPicking(false)}
          onNext={(m) => {
            setPicking(false);
            setRecordFor(m);
          }}
        />
      )}
      {recordFor && (
        <OneOnOneEditor key={recordFor.id} open onClose={() => setRecordFor(null)} memberId={recordFor.id} />
      )}
    </div>
  );
}

function RecordList({
  items,
  showMember,
  shown,
  onMore,
}: {
  items: OneOnOne[];
  showMember?: boolean;
  shown: number;
  onMore: () => void;
}) {
  return (
    <>
      <div className="space-y-3">
        {items.slice(0, shown).map((o) => (
          <OneOnOneCard key={o.id} o={o} showMember={showMember} />
        ))}
      </div>
      {shown < items.length && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-ink-2">
          <span className="tabular">
            {items.length}件中 {shown}件を表示
          </span>
          <Button size="sm" onClick={onMore}>
            さらに表示
          </Button>
        </div>
      )}
    </>
  );
}

const STALE_SHOWN = 12;

function StalePanel({
  stale,
  loading,
  onRecord,
  scopeLabel,
}: {
  stale: { member: MemberSummary; last: string | null }[] | null;
  loading: boolean;
  onRecord: (m: MemberSummary) => void;
  scopeLabel: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? stale : stale?.slice(0, STALE_SHOWN);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          最近話せていないメンバー
          {stale && <span className="tabular text-xs font-normal text-ink-3">{stale.length}名</span>}
        </span>
      }
      description={`${scopeLabel}の在籍メンバーのうち、直近${STALE_DAYS}日に面談の記録がない人`}
    >
      {loading || !stale ? (
        <Loading />
      ) : stale.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-2">全員と{STALE_DAYS}日以内に面談しています。</p>
      ) : (
        <>
          <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 xl:mx-0 xl:grid xl:grid-cols-[repeat(auto-fill,minmax(96px,1fr))] xl:overflow-visible xl:px-0 xl:pb-0">
            {shown?.map(({ member: m, last }) => (
              <li key={m.id} className="flex w-24 shrink-0 flex-col xl:w-auto">
                <FaceTile
                  member={m}
                  href={`/members/${m.id}`}
                  compact
                  footer={
                    <span className="tabular block truncate text-[11px] text-ink-3">
                      {last ? `前回 ${formatDateJa(last).replace(/^\d+年/, "")}` : "記録なし"}
                    </span>
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-0.5 h-7 text-[12px]"
                  icon={<PenLine className="size-3.5" />}
                  aria-label={`${m.lastName} ${m.firstName}さんとの面談を記録`}
                  onClick={() => onRecord(m)}
                >
                  記録する
                </Button>
              </li>
            ))}
          </ul>
          {stale.length > STALE_SHOWN && (
            <div className="mt-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? "一部だけ表示" : `すべて表示（${stale.length}名）`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function TargetPickerDialog({
  inScope,
  onClose,
  onNext,
}: {
  inScope: (m: MemberSummary) => boolean;
  onClose: () => void;
  onNext: (m: MemberSummary) => void;
}) {
  const me = useAuth();
  const [picked, setPicked] = useState<MemberSummary | null>(null);
  const error = !picked
    ? null
    : picked.id === me.member?.id
      ? "自分自身の面談記録は作成できません"
      : !inScope(picked)
        ? "管轄外のメンバーです。自部署と配下の部署のメンバーを選んでください"
        : null;
  return (
    <Modal
      open
      onClose={onClose}
      title="面談を記録"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" disabled={!picked || !!error} onClick={() => picked && onNext(picked)}>
            記録を書く
          </Button>
        </>
      }
    >
      <Field label="面談の対象者" required htmlFor="oo-target" error={error}>
        <MemberPicker
          id="oo-target"
          value={picked}
          onChange={setPicked}
          excludeIds={me.member ? [me.member.id] : []}
        />
      </Field>
      {picked && !error && (
        <p className="mt-3 text-xs text-ink-3">
          過去の記録は
          <Link to={`/members/${picked.id}`} className="mx-0.5 font-bold text-ai-700 hover:underline">
            {picked.lastName}さんのプロフィール
          </Link>
          の「1on1・面談」で確認できます。
        </p>
      )}
    </Modal>
  );
}
