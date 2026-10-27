import { Search, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { normalizeForSearch } from "../../../shared/text";
import { type BoardMember, groupByDept, OrgBoard } from "../../components/OrgBoard";
import { DepartmentSelect } from "../../components/pickers";
import { Button, Checkbox, ErrorBox, Input, Loading, PageHeader, Segmented } from "../../components/ui";
import { buildDeptTree, type DeptNode, useAllMembers, useAuth, useMasters } from "../../lib/queries";

function findNode(roots: DeptNode[], id: number): DeptNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const f = findNode(r.children, id);
    if (f) return f;
  }
  return null;
}

export default function OrgTreePage() {
  const me = useAuth();
  const masters = useMasters();
  const members = useAllMembers();
  const [showFaces, setShowFaces] = useState(true);
  const [size, setSize] = useState<"s" | "m">("s");
  const [rootId, setRootId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const roots = useMemo(() => {
    if (!masters.data) return [];
    const tree = buildDeptTree(masters.data.departments);
    if (rootId) {
      const n = findNode(tree, rootId);
      return n ? [{ ...n, depth: 0 }] : tree;
    }
    return tree;
  }, [masters.data, rootId]);

  const board = useMemo(() => {
    const ranks = new Map(masters.data?.jobTitles.map((j) => [j.id, j.rank]));
    const list: BoardMember[] = (members.data ?? []).map((m) => ({
      ...m,
      jobRank: m.jobTitleId ? (ranks.get(m.jobTitleId) ?? 0) : 0,
    }));
    return groupByDept(list);
  }, [members.data, masters.data]);

  const highlight = useMemo(() => {
    const term = normalizeForSearch(q);
    if (!term) return new Set<number>();
    return new Set(
      (members.data ?? [])
        .filter((m) =>
          normalizeForSearch(
            `${m.lastName}${m.firstName}${m.lastNameKana}${m.firstNameKana}${m.employeeCode}`,
          ).includes(term),
        )
        .map((m) => m.id),
    );
  }, [q, members.data]);

  useEffect(() => {
    const first = [...highlight][0];
    if (!first) return;
    document.querySelector(`[data-member-id="${first}"]`)?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
  }, [highlight]);

  if (masters.isLoading || members.isLoading) return <Loading />;
  if (masters.error || members.error) return <ErrorBox error={masters.error ?? members.error} />;

  const total = members.data?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="組織ツリー"
        description={`部署ごとのメンバーを顔で確認できます。現在 ${total}名（在籍・休職）。顔を選ぶとプロフィールを開きます。`}
        actions={
          me.capabilities.usePlacement ? (
            <Link to="/placement">
              <Button icon={<Shuffle className="size-4" />}>配置シミュレーションで検討する</Button>
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="ツリーの中で社員を探す"
            placeholder="ツリーの中で社員を探す"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {q && <span className="text-xs text-ink-2">{highlight.size}名が該当</span>}
        <DepartmentSelect className="w-56" value={rootId} onChange={setRootId} placeholder="全社を表示" />
        <Checkbox label="顔を表示" checked={showFaces} onChange={(e) => setShowFaces(e.target.checked)} />
        {showFaces && (
          <Segmented
            label="顔の大きさ"
            value={size}
            onChange={setSize}
            options={[
              { value: "s", label: "小" },
              { value: "m", label: "大" },
            ]}
          />
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
            すべて開く
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setCollapsed(
                new Set(
                  (masters.data?.departments ?? []).filter((d) => d.parentId !== null).map((d) => d.id),
                ),
              )
            }
          >
            本部だけ表示
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto pb-4">
        <div className="min-w-fit">
          <OrgBoard
            roots={roots}
            membersByDept={board}
            showFaces={showFaces}
            faceSize={size === "s" ? 34 : 48}
            highlightIds={highlight}
            collapsed={collapsed}
            onToggle={(id) =>
              setCollapsed((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
