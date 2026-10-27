import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CONDITION_LABELS, EVAL_STEP_LABELS, SKILL_LEVEL_LABELS } from "../../../shared/constants";
import { formatDateJa, todayJst } from "../../../shared/dates";
import type {
  EvaluationSheetSummary,
  MemberDetail,
  MemberSkill,
  MemberTransfer,
  OneOnOne,
} from "../../../shared/types";
import { MemberChip } from "../../components/Face";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
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
import { queryClient, useSkills } from "../../lib/queries";

export function LevelDots({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`レベル${level}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cx("h-2 w-3 rounded-sm", i < level ? "bg-ai-600" : "bg-line")} />
      ))}
    </span>
  );
}

export function SkillsTab({
  memberId,
  editable,
  compact,
}: {
  memberId: number;
  editable?: boolean;
  compact?: boolean;
}) {
  const toast = useToast();
  const all = useSkills();
  const { data, isLoading } = useQuery({
    queryKey: ["member", memberId, "skills"],
    queryFn: () => get<{ items: MemberSkill[] }>(`/members/${memberId}/skills`),
  });
  const [editing, setEditing] = useState<Map<number, number> | null>(null);
  const save = useMutation({
    mutationFn: () =>
      put(`/members/${memberId}/skills`, {
        skills: [...(editing ?? new Map()).entries()].map(([skillId, level]) => ({ skillId, level })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member", memberId, "skills"] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setEditing(null);
      toast("スキルを保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const grouped = useMemo(() => {
    const g = new Map<string, MemberSkill[]>();
    for (const s of data?.items ?? []) g.set(s.category, [...(g.get(s.category) ?? []), s]);
    return [...g.entries()];
  }, [data]);
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];

  if (compact) {
    if (!items.length) return <p className="text-sm text-ink-3">登録されていません。</p>;
    return (
      <ul className="flex flex-wrap gap-1.5">
        {items.slice(0, 12).map((s) => (
          <li
            key={s.skillId}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[13px]"
          >
            {s.name}
            <span className="tabular text-[11px] font-bold text-ai-700">Lv{s.level}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (editing) {
    const categories = [...new Set((all.data ?? []).map((s) => s.category))];
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">スキルを編集</h2>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(null)}>
              キャンセル
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              保存
            </Button>
          </div>
        </div>
        <p className="mb-4 text-xs text-ink-3">
          レベルの目安：
          {Object.entries(SKILL_LEVEL_LABELS)
            .map(([k, v]) => `${k} ${v}`)
            .join(" ／ ")}
        </p>
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {categories.map((cat) => (
            <fieldset key={cat}>
              <legend className="mb-2 text-[13px] font-bold text-ink-2">{cat}</legend>
              <ul className="space-y-1.5">
                {(all.data ?? [])
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <li key={s.id} className="flex items-center gap-3">
                      <span className="w-40 truncate text-sm">{s.name}</span>
                      <Select
                        aria-label={`${s.name}のレベル`}
                        className="h-8 w-40"
                        value={editing.get(s.id) ?? ""}
                        onChange={(e) => {
                          const next = new Map(editing);
                          if (e.target.value) next.set(s.id, Number(e.target.value));
                          else next.delete(s.id);
                          setEditing(next);
                        }}
                      >
                        <option value="">なし</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            Lv{n} {SKILL_LEVEL_LABELS[n]}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
              </ul>
            </fieldset>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-bold">スキル</h2>
        {editable && (
          <Button
            size="sm"
            icon={<Pencil className="size-3.5" />}
            onClick={() => setEditing(new Map(items.map((s) => [s.skillId, s.level])))}
          >
            編集
          </Button>
        )}
      </div>
      {!items.length ? (
        <EmptyState title="スキルが登録されていません">
          {editable ? "「編集」から得意なことを登録しましょう。" : null}
        </EmptyState>
      ) : (
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          {grouped.map(([cat, list]) => (
            <div key={cat}>
              <h3 className="mb-2 text-[13px] font-bold text-ink-2">{cat}</h3>
              <ul className="space-y-2">
                {list.map((s) => (
                  <li key={s.skillId} className="flex items-center gap-3 text-sm">
                    <span className="w-40 truncate">{s.name}</span>
                    <LevelDots level={s.level} />
                    <span className="text-xs text-ink-3">{SKILL_LEVEL_LABELS[s.level]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TransferTimeline({ items, hireDate }: { items: MemberTransfer[]; hireDate: string | null }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-line-2 pl-5">
      {items.map((t) => (
        <li key={t.id} className="relative">
          <span className="absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-white bg-ai-500" />
          <p className="tabular text-xs text-ink-3">{formatDateJa(t.effectiveDate)}</p>
          <p className="text-sm">
            {t.fromDepartmentName !== t.toDepartmentName ? (
              <>
                <span className="text-ink-2">{t.fromDepartmentName ?? "所属なし"}</span>
                <span className="mx-1.5 text-ink-3">から</span>
                <span className="font-bold">{t.toDepartmentName ?? "所属なし"}</span>
              </>
            ) : (
              <span className="font-bold">{t.toDepartmentName}</span>
            )}
            {t.fromJobTitleName !== t.toJobTitleName && t.toJobTitleName && (
              <span className="ml-2 text-ink-2">
                {t.fromJobTitleName ?? "—"} → <span className="font-bold text-ink">{t.toJobTitleName}</span>
              </span>
            )}
          </p>
          {t.note && <p className="text-xs text-ink-3">{t.note}</p>}
        </li>
      ))}
      {hireDate && (
        <li className="relative">
          <span className="absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-white bg-yamabuki" />
          <p className="tabular text-xs text-ink-3">{formatDateJa(hireDate)}</p>
          <p className="text-sm font-bold">入社</p>
        </li>
      )}
    </ol>
  );
}

const RANK_TONE: Record<string, "ai" | "wakaba" | "yamabuki" | "beni" | "neutral"> = {
  S: "wakaba",
  A: "ai",
  B: "neutral",
  C: "yamabuki",
  D: "beni",
};

export function EvaluationHistory({ memberId }: { memberId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["member", memberId, "evaluations"],
    queryFn: () => get<{ items: EvaluationSheetSummary[] }>(`/evaluations/history/${memberId}`),
  });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  return (
    <section className="rounded-lg border border-line bg-white">
      {items.length === 0 ? (
        <EmptyState title="表示できる評価はありません" />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-3">
            <tr>
              <th className="px-5 py-2 font-normal">評価期間</th>
              <th className="px-3 py-2 font-normal">進捗</th>
              <th className="px-3 py-2 font-normal">一次評価者</th>
              <th className="px-3 py-2 text-right font-normal">総合点</th>
              <th className="px-5 py-2 text-right font-normal">ランク</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {items.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3">
                  <Link to={`/evaluations/sheets/${s.id}`} className="font-bold hover:text-ai-700">
                    {s.periodName}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <Badge tone={s.step === "done" ? "wakaba" : "ai"}>{EVAL_STEP_LABELS[s.step]}</Badge>
                </td>
                <td className="px-3 py-3 text-ink-2">
                  {s.firstEvaluator ? `${s.firstEvaluator.lastName} ${s.firstEvaluator.firstName}` : "—"}
                </td>
                <td className="tabular px-3 py-3 text-right">{s.finalScore ?? "—"}</td>
                <td className="px-5 py-3 text-right">
                  {s.finalRank ? (
                    <Badge tone={RANK_TONE[s.finalRank] ?? "neutral"}>{s.finalRank}</Badge>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type OneOnOneForm = {
  heldOn: string;
  title: string;
  notes: string;
  nextActions: string;
  condition: number | null;
  sharedWithMember: boolean;
};

export function OneOnOneEditor({
  open,
  onClose,
  memberId,
  record,
}: {
  open: boolean;
  onClose: () => void;
  memberId: number;
  record?: OneOnOne;
}) {
  const toast = useToast();
  const [form, setForm] = useState<OneOnOneForm>(() => ({
    heldOn: record?.heldOn ?? todayJst(),
    title: record?.title ?? "",
    notes: record?.notes ?? "",
    nextActions: record?.nextActions ?? "",
    condition: record?.condition ?? null,
    sharedWithMember: record?.sharedWithMember ?? true,
  }));
  const save = useMutation({
    mutationFn: () =>
      record ? patch(`/one-on-ones/${record.id}`, form) : post("/one-on-ones", { ...form, memberId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["one-on-ones"] });
      toast("面談記録を保存しました");
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record ? "面談記録を編集" : "面談を記録"}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.title.trim()}
            onClick={() => save.mutate()}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Field label="実施日" required htmlFor="oo-date">
          <Input
            id="oo-date"
            type="date"
            value={form.heldOn}
            onChange={(e) => setForm({ ...form, heldOn: e.target.value })}
          />
        </Field>
        <Field label="テーマ" required htmlFor="oo-title">
          <Input
            id="oo-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例：今期の目標のすり合わせ"
          />
        </Field>
        <Field label="話したこと" className="sm:col-span-2" htmlFor="oo-notes">
          <Textarea
            id="oo-notes"
            rows={6}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <Field label="次のアクション" className="sm:col-span-2" htmlFor="oo-next">
          <Textarea
            id="oo-next"
            rows={3}
            value={form.nextActions}
            onChange={(e) => setForm({ ...form, nextActions: e.target.value })}
          />
        </Field>
        <Field label="本人のコンディション" help="本人には表示されません" htmlFor="oo-cond">
          <Select
            id="oo-cond"
            value={form.condition ?? ""}
            onChange={(e) => setForm({ ...form, condition: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">記録しない</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} {CONDITION_LABELS[n]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label="本人にも共有する"
            checked={form.sharedWithMember}
            onChange={(e) => setForm({ ...form, sharedWithMember: e.target.checked })}
          />
        </div>
      </div>
    </Modal>
  );
}

const CONDITION_TONE = ["", "beni", "yamabuki", "neutral", "ai", "wakaba"] as const;

export function OneOnOneCard({ o, showMember }: { o: OneOnOne; showMember?: boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/one-on-ones/${o.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["one-on-ones"] });
      toast("面談記録を削除しました");
    },
  });
  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-xs text-ink-3">{formatDateJa(o.heldOn)}</p>
          <h3 className="text-[15px] font-bold">{o.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {o.condition !== null && (
            <Badge tone={CONDITION_TONE[o.condition] as "ai"}>
              コンディション {CONDITION_LABELS[o.condition]}
            </Badge>
          )}
          {!o.sharedWithMember && <Badge>本人に非公開</Badge>}
          {o.canEdit && (
            <>
              <Button size="sm" variant="ghost" aria-label="編集" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="削除"
                onClick={async () => {
                  if (
                    await confirm({
                      title: "この面談記録を削除しますか？",
                      confirmLabel: "削除",
                      danger: true,
                    })
                  )
                    remove.mutate();
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </header>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {showMember && <MemberChip member={o.member} size={28} sub="対象者" />}
        {o.interviewer && <MemberChip member={o.interviewer} size={28} sub="面談者" />}
      </div>
      {o.notes && (
        <p className="mt-3 max-w-[72ch] text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{o.notes}</p>
      )}
      {o.nextActions && (
        <div className="mt-3 rounded-md bg-ai-50 px-3 py-2 text-sm">
          <span className="mr-2 text-xs font-bold text-ai-800">次のアクション</span>
          <span className="whitespace-pre-wrap">{o.nextActions}</span>
        </div>
      )}
      {editing && <OneOnOneEditor open onClose={() => setEditing(false)} memberId={o.memberId} record={o} />}
    </article>
  );
}

export function OneOnOneTab({ member, canCreate }: { member: MemberDetail; canCreate: boolean }) {
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["one-on-ones", "member", member.id],
    queryFn: () => get<{ items: OneOnOne[] }>(`/one-on-ones?memberId=${member.id}`),
  });
  return (
    <div>
      {canCreate && (
        <div className="mb-4 flex justify-end">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            面談を記録
          </Button>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState title="面談の記録はまだありません" />
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((o) => (
            <OneOnOneCard key={o.id} o={o} />
          ))}
        </div>
      )}
      {creating && <OneOnOneEditor open onClose={() => setCreating(false)} memberId={member.id} />}
    </div>
  );
}
