import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Eye, Minus, Plus, Search, SquareDashed, StickyNote, Trash2, Users, X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import type {
  BoardData,
  BoardGroup,
  BoardNote,
  MemberSummary,
  Paged,
  TeamBoard,
} from "../../../shared/types";
import { Face } from "../../components/Face";
import { DRAG_MIME } from "../../components/OrgBoard";
import { DepartmentSelect } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, get, post, put, qs } from "../../lib/api";
import { queryClient, useAllMembers } from "../../lib/queries";

const GRID = 8;
const CARD_W = 96;
const CARD_H = 112;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const uid = () => Math.random().toString(36).slice(2, 10);

const GROUP_COLORS: Record<BoardGroup["color"], { bg: string; border: string; head: string }> = {
  ai: { bg: "bg-ai-50/70", border: "border-ai-200", head: "bg-ai-100 text-ai-800" },
  yamabuki: {
    bg: "bg-yamabuki-50/80",
    border: "border-yamabuki-100",
    head: "bg-yamabuki-100 text-[#7a5408]",
  },
  wakaba: { bg: "bg-wakaba-100/40", border: "border-wakaba-100", head: "bg-wakaba-100 text-wakaba" },
  beni: { bg: "bg-beni-100/40", border: "border-beni-100", head: "bg-beni-100 text-beni" },
  fuji: { bg: "bg-fuji-100/50", border: "border-fuji-100", head: "bg-fuji-100 text-fuji" },
  neutral: { bg: "bg-line-2/60", border: "border-line", head: "bg-line-2 text-ink-2" },
};

type Drag =
  | { kind: "item"; id: number; dx: number; dy: number }
  | {
      kind: "group";
      id: string;
      dx: number;
      dy: number;
      startX: number;
      startY: number;
      members: { id: number; x: number; y: number }[];
      notes: { id: string; x: number; y: number }[];
    }
  | { kind: "resize"; id: string; startW: number; startH: number; px: number; py: number }
  | { kind: "note"; id: string; dx: number; dy: number };

function inside(g: BoardGroup, x: number, y: number) {
  return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
}

