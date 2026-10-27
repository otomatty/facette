import { useMutation } from "@tanstack/react-query";
import { FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Department, EmploymentType, Grade } from "../../../shared/types";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  Select,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, patch, post } from "../../lib/api";
import {
  buildDeptTree,
  type DeptNode,
  descendantIds,
  flattenDeptTree,
  queryClient,
  useMasters,
} from "../../lib/queries";
import { FormError, MoveButtons, moveItem, SectionHeader } from "./common";

function invalidateMasters() {
  queryClient.invalidateQueries({ queryKey: ["masters"] });
  // 社員一覧・プロフィールの部署名や役職名も変わる
  queryClient.invalidateQueries({ queryKey: ["members"] });
  queryClient.invalidateQueries({ queryKey: ["member"] });
  queryClient.invalidateQueries({ queryKey: ["me"] });
}

function totalCount(node: DeptNode): number {
  return node.memberCount + node.children.reduce((s, c) => s + totalCount(c), 0);
}

export function MastersTab() {
  const masters = useMasters();
  return (
    <div>
      <SectionHeader
        title="組織・マスタ"
        description="部署の階層と、社員の基本情報で選ぶ役職・等級・雇用形態を管理します。"
      />
      {masters.isLoading && <Loading />}
      {masters.error && <ErrorBox error={masters.error} onRetry={() => masters.refetch()} />}
      {masters.data && (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <DepartmentTree departments={masters.data.departments} />
          <div className="grid content-start gap-5 md:grid-cols-2 2xl:grid-cols-1">
            <SimpleMaster
              kind="jobTitles"
              title="役職"
              description="ランクが大きいほど上位です。管理職は、評価者の自動設定や管理職比率の集計に使います。"
              rankLabel="ランク"
              items={masters.data.jobTitles.map((j) => ({
                id: j.id,
                name: j.name,
                rank: j.rank,
                isManager: j.isManager,
              }))}
            />
            <SimpleMaster
              kind="grades"
              title="等級"
              description="ランクの小さい順に並びます。"
              rankLabel="ランク"
              items={masters.data.grades.map((g: Grade) => ({ id: g.id, name: g.name, rank: g.rank }))}
            />
            <SimpleMaster
              kind="employmentTypes"
              title="雇用形態"
              description="並び順の小さい順に、選択肢として表示されます。"
              rankLabel="並び順"
              items={masters.data.employmentTypes.map((e: EmploymentType) => ({
                id: e.id,
                name: e.name,
                rank: e.sortOrder,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── 部署ツリー ─────────
type DeptDialog = { mode: "create"; parentId: number | null } | { mode: "edit"; dept: DeptNode };

function DepartmentTree({ departments }: { departments: Department[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<DeptDialog | null>(null);
  const tree = useMemo(() => buildDeptTree(departments), [departments]);
  const flat = useMemo(() => flattenDeptTree(tree), [tree]);
  const total = departments.reduce((s, d) => s + d.memberCount, 0);

  const remove = useMutation({
    mutationFn: (d: DeptNode) => del(`/masters/departments/${d.id}`),
    onSuccess: (_, d) => {
      invalidateMasters();
      toast(`部署「${d.name}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => post("/masters/departments/reorder", { ids }),
    onSuccess: () => {
      invalidateMasters();
      toast("部署の並び順を保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  /** 兄弟の中で順番を入れ替え、ツリー全体の並び順を送る */
  const moveSibling = (siblings: DeptNode[], from: number, to: number) => {
    const reordered = moveItem(siblings, from, to);
    const walk = (list: DeptNode[], out: number[]) => {
      const ordered = list === siblings ? reordered : list;
      for (const n of ordered) {
        out.push(n.id);
        walk(n.children, out);
      }
      return out;
    };
    reorder.mutate(walk(tree, []));
  };

  const siblingsOf = (node: DeptNode): DeptNode[] => {
    if (node.parentId === null) return tree;
    const parent = flat.find((d) => d.id === node.parentId);
    return parent ? parent.children : tree;
  };

  return (
    <section className="min-w-0 rounded-lg border border-line bg-white" aria-labelledby="dept-tree-title">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-line-2 px-4 py-2">
        <div>
          <h3 id="dept-tree-title" className="text-[15px] font-bold">
            部署
            <span className="tabular ml-1.5 text-xs font-normal text-ink-3">
              {departments.length}部署、{total}名
            </span>
          </h3>
          <p className="text-xs text-ink-3">
            人数は在籍・休職中の社員です。親部署を変えると階層を移動できます。
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="size-3.5" />}
          onClick={() => setDialog({ mode: "create", parentId: null })}
        >
          最上位に部署を追加
        </Button>
      </header>
      {flat.length === 0 ? (
        <EmptyState title="部署がありません">
          部署を追加すると、社員の所属として選べるようになります。
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-2">
          {flat.map((d) => {
            const siblings = siblingsOf(d);
            const index = siblings.findIndex((s) => s.id === d.id);
            const sub = totalCount(d);
            return (
              <li key={d.id} className="flex items-center gap-2 py-1.5 pr-2 hover:bg-ai-50/60">
                <div
                  className="flex min-w-0 flex-1 items-center gap-2"
                  style={{ paddingLeft: 16 + Math.min(d.depth, 6) * 20 }}
                >
                  {d.depth > 0 && (
                    <span className="h-3 w-2.5 shrink-0 border-b border-l border-line" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className={cx("block truncate text-sm", d.depth <= 1 && "font-bold")}>
                      {d.name}
                    </span>
                    {d.code && <span className="tabular block text-[11px] text-ink-3">{d.code}</span>}
                  </span>
                </div>
                <span className="tabular shrink-0 text-right text-xs text-ink-2">
                  {d.memberCount}名
                  {d.children.length > 0 && (
                    <span className="block text-[11px] text-ink-3">配下計 {sub}名</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center">
                  <span className="hidden sm:flex">
                    <MoveButtons
                      name={d.name}
                      index={index}
                      count={siblings.length}
                      disabled={reorder.isPending}
                      onMove={(to) => moveSibling(siblings, index, to)}
                    />
                  </span>
                  <IconButton
                    label={`${d.name}の下に部署を追加`}
                    onClick={() => setDialog({ mode: "create", parentId: d.id })}
                  >
                    <FolderPlus className="size-4" />
                  </IconButton>
                  <IconButton label={`${d.name}を編集`} onClick={() => setDialog({ mode: "edit", dept: d })}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`${d.name}を削除`}
                    className="hover:bg-beni-100 hover:text-beni"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `部署「${d.name}」を削除しますか？`,
                          message: "配下の部署や所属する社員（退職者を含む）がいる部署は削除できません。",
                          confirmLabel: "削除",
                          danger: true,
                        })
                      )
                        remove.mutate(d);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {dialog && <DepartmentDialog dialog={dialog} flat={flat} onClose={() => setDialog(null)} />}
    </section>
  );
}

function DepartmentDialog({
  dialog,
  flat,
  onClose,
}: {
  dialog: DeptDialog;
  flat: DeptNode[];
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = dialog.mode === "edit" ? dialog.dept : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [code, setCode] = useState(editing?.code ?? "");
  const [parentId, setParentId] = useState<number | null>(
    editing ? editing.parentId : dialog.mode === "create" ? dialog.parentId : null,
  );
  // 自部署と配下は親に選べない
  const blocked = useMemo(() => new Set(editing ? descendantIds(editing) : []), [editing]);
  const parentName = flat.find((d) => d.id === parentId)?.name;

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), code: code.trim(), parentId };
      return editing ? patch(`/masters/departments/${editing.id}`, body) : post("/masters/departments", body);
    },
    onSuccess: () => {
      invalidateMasters();
      toast(editing ? `部署「${name.trim()}」を保存しました` : `部署「${name.trim()}」を追加しました`);
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={editing ? "部署を編集" : parentName ? `「${parentName}」の下に部署を追加` : "部署を追加"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? "保存" : "追加"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FormError error={save.error} />
        <Field label="部署名" required htmlFor="dp-name">
          <Input
            id="dp-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="部署コード" htmlFor="dp-code" help="CSV の取り込みで部署を指定するときに使えます。">
          <Input id="dp-code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field
          label="親部署"
          htmlFor="dp-parent"
          help={editing ? "変更すると、配下の部署もまとめて移動します。" : undefined}
        >
          <Select
            id="dp-parent"
            value={parentId ?? ""}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">なし（最上位）</option>
            {flat.map((d) => (
              <option key={d.id} value={d.id} disabled={blocked.has(d.id)}>
                {"　".repeat(d.depth)}
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────── 役職・等級・雇用形態 ─────────
type MasterKind = "jobTitles" | "grades" | "employmentTypes";
type MasterItem = { id: number; name: string; rank: number; isManager?: boolean };

const ENDPOINT: Record<MasterKind, string> = {
  jobTitles: "/masters/job-titles",
  grades: "/masters/grades",
  employmentTypes: "/masters/employment-types",
};

function SimpleMaster({
  kind,
  title,
  description,
  rankLabel,
  items,
}: {
  kind: MasterKind;
  title: string;
  description: string;
  rankLabel: string;
  items: MasterItem[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<MasterItem | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (item: MasterItem) => del(`${ENDPOINT[kind]}/${item.id}`),
    onSuccess: (_, item) => {
      invalidateMasters();
      toast(`${title}「${item.name}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const hasManager = kind === "jobTitles";

  return (
    <section className="min-w-0 rounded-lg border border-line bg-white" aria-label={title}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line-2 px-4 py-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">
            {title}
            <span className="tabular ml-1.5 text-xs font-normal text-ink-3">{items.length}件</span>
          </h3>
          <p className="text-xs text-ink-3">{description}</p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
          追加
        </Button>
      </header>
      {items.length === 0 ? (
        <EmptyState title={`${title}がありません`}>
          追加すると、社員の基本情報で選べるようになります。
        </EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-line-2 text-left text-xs text-ink-3">
            <tr>
              <th className="px-4 py-1.5 font-normal">名称</th>
              <th className="px-2 py-1.5 text-right font-normal">{rankLabel}</th>
              <th className="w-20 px-2 py-1.5">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-ai-50/60">
                <td className="px-4 py-1.5">
                  <span className="flex items-center gap-1.5">
                    {item.name}
                    {hasManager && item.isManager && <Badge tone="ai">管理職</Badge>}
                  </span>
                </td>
                <td className="tabular px-2 py-1.5 text-right text-ink-2">{item.rank}</td>
                <td className="px-1 py-0.5 text-right whitespace-nowrap">
                  <IconButton label={`${item.name}を編集`} onClick={() => setEditing(item)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`${item.name}を削除`}
                    className="hover:bg-beni-100 hover:text-beni"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `${title}「${item.name}」を削除しますか？`,
                          message: `この${title}が設定された社員（退職者を含む）がいる場合は削除できません。`,
                          confirmLabel: "削除",
                          danger: true,
                        })
                      )
                        remove.mutate(item);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <SimpleMasterDialog
          kind={kind}
          title={title}
          rankLabel={rankLabel}
          item={editing === "new" ? null : editing}
          nextRank={items.length ? Math.max(...items.map((i) => i.rank)) + 1 : 1}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function SimpleMasterDialog({
  kind,
  title,
  rankLabel,
  item,
  nextRank,
  onClose,
}: {
  kind: MasterKind;
  title: string;
  rankLabel: string;
  item: MasterItem | null;
  nextRank: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [rank, setRank] = useState(String(item?.rank ?? (kind === "jobTitles" ? 0 : nextRank)));
  const [isManager, setIsManager] = useState(item?.isManager ?? false);
  const rankNum = Number(rank);
  const rankError =
    rank.trim() === "" || !Number.isInteger(rankNum) || rankNum < 0 || rankNum > 1000
      ? `${rankLabel}は0〜1000の整数で入力してください`
      : null;
  const save = useMutation({
    mutationFn: () => {
      // 雇用形態の並び順も API では rank として送る
      const body = { name: name.trim(), rank: rankNum, isManager: kind === "jobTitles" ? isManager : false };
      return item ? patch(`${ENDPOINT[kind]}/${item.id}`, body) : post(ENDPOINT[kind], body);
    },
    onSuccess: () => {
      invalidateMasters();
      toast(item ? `${title}「${name.trim()}」を保存しました` : `${title}「${name.trim()}」を追加しました`);
      onClose();
    },
  });
  const submit = () => {
    if (rankError) return;
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={item ? `${title}を編集` : `${title}を追加`}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} disabled={!!rankError} onClick={submit}>
            {item ? "保存" : "追加"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError error={save.error} />
        <Field label="名称" required htmlFor="sm-name">
          <Input
            id="sm-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field
          label={rankLabel}
          required
          htmlFor="sm-rank"
          error={rankError}
          help={
            kind === "employmentTypes" ? "小さいほど先に表示されます。" : "大きいほど上位として扱います。"
          }
        >
          <Input
            id="sm-rank"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            className="max-w-32"
            value={rank}
            aria-invalid={rankError ? true : undefined}
            onChange={(e) => setRank(e.target.value)}
          />
        </Field>
        {kind === "jobTitles" && (
          <Checkbox
            label="管理職として扱う"
            checked={isManager}
            onChange={(e) => setIsManager(e.target.checked)}
          />
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
