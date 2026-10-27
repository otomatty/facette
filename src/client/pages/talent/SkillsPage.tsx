import { useQuery } from "@tanstack/react-query";
import { Search, Settings2, Sparkles, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SKILL_LEVEL_LABELS } from "../../../shared/constants";
import type { MemberSummary, Skill } from "../../../shared/types";
import { Face } from "../../components/Face";
import {
  cx,
  EmptyState,
  ErrorBox,
  IconButton,
  Input,
  Loading,
  PageHeader,
  Segmented,
} from "../../components/ui";
import { get } from "../../lib/api";
import { useAuth, useSkills } from "../../lib/queries";
import { LevelDots } from "../members/ProfileTabs";

type SkillMap = {
  divisions: { id: number; name: string }[];
  cells: { skillId: number; divisionId: number; holders: number; total: number; average: number }[];
};

type Holder = { member: MemberSummary; level: number };

/** 保有者数の量を藍の濃淡で表す（数値は必ず文字でも出す） */
const HEAT_STEPS = [
  { max: 0.2, cls: "bg-ai-50 text-ink" },
  { max: 0.4, cls: "bg-ai-100 text-ink" },
  { max: 0.6, cls: "bg-ai-200 text-ink" },
  { max: 0.8, cls: "bg-ai-300 text-ai-950" },
  { max: 1, cls: "bg-ai-600 text-white" },
];

function heatClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "text-ink-3";
  const r = value / max;
  return (HEAT_STEPS.find((s) => r <= s.max) ?? HEAT_STEPS[HEAT_STEPS.length - 1]!).cls;
}

