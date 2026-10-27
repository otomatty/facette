import { type DragEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { MemberSummary } from "../../shared/types";
import type { DeptNode } from "../lib/queries";
import { Face } from "./Face";
import { cx } from "./ui";

export type BoardMember = MemberSummary & { moved?: boolean; jobRank?: number };

export const DRAG_MIME = "application/x-facette-member";

type Props = {
  roots: DeptNode[];
  membersByDept: Map<number, BoardMember[]>;
  showFaces: boolean;
  /** 配置シミュレーション用：ドラッグ＆ドロップ */
  editable?: boolean;
  onDropMember?: (memberId: number, deptId: number) => void;
  onMemberClick?: (m: BoardMember) => void;
  /** 部署ごとの増減（配置シミュレーション） */
  deltas?: Map<number, number>;
  highlightIds?: Set<number>;
  faceSize?: number;
  collapsed?: Set<number>;
  onToggle?: (deptId: number) => void;
  /** 本部の列の最小幅（px） */
  minColumn?: number;
};

function countSubtree(node: DeptNode, map: Map<number, BoardMember[]>): number {
  return (map.get(node.id)?.length ?? 0) + node.children.reduce((s, c) => s + countSubtree(c, map), 0);
}

function headOf(list: BoardMember[]): BoardMember | undefined {
  return [...list].sort((a, b) => (b.jobRank ?? 0) - (a.jobRank ?? 0))[0];
}

function DeptCard({ node, depth, props }: { node: DeptNode; depth: number; props: Props }) {
  const {
    membersByDept,
    showFaces,
    editable,
    onDropMember,
    onMemberClick,
    deltas,
    highlightIds,
    faceSize = 34,
  } = props;
  const [over, setOver] = useState(false);
  const [flash, setFlash] = useState(0);
  const members = membersByDept.get(node.id) ?? [];
  const total = countSubtree(node, membersByDept);
  const head = headOf(members);
  const delta = deltas?.get(node.id) ?? 0;
  const collapsed = props.collapsed?.has(node.id);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = Number(e.dataTransfer.getData(DRAG_MIME));
    if (id && onDropMember) {
      onDropMember(id, node.id);
      setFlash((f) => f + 1);
    }
  };

  const faceEl = (m: BoardMember, asHead = false): ReactNode => {
    const ring = m.moved ? "ring-2 ring-yamabuki" : highlightIds?.has(m.id) ? "ring-2 ring-ai-500" : "";
    const label = `${m.lastName} ${m.firstName}${m.jobTitleName && m.jobTitleName !== "メンバー" ? `（${m.jobTitleName}）` : ""}`;
    const inner = asHead ? (
      <span className="flex min-w-0 items-center gap-2 text-left">
        <Face member={m} size={faceSize + 6} className={ring} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold">
            {m.lastName} {m.firstName}
          </span>
          <span className="block truncate text-[11px] text-ink-3">{m.jobTitleName}</span>
        </span>
      </span>
    ) : (
      <Face member={m} size={faceSize} className={ring} />
    );
    if (editable) {
      return (
        <button
          key={m.id}
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, String(m.id));
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => onMemberClick?.(m)}
          title={label}
          aria-label={`${label}を異動させる`}
          data-member-id={m.id}
          className={cx("cursor-grab rounded-[5px] active:cursor-grabbing", asHead && "min-w-0")}
        >
          {inner}
        </button>
      );
    }
    return (
      <Link
        key={m.id}
        to={`/members/${m.id}`}
        title={label}
        aria-label={label}
        data-member-id={m.id}
        className={cx("rounded-[5px]", asHead && "group min-w-0 hover:text-ai-700")}
      >
        {inner}
      </Link>
    );
  };

  // 役職が最上位で一人に決まるときは、その人を部署の長として名前つきで表示する
  const showHead = !!head && (head.jobRank ?? 0) > 0 && (members[1]?.jobRank ?? -1) < (head.jobRank ?? 0);
  const rest = showHead ? members.filter((m) => m.id !== head!.id) : members;

  return (
    <div
      className={cx(
        "rounded-lg border bg-white transition-[border-color,box-shadow]",
        depth === 0 ? "border-ai-700" : "border-line",
        over && "border-yamabuki bg-yamabuki-50 ring-2 ring-yamabuki-100",
      )}
      onDragOver={
        editable
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(true);
            }
          : undefined
      }
      onDragLeave={editable ? () => setOver(false) : undefined}
      onDrop={editable ? onDrop : undefined}
      data-dept-id={node.id}
    >
      <div
        key={flash}
        className={cx(
          "flex items-center justify-between gap-2 rounded-t-lg px-3 py-2",
          depth === 0 ? "bg-ai-800 text-white" : depth === 1 ? "bg-ai-50" : "",
          flash > 0 && "animate-drop-flash",
        )}
      >
        <div className="min-w-0">
          <div className={cx("truncate font-bold", depth <= 1 ? "text-[14px]" : "text-[13px]")}>
            {node.name}
          </div>
          {head && !showFaces && (
            <div className={cx("truncate text-[11px]", depth === 0 ? "text-ai-200" : "text-ink-3")}>
              {head.jobTitleName} {head.lastName} {head.firstName}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {delta !== 0 && (
            <span
              className={cx(
                "tabular rounded px-1.5 text-[11px] font-bold",
                delta > 0 ? "bg-yamabuki-100 text-[#7a5408]" : "bg-line-2 text-ink-2",
              )}
            >
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
          <span
            className={cx("tabular text-[12px]", depth === 0 ? "text-ai-100" : "text-ink-2")}
            title={
              node.children.length
                ? `配下を含む ${total}名（直属 ${members.length}名）`
                : `${members.length}名`
            }
          >
            <span className="font-bold">{total}</span>名
          </span>
          {node.children.length > 0 && props.onToggle && depth > 0 && (
            <button
              type="button"
              onClick={() => props.onToggle?.(node.id)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? `${node.name}の配下を開く` : `${node.name}の配下を閉じる`}
              className="rounded px-1 text-[11px] text-ink-3 hover:bg-white hover:text-ink"
            >
              {collapsed ? "開く" : "閉じる"}
            </button>
          )}
        </div>
      </div>
      {showFaces && members.length > 0 && (
        <div className="px-3 pt-2 pb-3">
          {showHead && <div className="mb-2">{faceEl(head!, true)}</div>}
          {rest.length > 0 && <div className="flex flex-wrap gap-1.5">{rest.map((m) => faceEl(m))}</div>}
        </div>
      )}
      {showFaces && members.length === 0 && (
        <p className="px-3 pt-1 pb-3 text-[11px] text-ink-3">
          {editable ? "ここに顔をドロップして配置" : "直属のメンバーはいません"}
        </p>
      )}
    </div>
  );
}

function Subtree({ node, depth, props }: { node: DeptNode; depth: number; props: Props }) {
  const collapsed = props.collapsed?.has(node.id);
  return (
    <div>
      <DeptCard node={node} depth={depth} props={props} />
      {!collapsed && node.children.length > 0 && (
        <div className="mt-2 ml-2 space-y-2 border-l-2 border-line pl-2">
          {node.children.map((c) => (
            <Subtree key={c.id} node={c} depth={depth + 1} props={props} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 組織ツリー：最上位の組織を上に置き、その配下（本部）を列として並べ、
 * さらに下位の部署は列の中で入れ子にして縦に積む。
 */
export function OrgBoard(props: Props) {
  return (
    <div className="space-y-4">
      {props.roots.map((root) => (
        <div key={root.id}>
          <div className="mx-auto max-w-xl">
            <DeptCard node={root} depth={0} props={props} />
          </div>
          {root.children.length > 0 && (
            <>
              <div className="mx-auto h-4 w-0.5 bg-line" aria-hidden />
              <div
                className="grid gap-4 border-t-2 border-line pt-4"
                style={{
                  gridTemplateColumns: `repeat(${root.children.length}, minmax(${props.minColumn ?? 200}px, 1fr))`,
                }}
              >
                {root.children.map((c) => (
                  <Subtree key={c.id} node={c} depth={1} props={props} />
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** 社員一覧から部署ごとの Map を作る（役職ランク順） */
export function groupByDept(members: BoardMember[]): Map<number, BoardMember[]> {
  const map = new Map<number, BoardMember[]>();
  for (const m of members) {
    if (m.departmentId === null) continue;
    const list = map.get(m.departmentId) ?? [];
    list.push(m);
    map.set(m.departmentId, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (b.jobRank ?? 0) - (a.jobRank ?? 0) ||
        a.lastNameKana.localeCompare(b.lastNameKana, "ja") ||
        a.id - b.id,
    );
  }
  return map;
}