export default function BoardEditorPage() {
  const { id } = useParams();
  const boardId = Number(id);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const board = useQuery({
    queryKey: ["board", boardId],
    queryFn: () => get<TeamBoard>(`/boards/${boardId}`),
  });
  const allMembers = useAllMembers();

  const [data, setData] = useState<BoardData | null>(null);
  const [meta, setMeta] = useState<{ name: string; description: string; shared: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<
    { kind: "item"; id: number } | { kind: "group" | "note"; id: string } | null
  >(null);
  const [editingText, setEditingText] = useState<{ kind: "group" | "note"; id: string } | null>(null);
  const [q, setQ] = useState("");
  const [editMeta, setEditMeta] = useState(false);
  const [deptToAdd, setDeptToAdd] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (board.data && data === null) {
      setData(board.data.data);
      setMeta({ name: board.data.name, description: board.data.description, shared: board.data.shared });
    }
  }, [board.data, data]);

  const editable = !!board.data?.isOwner;

  const memberMap = useMemo(() => {
    const map = new Map<number, MemberSummary>();
    for (const m of board.data?.members ?? []) map.set(m.id, m);
    for (const m of allMembers.data ?? []) map.set(m.id, m);
    return map;
  }, [board.data, allMembers.data]);

  const update = useCallback((fn: (d: BoardData) => BoardData) => {
    setData((d) => (d ? fn(d) : d));
    setDirty(true);
  }, []);

  // 自動保存
  const save = useMutation({
    mutationFn: (body: { data: BoardData; name: string; description: string; shared: boolean }) =>
      put(`/boards/${boardId}`, body),
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["boards"] });
    },
    onError: (e) => toast(`保存できませんでした：${errorMessage(e)}`, "error"),
  });
  const saveBoard = save.mutate;
  useEffect(() => {
    if (!dirty || !data || !meta || !editable) return;
    const t = setTimeout(() => {
      setDirty(false);
      saveBoard({ data, ...meta });
    }, 700);
    return () => clearTimeout(t);
  }, [dirty, data, meta, editable, saveBoard]);

  const search = useQuery({
    queryKey: ["board-search", q],
    queryFn: () => get<Paged<MemberSummary>>(`/members${qs({ q, pageSize: 30, sort: "department" })}`),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

  const placed = useMemo(() => new Set(data?.items.map((i) => i.memberId)), [data]);

  /** 空いている場所を探す（右端の外側に並べる） */
  const freeSpot = useCallback(
    (index = 0) => {
      const maxX = Math.max(
        0,
        ...(data?.items.map((i) => i.x + CARD_W) ?? []),
        ...(data?.groups.map((g) => g.x + g.w) ?? []),
      );
      const baseX = data && (data.items.length || data.groups.length) ? snap(maxX + 32) : 40;
      return { x: baseX + (index % 4) * (CARD_W + 16), y: 40 + Math.floor(index / 4) * (CARD_H + 16) };
    },
    [data],
  );

  const addMembers = (ids: number[], at?: { x: number; y: number }) => {
    const fresh = ids.filter((m) => !placed.has(m));
    if (!fresh.length) return;
    update((d) => ({
      ...d,
      items: [
        ...d.items,
        ...fresh.map((memberId, i) => {
          if (at)
            return {
              memberId,
              x: snap(at.x + (i % 4) * (CARD_W + 16)),
              y: snap(at.y + Math.floor(i / 4) * (CARD_H + 16)),
            };
          return { memberId, ...freeSpot(i) };
        }),
      ],
    }));
  };

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };

  // ───────── ポインター操作（移動・リサイズ） ─────────
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !data) return;
    const p = toCanvas(e.clientX, e.clientY);
    if (d.kind === "item") {
      const x = snap(p.x - d.dx);
      const y = snap(p.y - d.dy);
      setData({ ...data, items: data.items.map((i) => (i.memberId === d.id ? { ...i, x, y } : i)) });
    } else if (d.kind === "note") {
      const x = snap(p.x - d.dx);
      const y = snap(p.y - d.dy);
      setData({ ...data, notes: data.notes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) });
    } else if (d.kind === "group") {
      const x = snap(p.x - d.dx);
      const y = snap(p.y - d.dy);
      const ox = x - d.startX;
      const oy = y - d.startY;
      setData({
        ...data,
        groups: data.groups.map((g) => (g.id === d.id ? { ...g, x, y } : g)),
        items: data.items.map((i) => {
          const m = d.members.find((x_) => x_.id === i.memberId);
          return m ? { ...i, x: m.x + ox, y: m.y + oy } : i;
        }),
        notes: data.notes.map((n) => {
          const m = d.notes.find((x_) => x_.id === n.id);
          return m ? { ...n, x: m.x + ox, y: m.y + oy } : n;
        }),
      });
    } else if (d.kind === "resize") {
      const w = Math.max(160, snap(d.startW + (p.x - d.px)));
      const h = Math.max(120, snap(d.startH + (p.y - d.py)));
      setData({ ...data, groups: data.groups.map((g) => (g.id === d.id ? { ...g, w, h } : g)) });
    }
  };
  const onPointerUp = () => {
    if (drag.current) {
      drag.current = null;
      setDirty(true);
    }
  };

  const startItemDrag = (e: ReactPointerEvent, memberId: number) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    const item = data!.items.find((i) => i.memberId === memberId)!;
    const p = toCanvas(e.clientX, e.clientY);
    drag.current = { kind: "item", id: memberId, dx: p.x - item.x, dy: p.y - item.y };
    setSelected({ kind: "item", id: memberId });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const startGroupDrag = (e: ReactPointerEvent, g: BoardGroup) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    // グループの中にある顔とメモも一緒に動かす
    const members = data!.items
      .filter((i) => inside(g, i.x + CARD_W / 2, i.y + CARD_H / 2))
      .map((i) => ({ id: i.memberId, x: i.x, y: i.y }));
    const notes = data!.notes
      .filter((n) => inside(g, n.x + 20, n.y + 20))
      .map((n) => ({ id: n.id, x: n.x, y: n.y }));
    drag.current = {
      kind: "group",
      id: g.id,
      dx: p.x - g.x,
      dy: p.y - g.y,
      startX: g.x,
      startY: g.y,
      members,
      notes,
    };
    setSelected({ kind: "group", id: g.id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const startResize = (e: ReactPointerEvent, g: BoardGroup) => {
    if (!editable) return;
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    drag.current = { kind: "resize", id: g.id, startW: g.w, startH: g.h, px: p.x, py: p.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const startNoteDrag = (e: ReactPointerEvent, n: BoardNote) => {
    if (!editable || e.button !== 0 || editingText?.id === n.id) return;
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    drag.current = { kind: "note", id: n.id, dx: p.x - n.x, dy: p.y - n.y };
    setSelected({ kind: "note", id: n.id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const removeSelected = useCallback(() => {
    if (!selected) return;
    if (selected.kind === "item")
      update((d) => ({ ...d, items: d.items.filter((i) => i.memberId !== selected.id) }));
    if (selected.kind === "group")
      update((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== selected.id) }));
    if (selected.kind === "note")
      update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== selected.id) }));
    setSelected(null);
  }, [selected, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editable || editingText) return;
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editable, editingText, selected, removeSelected]);

  const duplicate = useMutation({
    mutationFn: () => post<{ id: number }>(`/boards/${boardId}/duplicate`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      toast("キャンバスを複製しました");
      setData(null);
      navigate(`/boards/${r.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/boards/${boardId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      toast("キャンバスを削除しました");
      navigate("/boards");
    },
  });

  if (board.isLoading || !data || !meta) return board.error ? <ErrorBox error={board.error} /> : <Loading />;

  const width = Math.max(
    1600,
    ...data.items.map((i) => i.x + CARD_W + 200),
    ...data.groups.map((g) => g.x + g.w + 200),
    ...data.notes.map((n) => n.x + 400),
  );
  const height = Math.max(
    1000,
    ...data.items.map((i) => i.y + CARD_H + 200),
    ...data.groups.map((g) => g.y + g.h + 200),
    ...data.notes.map((n) => n.y + 300),
  );

  const addGroup = () => {
    const spot = freeSpot();
    const g: BoardGroup = {
      id: uid(),
      label: "新しいグループ",
      x: spot.x,
      y: spot.y,
      w: 360,
      h: 280,
      color: "ai",
    };
    update((d) => ({ ...d, groups: [...d.groups, g] }));
    setSelected({ kind: "group", id: g.id });
    setEditingText({ kind: "group", id: g.id });
  };
  const addNote = () => {
    const spot = freeSpot();
    const n: BoardNote = { id: uid(), text: "", x: spot.x, y: spot.y };
    update((d) => ({ ...d, notes: [...d.notes, n] }));
    setSelected({ kind: "note", id: n.id });
    setEditingText({ kind: "note", id: n.id });
  };

  const selectedGroup =
    selected?.kind === "group" ? data.groups.find((g) => g.id === selected.id) : undefined;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-56px)] flex-col lg:-mx-8">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2 lg:px-6">
        <Link to="/boards" className="text-xs text-ink-3 hover:text-ai-700">
          チームキャンバス
        </Link>
        <h1 className="flex min-w-0 items-center gap-2 text-[17px] font-bold">
          <span className="truncate">{meta.name}</span>
          {meta.shared && <Badge tone="ai">共有</Badge>}
          {!editable && (
            <Badge>
              <Eye className="mr-1 size-3" />
              閲覧のみ
            </Badge>
          )}
        </h1>
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => setEditMeta(true)}>
            名前・公開設定
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && (
            <span className="text-xs text-ink-3" aria-live="polite">
              {save.isPending || dirty
                ? "保存しています"
                : savedAt
                  ? `${savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} に保存しました`
                  : "変更は自動で保存されます"}
            </span>
          )}
          {editable && (
            <>
              <Button size="sm" icon={<SquareDashed className="size-4" />} onClick={addGroup}>
                グループ
              </Button>
              <Button size="sm" icon={<StickyNote className="size-4" />} onClick={addNote}>
                メモ
              </Button>
            </>
          )}
          <div className="flex items-center rounded-md border border-line">
            <IconButton
              label="縮小"
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
            >
              <Minus className="size-4" />
            </IconButton>
            <span className="tabular w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <IconButton
              label="拡大"
              onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}
            >
              <Plus className="size-4" />
            </IconButton>
          </div>
          <Button
            size="sm"
            icon={<Copy className="size-4" />}
            loading={duplicate.isPending}
            onClick={() => duplicate.mutate()}
          >
            複製
          </Button>
          {editable && (
            <IconButton
              label="キャンバスを削除"
              onClick={async () => {
                if (
                  await confirm({
                    title: "このキャンバスを削除しますか？",
                    confirmLabel: "削除",
                    danger: true,
                  })
                )
                  remove.mutate();
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：社員を探して追加 */}
        {editable && (
          <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-white md:flex">
            <div className="space-y-2 border-b border-line-2 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  aria-label="社員を探す"
                  placeholder="社員を探す"
                  className="pl-8"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="flex gap-1.5">
                <DepartmentSelect
                  value={deptToAdd}
                  onChange={setDeptToAdd}
                  placeholder="部署を選んでまとめて追加"
                  className="min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={!deptToAdd}
                  onClick={() => {
                    addMembers(
                      (allMembers.data ?? []).filter((m) => m.departmentId === deptToAdd).map((m) => m.id),
                    );
                    setDeptToAdd(null);
                  }}
                >
                  追加
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!q.trim() ? (
                <p className="p-4 text-xs leading-relaxed text-ink-3">
                  名前で探した社員をキャンバスへドラッグするか、「追加」で右側に並べます。キャンバス上の顔は自由に動かせます。グループの見出しをドラッグすると、中の顔も一緒に動きます。
                </p>
              ) : (
                <ul className="divide-y divide-line-2">
                  {(search.data?.items ?? []).map((m) => {
                    const on = placed.has(m.id);
                    return (
                      <li
                        key={m.id}
                        draggable={!on}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_MIME, String(m.id));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className={cx(
                          "flex items-center gap-2.5 px-3 py-2",
                          on ? "opacity-50" : "cursor-grab hover:bg-ai-50",
                        )}
                        data-member-id={m.id}
                      >
                        <Face member={m} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">
                            {m.lastName} {m.firstName}
                          </div>
                          <div className="truncate text-[11px] text-ink-3">{m.departmentName}</div>
                        </div>
                        {on ? (
                          <span className="text-[11px] text-ink-3">配置済み</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => addMembers([m.id])}
                            aria-label={`${m.lastName} ${m.firstName}を追加`}
                          >
                            追加
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-t border-line-2 p-3 text-xs text-ink-2">
              <Users className="mr-1 inline size-3.5" />
              キャンバス上 <span className="tabular font-bold">{data.items.length}</span>名
            </div>
          </aside>
        )}

        {/* キャンバス */}
        <div className="relative min-w-0 flex-1 overflow-auto bg-canvas">
          {selectedGroup && editable && (
            <div className="sticky top-2 left-2 z-20 ml-2 inline-flex items-center gap-1 rounded-md border border-line bg-white p-1 shadow">
              {(Object.keys(GROUP_COLORS) as BoardGroup["color"][]).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`グループの色を${c}にする`}
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      groups: d.groups.map((g) => (g.id === selectedGroup.id ? { ...g, color: c } : g)),
                    }))
                  }
                  className={cx(
                    "size-6 rounded border",
                    GROUP_COLORS[c].head,
                    selectedGroup.color === c && "ring-2 ring-ai-500",
                  )}
                />
              ))}
              <Button size="sm" variant="ghost" onClick={removeSelected}>
                グループを削除
              </Button>
            </div>
          )}
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div
              ref={canvasRef}
              role="application"
              aria-label="チームキャンバス"
              className="relative origin-top-left"
              style={{
                width,
                height,
                transform: `scale(${zoom})`,
                backgroundImage: "radial-gradient(circle, #d3dae3 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={() => {
                setSelected(null);
                setEditingText(null);
              }}
              onDragOver={(e) => {
                if (editable && e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const memberId = Number(e.dataTransfer.getData(DRAG_MIME));
                if (!memberId || !editable) return;
                const p = toCanvas(e.clientX, e.clientY);
                addMembers([memberId], { x: p.x - CARD_W / 2, y: p.y - CARD_H / 2 });
              }}
            >
              {data.groups.map((g) => {
                const c = GROUP_COLORS[g.color];
                const count = data.items.filter((i) => inside(g, i.x + CARD_W / 2, i.y + CARD_H / 2)).length;
                const isSel = selected?.kind === "group" && selected.id === g.id;
                return (
                  <div
                    key={g.id}
                    className={cx(
                      "absolute rounded-lg border-2",
                      c.bg,
                      c.border,
                      isSel && "ring-2 ring-ai-500",
                    )}
                    style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
                    data-group-id={g.id}
                  >
                    <div
                      className={cx(
                        "flex h-9 items-center justify-between gap-2 rounded-t-md px-3",
                        c.head,
                        editable && "cursor-move",
                      )}
                      onPointerDown={(e) => startGroupDrag(e, g)}
                      onDoubleClick={() => editable && setEditingText({ kind: "group", id: g.id })}
                    >
                      {editingText?.kind === "group" && editingText.id === g.id ? (
                        <input
                          // biome-ignore lint/a11y/noAutofocus: 追加直後に名前を入力させる
                          autoFocus
                          aria-label="グループ名"
                          className="h-7 min-w-0 flex-1 rounded border border-line bg-white px-2 text-sm text-ink"
                          defaultValue={g.label}
                          onPointerDown={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const label = e.target.value;
                            update((d) => ({
                              ...d,
                              groups: d.groups.map((x) => (x.id === g.id ? { ...x, label } : x)),
                            }));
                            setEditingText(null);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        />
                      ) : (
                        <span className="truncate text-sm font-bold">{g.label || "名前のないグループ"}</span>
                      )}
                      <span className="tabular shrink-0 text-xs">{count}名</span>
                    </div>
                    {editable && (
                      <div
                        aria-hidden="true"
                        title="ドラッグして大きさを変える"
                        className="absolute right-0 bottom-0 size-4 cursor-se-resize rounded-br-md bg-[linear-gradient(135deg,transparent_50%,var(--color-ai-300)_50%)]"
                        onPointerDown={(e) => startResize(e, g)}
                      />
                    )}
                  </div>
                );
              })}

              {data.notes.map((n) => {
                const isSel = selected?.kind === "note" && selected.id === n.id;
                const editing = editingText?.kind === "note" && editingText.id === n.id;
                return (
                  <div
                    key={n.id}
                    className={cx(
                      "absolute w-52 rounded-md border border-yamabuki-100 bg-yamabuki-50 p-3 text-[13px] leading-relaxed shadow-sm",
                      editable && !editing && "cursor-move",
                      isSel && "ring-2 ring-ai-500",
                    )}
                    style={{ left: n.x, top: n.y }}
                    onPointerDown={(e) => startNoteDrag(e, n)}
                    onDoubleClick={() => editable && setEditingText({ kind: "note", id: n.id })}
                  >
                    {editing ? (
                      <textarea
                        // biome-ignore lint/a11y/noAutofocus: 追加直後に内容を入力させる
                        autoFocus
                        aria-label="メモ"
                        className="h-24 w-full resize-none rounded border border-line bg-white p-1.5 text-[13px]"
                        defaultValue={n.text}
                        onPointerDown={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const text = e.target.value;
                          update((d) => ({
                            ...d,
                            notes: d.notes.map((x) => (x.id === n.id ? { ...x, text } : x)),
                          }));
                          setEditingText(null);
                        }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">
                        {n.text || <span className="text-ink-3">ダブルクリックで入力</span>}
                      </p>
                    )}
                  </div>
                );
              })}

              {data.items.map((i) => {
                const m = memberMap.get(i.memberId);
                if (!m) return null;
                const isSel = selected?.kind === "item" && selected.id === i.memberId;
                return (
                  <div
                    key={i.memberId}
                    className={cx(
                      "group absolute flex flex-col items-center rounded-md bg-white p-1.5 shadow-[0_1px_3px_rgba(22,38,61,.2)] select-none",
                      editable && "cursor-grab active:cursor-grabbing",
                      isSel && "ring-2 ring-ai-500",
                    )}
                    style={{ left: i.x, top: i.y, width: CARD_W }}
                    onPointerDown={(e) => startItemDrag(e, i.memberId)}
                    onDoubleClick={() => navigate(`/members/${i.memberId}`)}
                    title={`${m.lastName} ${m.firstName}（${m.departmentName ?? "所属なし"}）ダブルクリックでプロフィール`}
                    data-member-id={i.memberId}
                  >
                    <Face member={m} size={64} />
                    <span className="mt-1 w-full truncate text-center text-[12px] font-bold">
                      {m.lastName} {m.firstName}
                    </span>
                    <span className="w-full truncate text-center text-[10px] text-ink-3">
                      {m.departmentName}
                    </span>
                    {editable && (
                      <button
                        type="button"
                        aria-label={`${m.lastName} ${m.firstName}をキャンバスから外す`}
                        className="absolute -top-2 -right-2 hidden size-5 items-center justify-center rounded-full bg-ink text-white group-hover:flex"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() =>
                          update((d) => ({ ...d, items: d.items.filter((x) => x.memberId !== i.memberId) }))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {data.items.length === 0 && data.groups.length === 0 && (
                <div className="absolute top-24 left-1/2 w-96 -translate-x-1/2 rounded-lg border border-dashed border-ai-300 bg-white/80 p-6 text-center text-sm text-ink-2">
                  {editable
                    ? "左の一覧から社員をドラッグして並べてみましょう。"
                    : "まだ何も置かれていません。"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={editMeta}
        onClose={() => setEditMeta(false)}
        title="名前・公開設定"
        footer={
          <Button variant="primary" onClick={() => setEditMeta(false)}>
            閉じる
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="名前" required htmlFor="bm-name">
            <Input
              id="bm-name"
              value={meta.name}
              onChange={(e) => {
                setMeta({ ...meta, name: e.target.value });
                if (e.target.value.trim()) setDirty(true);
              }}
            />
          </Field>
          <Field label="説明" htmlFor="bm-desc">
            <Textarea
              id="bm-desc"
              rows={2}
              value={meta.description}
              onChange={(e) => {
                setMeta({ ...meta, description: e.target.value });
                setDirty(true);
              }}
            />
          </Field>
          <Checkbox
            label="ほかの社員にも公開する（閲覧のみ）"
            checked={meta.shared}
            onChange={(e) => {
              setMeta({ ...meta, shared: e.target.checked });
              setDirty(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