export default function SkillsPage() {
  const me = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const skills = useSkills();
  const map = useQuery({ queryKey: ["skills", "map"], queryFn: () => get<SkillMap>("/skills/map") });
  const selectedId = params.get("skill") ? Number(params.get("skill")) : null;

  const select = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id === null) next.delete("skill");
    else next.set("skill", String(id));
    setParams(next, { replace: true });
  };

  const { cellOf, rowTotal, maxCell } = useMemo(() => {
    const cellOf = new Map<string, number>();
    const rowTotal = new Map<number, number>();
    let maxCell = 0;
    for (const c of map.data?.cells ?? []) {
      cellOf.set(`${c.skillId}:${c.divisionId}`, c.holders);
      rowTotal.set(c.skillId, (rowTotal.get(c.skillId) ?? 0) + c.holders);
      if (c.divisionId !== 0) maxCell = Math.max(maxCell, c.holders);
    }
    return { cellOf, rowTotal, maxCell };
  }, [map.data]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const g = new Map<string, Skill[]>();
    for (const s of skills.data ?? []) {
      if (term && !s.name.toLowerCase().includes(term) && !s.category.toLowerCase().includes(term)) continue;
      g.set(s.category, [...(g.get(s.category) ?? []), s]);
    }
    return [...g.entries()];
  }, [skills.data, q]);

  const divisions = map.data?.divisions ?? [];
  // 本部に属さない社員（全社直下・所属なし）がいれば「その他」の列を出す
  const hasOther = (map.data?.cells ?? []).some((c) => c.divisionId === 0 && c.holders > 0);
  const selected = skills.data?.find((s) => s.id === selectedId) ?? null;
  const loading = skills.isLoading || map.isLoading;
  const error = skills.error ?? map.error;

  return (
    <div>
      <PageHeader
        title="スキルマップ"
        description="本部ごとに、一人でできる（レベル3以上）メンバーが何人いるかを示します。スキル名を選ぶと保有者を確認できます。"
        actions={
          me.capabilities.manageTalent && (
            <Link
              to="/settings/skills"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3.5 text-sm font-bold text-ink transition-colors hover:border-ai-200 hover:bg-ai-50"
            >
              <Settings2 className="size-4" />
              スキルを管理
            </Link>
          )
        }
      />

      {loading && <Loading />}
      {error && (
        <ErrorBox
          error={error}
          onRetry={() => {
            skills.refetch();
            map.refetch();
          }}
        />
      )}

      {skills.data && map.data && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 rounded-lg border border-line bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-line-2 p-3">
              <div className="relative min-w-52 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  aria-label="スキル名で絞り込む"
                  placeholder="スキル名で絞り込む"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8"
                />
              </div>
              <HeatLegend />
            </div>

            {groups.length === 0 ? (
              <EmptyState icon={<Sparkles className="size-10" />} title="該当するスキルがありません">
                {q ? "別の言葉で検索してください。" : "スキルが登録されると、ここに表示されます。"}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                  <caption className="sr-only">スキルごと・本部ごとのレベル3以上の保有者数</caption>
                  <thead className="text-xs text-ink-3">
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-line bg-white px-3 py-2 text-left font-normal">
                        スキル
                      </th>
                      {divisions.map((d) => (
                        <th key={d.id} className="border-b border-line px-1 py-2 text-center font-normal">
                          <span className="block leading-tight">{d.name}</span>
                        </th>
                      ))}
                      {hasOther && (
                        <th className="border-b border-line px-1 py-2 text-center font-normal">その他</th>
                      )}
                      <th className="border-b border-l border-line px-3 py-2 text-right font-bold text-ink-2">
                        全社
                      </th>
                    </tr>
                  </thead>
                  {groups.map(([cat, list]) => (
                    <tbody key={cat}>
                      <tr>
                        <th
                          colSpan={divisions.length + (hasOther ? 3 : 2)}
                          scope="colgroup"
                          className="border-b border-line-2 bg-canvas/70 px-3 py-1.5 text-left text-xs font-bold text-ink-2"
                        >
                          {cat}
                        </th>
                      </tr>
                      {list.map((s) => {
                        const active = s.id === selectedId;
                        return (
                          <tr
                            key={s.id}
                            onClick={() => select(active ? null : s.id)}
                            className={cx("group cursor-pointer", active && "[&>td]:bg-yamabuki-50")}
                          >
                            <th
                              scope="row"
                              className={cx(
                                "sticky left-0 z-10 border-b border-line-2 bg-white px-3 py-0 text-left font-normal",
                                active && "bg-yamabuki-50",
                              )}
                            >
                              <button
                                type="button"
                                aria-pressed={active}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  select(active ? null : s.id);
                                }}
                                className={cx(
                                  "flex h-9 w-full max-w-48 items-center gap-2 text-left whitespace-nowrap group-hover:text-ai-700",
                                  active && "font-bold text-ai-800",
                                )}
                              >
                                {active && <span className="h-4 w-1 rounded-full bg-yamabuki" aria-hidden />}
                                <span className="truncate">{s.name}</span>
                              </button>
                            </th>
                            {divisions.map((d) => (
                              <HeatCell
                                key={d.id}
                                value={cellOf.get(`${s.id}:${d.id}`) ?? 0}
                                max={maxCell}
                                label={`${s.name}・${d.name}`}
                              />
                            ))}
                            {hasOther && (
                              <HeatCell
                                value={cellOf.get(`${s.id}:0`) ?? 0}
                                max={maxCell}
                                label={`${s.name}・その他`}
                              />
                            )}
                            <td className="tabular border-b border-l border-line-2 border-l-line px-3 text-right font-bold">
                              {rowTotal.get(s.id) ?? 0}
                              <span className="ml-0.5 text-[11px] font-normal text-ink-3">名</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </section>

          <aside className="lg:sticky lg:top-20">
            {selected ? (
              <HolderPanel skill={selected} onClose={() => select(null)} />
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-white">
                <EmptyState icon={<Users className="size-9" />} title="スキルを選んでください">
                  表のスキル名を選ぶと、そのスキルを持つメンバーをここに表示します。
                </EmptyState>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function HeatCell({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <td className="border-b border-line-2 p-0.5 text-center">
      <span
        title={`${label}：${value}名`}
        className={cx(
          "tabular flex h-8 min-w-12 items-center justify-center rounded-[4px] text-[13px]",
          value > 0 && "font-bold",
          heatClass(value, max),
        )}
      >
        {value}
      </span>
    </td>
  );
}

function HeatLegend() {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-3" aria-hidden>
      <span>少ない</span>
      <span className="flex gap-0.5">
        {HEAT_STEPS.map((s) => (
          <span key={s.cls} className={cx("h-3 w-5 rounded-[2px]", s.cls)} />
        ))}
      </span>
      <span>多い</span>
      <span className="ml-1">数字はレベル3以上の人数</span>
    </div>
  );
}

function HolderPanel({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [minLevel, setMinLevel] = useState<"3" | "1">("3");
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["skills", "holders", skill.id],
    queryFn: () => get<{ items: Holder[] }>(`/skills/${skill.id}/holders`),
  });
  const items = (data?.items ?? []).filter((h) => h.level >= Number(minLevel));
  return (
    <section className="rounded-lg border border-line bg-white" aria-labelledby="holder-title">
      <header className="flex items-start justify-between gap-3 border-b border-line-2 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">{skill.category}</p>
          <h2 id="holder-title" className="truncate text-[15px] font-bold">
            {skill.name}の保有者
          </h2>
          {skill.description && <p className="mt-0.5 text-xs text-ink-2">{skill.description}</p>}
        </div>
        <IconButton label="閉じる" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>
      <div className="flex items-center justify-between gap-2 border-b border-line-2 px-4 py-2">
        <Segmented
          label="表示するレベル"
          value={minLevel}
          onChange={setMinLevel}
          options={[
            { value: "3", label: "レベル3以上" },
            { value: "1", label: "すべて" },
          ]}
        />
        <span className="text-sm text-ink-2">
          <span className="tabular font-bold text-ink">{data ? items.length : "—"}</span> 名
        </span>
      </div>
      {isLoading && <Loading />}
      {error && (
        <div className="p-4">
          <ErrorBox error={error} onRetry={() => refetch()} />
        </div>
      )}
      {data && items.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-ink-3">
          {minLevel === "3"
            ? "レベル3以上の保有者はいません。"
            : "このスキルを登録しているメンバーはいません。"}
        </p>
      )}
      {items.length > 0 && (
        <ul className="max-h-[min(560px,calc(100dvh-280px))] divide-y divide-line-2 overflow-y-auto">
          {items.map(({ member: m, level }) => (
            <li key={m.id}>
              <Link
                to={`/members/${m.id}`}
                className="group flex items-center gap-3 px-4 py-2 hover:bg-ai-50"
              >
                <Face member={m} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold group-hover:text-ai-700">
                    {m.lastName} {m.firstName}
                  </span>
                  <span className="block truncate text-xs text-ink-3">{m.departmentName ?? "所属なし"}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <LevelDots level={level} />
                  <span className="text-[11px] text-ink-3">
                    Lv{level} {SKILL_LEVEL_LABELS[level]}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <footer className="border-t border-line-2 px-4 py-2.5">
        <Link
          to={`/members?skillId=${skill.id}&skillMin=3`}
          className="text-[13px] font-bold text-ai-700 hover:underline"
        >
          メンバー一覧で絞り込む
        </Link>
      </footer>
    </section>
  );
}
