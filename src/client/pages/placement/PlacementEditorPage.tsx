import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Copy, Pencil, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatDateJa, formatDateTimeJa } from "../../../shared/dates";
import { normalizeForSearch } from "../../../shared/text";
import type { MemberSummary, PlacementMove, PlacementScenario } from "../../../shared/types";
import { Face } from "../../components/Face";
import { type BoardMember, groupByDept, OrgBoard } from "../../components/OrgBoard";
import { DepartmentSelect } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, patch, post, put } from "../../lib/api";
import { buildDeptTree, queryClient, useAllMembers, useAuth, useMasters } from "../../lib/queries";

type Move = { toDepartmentId: number | null; toJobTitleId: number | null };

export default function PlacementEditorPage() {
  const { id } = useParams();
  const scenarioId = Number(id);
  const me = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const masters = useMasters();
  const members = useAllMembers();
  const scenario = useQuery({
    queryKey: ["placement", scenarioId],
    queryFn: () => get<{ scenario: PlacementScenario; moves: PlacementMove[] }>(`/placement/${scenarioId}`),
  });

  const [moves, setMoves] = useState<Map<number, Move> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [editing, setEditing] = useState<MemberSummary | null>(null);
  const [showFaces, setShowFaces] = useState(true);
  const [q, setQ] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [meta, setMeta] = useState<{ name: string; description: string; effectiveDate: string } | null>(null);

  useEffect(() => {
    if (scenario.data && moves === null) {
      setMoves(
        new Map(
          scenario.data.moves.map((m) => [
            m.memberId,
            { toDepartmentId: m.toDepartmentId, toJobTitleId: m.toJobTitleId },
          ]),
        ),
      );
    }
  }, [scenario.data, moves]);

  const readOnly = scenario.data?.scenario.status === "applied";

  // 自動保存
  const save = useMutation({
    mutationFn: (list: PlacementMove[]) => put(`/placement/${scenarioId}/moves`, { moves: list }),
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["placement"], exact: true });
    },
    onError: (e) => toast(`保存できませんでした：${errorMessage(e)}`, "error"),
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMoves = save.mutate;
  useEffect(() => {
    if (!dirty || !moves) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDirty(false);
      saveMoves([...moves.entries()].map(([memberId, m]) => ({ memberId, ...m })));
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [moves, dirty, saveMoves]);

  const memberMap = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m])), [members.data]);
  const deptName = useMemo(
    () => new Map((masters.data?.departments ?? []).map((d) => [d.id, d.name])),
    [masters.data],
  );
  const jtMap = useMemo(() => new Map((masters.data?.jobTitles ?? []).map((j) => [j.id, j])), [masters.data]);

  const board = useMemo(() => {
    const list: BoardMember[] = (members.data ?? []).map((m) => {
      const mv = moves?.get(m.id);
      const deptId = mv?.toDepartmentId ?? m.departmentId;
      const jtId = mv?.toJobTitleId ?? m.jobTitleId;
      const jt = jtId ? jtMap.get(jtId) : undefined;
      return {
        ...m,
        departmentId: deptId,
        departmentName: deptId ? (deptName.get(deptId) ?? null) : null,
        jobTitleId: jtId,
        jobTitleName: jt?.name ?? null,
        jobRank: jt?.rank ?? 0,
        moved: !!mv && (deptId !== m.departmentId || jtId !== m.jobTitleId),
      };
    });
    return groupByDept(list);
  }, [members.data, moves, jtMap, deptName]);

  const changes = useMemo(() => {
    const out: {
      member: MemberSummary;
      from: string;
      to: string;
      fromJt: string | null;
      toJt: string | null;
    }[] = [];
    for (const [memberId, mv] of moves ?? []) {
      const m = memberMap.get(memberId);
      if (!m) continue;
      const toDept = mv.toDepartmentId ?? m.departmentId;
      const toJt = mv.toJobTitleId ?? m.jobTitleId;
      if (toDept === m.departmentId && toJt === m.jobTitleId) continue;
      out.push({
        member: m,
        from: m.departmentName ?? "所属なし",
        to: toDept ? (deptName.get(toDept) ?? "—") : "所属なし",
        fromJt: m.jobTitleName,
        toJt: toJt ? (jtMap.get(toJt)?.name ?? null) : null,
      });
    }
    return out;
  }, [moves, memberMap, deptName, jtMap]);

  const deltas = useMemo(() => {
    const d = new Map<number, number>();
    for (const c of changes) {
      const m = memberMap.get(c.member.id)!;
      const mv = moves?.get(m.id);
      const toDept = mv?.toDepartmentId ?? m.departmentId;
      if (toDept === m.departmentId) continue;
      if (m.departmentId) d.set(m.departmentId, (d.get(m.departmentId) ?? 0) - 1);
      if (toDept) d.set(toDept, (d.get(toDept) ?? 0) + 1);
    }
    return d;
  }, [changes, memberMap, moves]);

  const highlight = useMemo(() => {
    const term = normalizeForSearch(q);
    if (!term) return new Set<number>();
    return new Set(
      (members.data ?? [])
        .filter((m) =>
          normalizeForSearch(`${m.lastName}${m.firstName}${m.lastNameKana}${m.firstNameKana}`).includes(term),
        )
        .map((m) => m.id),
    );
  }, [q, members.data]);

  const setMove = (memberId: number, next: Move | null) => {
    if (readOnly) return;
    setMoves((prev) => {
      const map = new Map(prev ?? []);
      const m = memberMap.get(memberId);
      if (
        !next ||
        !m ||
        ((next.toDepartmentId ?? m.departmentId) === m.departmentId &&
          (next.toJobTitleId ?? m.jobTitleId) === m.jobTitleId)
      ) {
        map.delete(memberId);
      } else {
        map.set(memberId, next);
      }
      return map;
    });
    setDirty(true);
  };

  const apply = useMutation({
    mutationFn: () => post<{ applied: number }>(`/placement/${scenarioId}/apply`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["placement"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["masters"] });
      toast(`${r.applied}名の異動を反映しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const duplicate = useMutation({
    mutationFn: () => post<{ id: number }>(`/placement/${scenarioId}/duplicate`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["placement"] });
      toast("シミュレーションを複製しました");
      setMoves(null);
      navigate(`/placement/${r.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/placement/${scenarioId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["placement"] });
      toast("シミュレーションを削除しました");
      navigate("/placement");
    },
  });
  const saveMeta = useMutation({
    mutationFn: () =>
      patch(`/placement/${scenarioId}`, { ...meta, effectiveDate: meta?.effectiveDate || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["placement"] });
      setMeta(null);
      toast("保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (scenario.isLoading || members.isLoading || masters.isLoading || !moves) return <Loading />;
  if (scenario.error) return <ErrorBox error={scenario.error} />;
  const s = scenario.data!.scenario;
  const roots = buildDeptTree(masters.data?.departments ?? []);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/placement" className="text-xs text-ink-3 hover:text-ai-700">
            配置シミュレーション
          </Link>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-[22px] font-bold">
            {s.name}
            {readOnly ? <Badge tone="wakaba">反映済み</Badge> : <Badge tone="ai">検討中</Badge>}
          </h1>
          <p className="mt-1 text-[13px] text-ink-2">
            発令予定日 {s.effectiveDate ? formatDateJa(s.effectiveDate) : "未定"}
            {s.description && <span className="ml-3">{s.description}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <span className="text-xs text-ink-3" aria-live="polite">
              {save.isPending || dirty
                ? "保存しています"
                : savedAt
                  ? `${savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} に保存しました`
                  : "変更は自動で保存されます"}
            </span>
          )}
          {!readOnly && (
            <Button
              size="sm"
              icon={<Pencil className="size-3.5" />}
              onClick={() =>
                setMeta({ name: s.name, description: s.description, effectiveDate: s.effectiveDate ?? "" })
              }
            >
              名前・発令日
            </Button>
          )}
          <Button
            size="sm"
            icon={<Copy className="size-3.5" />}
            loading={duplicate.isPending}
            onClick={() => duplicate.mutate()}
          >
            複製
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="削除"
            onClick={async () => {
              if (
                await confirm({
                  title: "このシミュレーションを削除しますか？",
                  message: "本番のデータには影響しません。",
                  confirmLabel: "削除",
                  danger: true,
                })
              )
                remove.mutate();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
          {me.capabilities.applyPlacement && !readOnly && (
            <Button
              variant="accent"
              icon={<Upload className="size-4" />}
              disabled={changes.length === 0}
              loading={apply.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `${changes.length}名の異動を本番に反映しますか？`,
                    message: `所属・役職が書き換わり、発令日（${s.effectiveDate ? formatDateJa(s.effectiveDate) : "今日"}）付けで異動履歴が残ります。反映後はこのシミュレーションを編集できません。`,
                    confirmLabel: "本番に反映する",
                  })
                )
                  apply.mutate();
              }}
            >
              本番に反映
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="mb-4 rounded-md bg-wakaba-100 px-4 py-2.5 text-sm text-wakaba">
          {formatDateTimeJa(s.appliedAt)} に本番へ反映しました。内容は閲覧のみです。
        </p>
      )}

      <div>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-60">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                aria-label="社員を探す"
                placeholder="社員を探す"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Checkbox label="顔を表示" checked={showFaces} onChange={(e) => setShowFaces(e.target.checked)} />
            {!readOnly && (
              <p className="text-xs text-ink-3">
                顔を別の部署へドラッグすると異動案になります。顔を選ぶと異動先と役職を指定できます。
              </p>
            )}
            <Button
              className="ml-auto"
              variant={showChanges ? "primary" : "secondary"}
              aria-expanded={showChanges}
              aria-controls="placement-changes"
              onClick={() => setShowChanges((v) => !v)}
            >
              異動案
              <span className="tabular rounded bg-yamabuki px-1.5 text-[12px] text-ink">
                {changes.length}名
              </span>
            </Button>
          </div>
          <div className="overflow-x-auto pb-4">
            <div className="min-w-fit">
              <OrgBoard
                roots={roots}
                membersByDept={board}
                showFaces={showFaces}
                editable={!readOnly}
                deltas={deltas}
                highlightIds={highlight}
                minColumn={196}
                onDropMember={(memberId, deptId) => {
                  const cur = moves.get(memberId);
                  setMove(memberId, { toDepartmentId: deptId, toJobTitleId: cur?.toJobTitleId ?? null });
                }}
                onMemberClick={(m) => setEditing(memberMap.get(m.id) ?? null)}
              />
            </div>
          </div>
        </div>

        {showChanges && (
          <aside
            id="placement-changes"
            className="fixed top-14 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-line bg-white shadow-[-12px_0_32px_-16px_rgba(15,29,48,.35)]"
          >
            <section className="flex min-h-0 flex-1 flex-col">
              <header className="flex items-center justify-between border-b border-line-2 px-4 py-2.5">
                <h2 className="text-[15px] font-bold">
                  異動案 <span className="tabular ml-1 text-sm font-normal">{changes.length}名</span>
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setShowChanges(false)}>
                  閉じる
                </Button>
              </header>
              {changes.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-ink-3">
                  まだ異動はありません。組織図の顔をドラッグして始めましょう。
                </p>
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-line-2 overflow-y-auto">
                  {changes.map((c) => (
                    <li key={c.member.id} className="flex items-start gap-2.5 px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => setEditing(c.member)}
                        className="shrink-0"
                        aria-label={`${c.member.lastName} ${c.member.firstName}の異動先を変える`}
                      >
                        <Face member={c.member} size={36} className="ring-2 ring-yamabuki" />
                      </button>
                      <div className="min-w-0 flex-1 text-[13px]">
                        <div className="font-bold">
                          {c.member.lastName} {c.member.firstName}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-ink-2">
                          <span className="truncate">{c.from}</span>
                          <ArrowRight className="size-3 shrink-0 text-ink-3" aria-label="から" />
                          <span className="truncate font-bold text-ink">{c.to}</span>
                        </div>
                        {c.fromJt !== c.toJt && (
                          <div className="text-xs text-ink-3">
                            {c.fromJt ?? "—"} → <span className="font-bold text-ink-2">{c.toJt ?? "—"}</span>
                          </div>
                        )}
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setMove(c.member.id, null)}
                          aria-label="元に戻す"
                          title="元に戻す"
                          className="rounded p-1 text-ink-3 hover:bg-ai-50 hover:text-ink"
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        )}
      </div>

      <MoveDialog
        member={editing}
        move={editing ? moves.get(editing.id) : undefined}
        readOnly={readOnly}
        onClose={() => setEditing(null)}
        onApply={(mv) => {
          if (editing) setMove(editing.id, mv);
          setEditing(null);
        }}
      />

      <Modal
        open={!!meta}
        onClose={() => setMeta(null)}
        title="名前・発令日を編集"
        footer={
          <>
            <Button onClick={() => setMeta(null)}>キャンセル</Button>
            <Button
              variant="primary"
              loading={saveMeta.isPending}
              disabled={!meta?.name.trim()}
              onClick={() => saveMeta.mutate()}
            >
              保存
            </Button>
          </>
        }
      >
        {meta && (
          <div className="space-y-4">
            <Field label="名前" required htmlFor="pm-name">
              <Input
                id="pm-name"
                value={meta.name}
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              />
            </Field>
            <Field label="発令予定日" htmlFor="pm-date">
              <Input
                id="pm-date"
                type="date"
                className="max-w-48"
                value={meta.effectiveDate}
                onChange={(e) => setMeta({ ...meta, effectiveDate: e.target.value })}
              />
            </Field>
            <Field label="メモ" htmlFor="pm-desc">
              <Textarea
                id="pm-desc"
                rows={3}
                value={meta.description}
                onChange={(e) => setMeta({ ...meta, description: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MoveDialog({
  member,
  move,
  readOnly,
  onClose,
  onApply,
}: {
  member: MemberSummary | null;
  move: Move | undefined;
  readOnly: boolean;
  onClose: () => void;
  onApply: (m: Move | null) => void;
}) {
  const masters = useMasters();
  const [dept, setDept] = useState<number | null>(null);
  const [jt, setJt] = useState<number | null>(null);
  useEffect(() => {
    if (member) {
      setDept(move?.toDepartmentId ?? member.departmentId);
      setJt(move?.toJobTitleId ?? member.jobTitleId);
    }
  }, [member, move]);
  return (
    <Modal
      open={!!member}
      onClose={onClose}
      title="異動先を指定"
      size="sm"
      footer={
        readOnly ? (
          <Button onClick={onClose}>閉じる</Button>
        ) : (
          <>
            {move && (
              <Button variant="ghost" className="mr-auto" onClick={() => onApply(null)}>
                元に戻す
              </Button>
            )}
            <Button onClick={onClose}>キャンセル</Button>
            <Button variant="primary" onClick={() => onApply({ toDepartmentId: dept, toJobTitleId: jt })}>
              決定
            </Button>
          </>
        )
      }
    >
      {member && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Face member={member} size={48} />
            <div>
              <div className="font-bold">
                {member.lastName} {member.firstName}
              </div>
              <div className="text-xs text-ink-3">
                現在：{member.departmentName ?? "所属なし"} / {member.jobTitleName ?? "役職なし"}
              </div>
            </div>
          </div>
          <Field label="異動先の部署" htmlFor="mv-dept">
            <DepartmentSelect id="mv-dept" value={dept} onChange={setDept} placeholder="所属なし" />
          </Field>
          <Field label="役職" htmlFor="mv-jt">
            <Select
              id="mv-jt"
              value={jt ?? ""}
              disabled={readOnly}
              onChange={(e) => setJt(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">役職なし</option>
              {masters.data?.jobTitles.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Modal>
  );
}
