import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckSquare,
  Columns2,
  Columns3,
  Download,
  ImageUp,
  LayoutGrid,
  List,
  ListPlus,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { GENDER_LABELS, MAX_COMPARE, MEMBER_STATUS_LABELS } from "../../../shared/constants";
import { formatDateJa } from "../../../shared/dates";
import type { FieldValue, MemberList, MemberSummary, Paged } from "../../../shared/types";
import { Face, FaceTile, StatusBadge } from "../../components/Face";
import { DepartmentSelect, FieldValueView } from "../../components/pickers";
import {
  Badge,
  Button,
  Checkbox,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Segmented,
  Select,
  useToast,
} from "../../components/ui";
import { downloadText, errorMessage, get, post, qs } from "../../lib/api";
import { queryClient, useAuth, useMasters, useSheets, useSkills } from "../../lib/queries";
import { CsvImportDialog } from "./CsvImportDialog";
import { MemberFormDialog } from "./MemberFormDialog";
import { PhotoBulkDialog } from "./PhotoBulkDialog";

type ListResponse = Paged<MemberSummary> & { extra?: Record<number, Record<string, FieldValue>> };

const FILTER_KEYS = [
  "q",
  "departmentId",
  "includeSub",
  "jobTitleId",
  "gradeId",
  "employmentTypeId",
  "status",
  "gender",
  "skillId",
  "skillMin",
  "listId",
  "fieldId",
  "fieldValue",
  "hiredFrom",
  "hiredTo",
  "sort",
] as const;

export default function MembersPage() {
  const me = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as "grid" | "list") ?? "grid";
  const page = Number(params.get("page") ?? 1);
  const pageSize = view === "grid" ? 60 : 50;
  // 表示項目はチェック操作に即座に反応させるため手元の状態で持ち、URL へは後から同期する
  const [columns, setColumns] = useState(params.get("columns") ?? "");
  const [showFilters, setShowFilters] = useState(
    () => !!(params.get("skillId") || params.get("fieldId") || params.get("gradeId") || params.get("listId")),
  );
  const [qInput, setQInput] = useState(params.get("q") ?? "");
  const navigate = useNavigate();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bulkPhotos, setBulkPhotos] = useState(false);
  const [columnPicker, setColumnPicker] = useState(false);
  const [addToList, setAddToList] = useState(false);

  const masters = useMasters();
  const sheets = useSheets();
  const skills = useSkills();
  const lists = useQuery({ queryKey: ["lists"], queryFn: () => get<{ items: MemberList[] }>("/lists") });

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const query = useQuery({
    queryKey: ["members", "search", filters, page, pageSize, columns],
    queryFn: () =>
      get<ListResponse>(
        `/members${qs({ ...filters, page, pageSize, columns: view === "list" ? columns : "" })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const setParam = (updates: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in updates)) next.delete("page");
    setParams(next, { replace: true });
  };

  const staff = me.user.role !== "member";
  const fieldOptions = useMemo(
    () =>
      (sheets.data ?? [])
        .filter((s) => s.kind === "single")
        .flatMap((s) =>
          s.fields
            .filter((f) => ["select", "multiselect", "checkbox", "text"].includes(f.type))
            .map((f) => ({ sheet: s, field: f })),
        ),
    [sheets.data],
  );
  const selectedField = fieldOptions.find((x) => String(x.field.id) === params.get("fieldId"));
  const columnFields = useMemo(() => {
    const ids = columns.split(",").filter(Boolean).map(Number);
    return (sheets.data ?? []).flatMap((s) =>
      s.fields.filter((f) => ids.includes(f.id)).map((f) => ({ sheet: s, field: f })),
    );
  }, [columns, sheets.data]);

  const activeFilterCount = [
    "jobTitleId",
    "gradeId",
    "employmentTypeId",
    "gender",
    "skillId",
    "listId",
    "fieldId",
    "hiredFrom",
    "hiredTo",
    "status",
  ].filter((k) => params.get(k)).length;

  const exportCsv = useMutation({
    mutationFn: () =>
      get<{ filename: string; csv: string; count: number }>(
        `/io/members/export${qs({ ...filters, status: params.get("status") ?? "current" })}`,
      ),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv);
      toast(`${r.count}名分の CSV を出力しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const items = query.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="メンバー"
        description="顔写真と基本情報で社員を探せます。条件を組み合わせて絞り込み、社員リストにまとめることもできます。"
        actions={
          me.capabilities.manageMembers && (
            <>
              <Button
                icon={<Download className="size-4" />}
                onClick={() => exportCsv.mutate()}
                loading={exportCsv.isPending}
              >
                CSV出力
              </Button>
              <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                CSV取り込み
              </Button>
              <Button icon={<ImageUp className="size-4" />} onClick={() => setBulkPhotos(true)}>
                顔写真の一括登録
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                社員を追加
              </Button>
            </>
          )
        }
      />

      {/* 検索条件 */}
      <div className="mb-4 rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <form
            className="relative min-w-60 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q: qInput.trim() });
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              aria-label="氏名・かな・社員番号・メールで検索"
              placeholder="氏名・かな・社員番号・メールで検索"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onBlur={() => qInput.trim() !== (params.get("q") ?? "") && setParam({ q: qInput.trim() })}
              className="pl-8"
            />
          </form>
          <DepartmentSelect
            className="w-56"
            value={params.get("departmentId") ? Number(params.get("departmentId")) : null}
            onChange={(v) => setParam({ departmentId: v ? String(v) : null })}
          />
          <Select
            aria-label="並び順"
            className="w-36"
            value={params.get("sort") ?? "kana"}
            onChange={(e) => setParam({ sort: e.target.value === "kana" ? null : e.target.value })}
          >
            <option value="kana">五十音順</option>
            <option value="department">部署・役職順</option>
            <option value="code">社員番号順</option>
            <option value="hire">入社日が新しい順</option>
          </Select>
          <Button
            icon={<SlidersHorizontal className="size-4" />}
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
          >
            詳細条件
            {activeFilterCount > 0 && <Badge tone="ai">{activeFilterCount}</Badge>}
          </Button>
        </div>
        {showFilters && (
          <div className="grid gap-x-4 gap-y-3 border-t border-line-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="役職">
              <Select
                value={params.get("jobTitleId") ?? ""}
                onChange={(e) => setParam({ jobTitleId: e.target.value })}
              >
                <option value="">すべて</option>
                {masters.data?.jobTitles.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="在籍状況">
              <Select
                value={params.get("status") ?? ""}
                onChange={(e) => setParam({ status: e.target.value })}
              >
                <option value="">在籍・休職</option>
                {Object.entries(MEMBER_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}のみ
                  </option>
                ))}
                <option value="all">退職者を含むすべて</option>
              </Select>
            </Field>
            <Field label="入社日（から）">
              <Input
                type="date"
                value={params.get("hiredFrom") ?? ""}
                onChange={(e) => setParam({ hiredFrom: e.target.value })}
              />
            </Field>
            <Field label="入社日（まで）">
              <Input
                type="date"
                value={params.get("hiredTo") ?? ""}
                onChange={(e) => setParam({ hiredTo: e.target.value })}
              />
            </Field>
            {staff && (
              <>
                <Field label="等級">
                  <Select
                    value={params.get("gradeId") ?? ""}
                    onChange={(e) => setParam({ gradeId: e.target.value })}
                  >
                    <option value="">すべて</option>
                    {masters.data?.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="雇用形態">
                  <Select
                    value={params.get("employmentTypeId") ?? ""}
                    onChange={(e) => setParam({ employmentTypeId: e.target.value })}
                  >
                    <option value="">すべて</option>
                    {masters.data?.employmentTypes.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="性別">
                  <Select
                    value={params.get("gender") ?? ""}
                    onChange={(e) => setParam({ gender: e.target.value })}
                  >
                    <option value="">すべて</option>
                    {Object.entries(GENDER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Field label="スキル">
              <div className="flex gap-2">
                <Select
                  value={params.get("skillId") ?? ""}
                  onChange={(e) =>
                    setParam({
                      skillId: e.target.value,
                      skillMin: e.target.value ? (params.get("skillMin") ?? "3") : null,
                    })
                  }
                >
                  <option value="">指定なし</option>
                  {skills.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {params.get("skillId") && (
                  <Select
                    aria-label="スキルレベル"
                    className="w-28"
                    value={params.get("skillMin") ?? "3"}
                    onChange={(e) => setParam({ skillMin: e.target.value })}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        Lv{n}以上
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </Field>
            <Field label="社員リスト">
              <Select
                value={params.get("listId") ?? ""}
                onChange={(e) => setParam({ listId: e.target.value })}
              >
                <option value="">指定なし</option>
                {lists.data?.items.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="シートの項目" className="lg:col-span-2">
              <div className="flex gap-2">
                <Select
                  value={params.get("fieldId") ?? ""}
                  onChange={(e) => setParam({ fieldId: e.target.value, fieldValue: null })}
                >
                  <option value="">指定なし</option>
                  {fieldOptions.map(({ sheet, field }) => (
                    <option key={field.id} value={field.id}>
                      {sheet.name}：{field.label}
                    </option>
                  ))}
                </Select>
                {selectedField &&
                  (selectedField.field.type === "text" ? (
                    <Input
                      aria-label="値"
                      placeholder="含む文字"
                      defaultValue={params.get("fieldValue") ?? ""}
                      onBlur={(e) => setParam({ fieldValue: e.target.value })}
                    />
                  ) : (
                    <Select
                      aria-label="値"
                      value={params.get("fieldValue") ?? ""}
                      onChange={(e) => setParam({ fieldValue: e.target.value })}
                    >
                      <option value="">値を選択</option>
                      {selectedField.field.type === "checkbox" ? (
                        <>
                          <option value="true">はい</option>
                          <option value="false">いいえ</option>
                        </>
                      ) : (
                        selectedField.field.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))
                      )}
                    </Select>
                  ))}
              </div>
            </Field>
            <div className="flex items-end gap-3 lg:col-span-2">
              <Checkbox
                label="配下の部署を含める"
                checked={params.get("includeSub") !== "false"}
                onChange={(e) => setParam({ includeSub: e.target.checked ? null : "false" })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                icon={<X className="size-4" />}
                onClick={() => {
                  setQInput("");
                  const next = new URLSearchParams();
                  if (params.get("view")) next.set("view", params.get("view")!);
                  setParams(next, { replace: true });
                }}
              >
                条件をクリア
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ツールバー */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-ink-2" aria-live="polite">
          <span className="tabular text-lg font-bold text-ink">{query.data?.total ?? "—"}</span> 名
          {query.isFetching && <span className="ml-2 text-xs text-ink-3">更新中</span>}
        </p>
        {selecting ? (
          <>
            <span className="text-sm text-ink-2">{selected.size}名を選択中</span>
            <Button size="sm" onClick={() => setSelected(new Set([...selected, ...items.map((m) => m.id)]))}>
              このページを全選択
            </Button>
            <Button
              size="sm"
              icon={<Columns2 className="size-4" />}
              disabled={selected.size < 2 || selected.size > MAX_COMPARE}
              title={
                selected.size > MAX_COMPARE
                  ? `比較できるのは${MAX_COMPARE}名までです`
                  : "2名以上選ぶと比較できます"
              }
              onClick={() => navigate(`/members/compare?ids=${[...selected].join(",")}`)}
            >
              比較する
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<ListPlus className="size-4" />}
              disabled={!selected.size}
              onClick={() => setAddToList(true)}
            >
              社員リストに追加
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              選択をやめる
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<CheckSquare className="size-4" />}
            onClick={() => setSelecting(true)}
          >
            選択
          </Button>
        )}
        {view === "list" && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Columns3 className="size-4" />}
            onClick={() => setColumnPicker(true)}
          >
            表示項目
          </Button>
        )}
        <Segmented
          label="表示形式"
          value={view}
          onChange={(v) => setParam({ view: v === "grid" ? null : v })}
          options={[
            { value: "grid", label: "顔一覧", icon: <LayoutGrid className="size-3.5" /> },
            { value: "list", label: "リスト", icon: <List className="size-3.5" /> },
          ]}
        />
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorBox error={query.error} onRetry={() => query.refetch()} />}
      {query.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<Users className="size-10" />} title="条件に合う社員がいません">
            検索語や詳細条件を変えてお試しください。
          </EmptyState>
        </div>
      )}

      {items.length > 0 && view === "grid" && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] sm:gap-3">
          {items.map((m) => (
            <li key={m.id} className="relative">
              {selecting ? (
                <FaceTile member={m} selected={selected.has(m.id)} onClick={() => toggle(m.id)} />
              ) : (
                <FaceTile member={m} href={`/members/${m.id}`} />
              )}
              {selecting && (
                <span
                  className={cx(
                    "pointer-events-none absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded border-2 border-white text-[11px] font-bold shadow",
                    selected.has(m.id) ? "bg-ai-700 text-white" : "bg-white/80",
                  )}
                  aria-hidden
                >
                  {selected.has(m.id) ? "✓" : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && view === "list" && (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-line bg-canvas/60 text-left text-xs text-ink-3">
              <tr>
                {selecting && <th className="w-10 px-3 py-2" />}
                <th className="px-3 py-2 font-normal">氏名</th>
                <th className="px-3 py-2 font-normal">社員番号</th>
                <th className="px-3 py-2 font-normal">部署</th>
                <th className="px-3 py-2 font-normal">役職</th>
                <th className="px-3 py-2 font-normal">入社日</th>
                <th className="px-3 py-2 font-normal">勤務地</th>
                {columnFields.map(({ field }) => (
                  <th key={field.id} className="px-3 py-2 font-normal">
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {items.map((m) => (
                <tr key={m.id} className={cx("hover:bg-ai-50/60", selected.has(m.id) && "bg-ai-50")}>
                  {selecting && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${m.lastName} ${m.firstName}を選択`}
                        className="size-4 accent-ai-700"
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Link to={`/members/${m.id}`} className="group flex items-center gap-2.5">
                      <Face member={m} size={34} />
                      <span>
                        <span className="block font-bold group-hover:text-ai-700">
                          {m.lastName} {m.firstName}
                        </span>
                        <span className="block text-xs text-ink-3">
                          {m.lastNameKana} {m.firstNameKana}
                        </span>
                      </span>
                      <StatusBadge status={m.status} />
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2 text-ink-2">{m.employeeCode}</td>
                  <td className="px-3 py-2">{m.departmentName ?? "—"}</td>
                  <td className="px-3 py-2">{m.jobTitleName ?? "—"}</td>
                  <td className="tabular px-3 py-2 whitespace-nowrap text-ink-2">
                    {formatDateJa(m.hireDate)}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{m.workLocation ?? "—"}</td>
                  {columnFields.map(({ field }) => {
                    const ex = query.data?.extra?.[m.id];
                    return (
                      <td key={field.id} className="max-w-56 px-3 py-2">
                        {ex ? (
                          <FieldValueView field={field} value={ex[String(field.id)]} />
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={query.data.total}
            onChange={(p) => {
              setParam({ page: p === 1 ? null : String(p) });
              window.scrollTo(0, 0);
            }}
          />
        </div>
      )}

      {creating && <MemberFormDialog open onClose={() => setCreating(false)} />}
      {importing && <CsvImportDialog open onClose={() => setImporting(false)} />}
      {bulkPhotos && <PhotoBulkDialog open onClose={() => setBulkPhotos(false)} />}

      <Modal
        open={columnPicker}
        onClose={() => setColumnPicker(false)}
        title="リストに表示する項目"
        footer={<Button onClick={() => setColumnPicker(false)}>閉じる</Button>}
      >
        <p className="mb-3 text-sm text-ink-2">
          シートの項目を最大12個まで列として追加できます。閲覧権限のない値は表示されません。
        </p>
        <div className="space-y-4">
          {(sheets.data ?? [])
            .filter((s) => s.kind === "single")
            .map((s) => (
              <fieldset key={s.id}>
                <legend className="mb-1.5 text-[13px] font-bold">{s.name}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {s.fields.map((f) => {
                    const ids = columns.split(",").filter(Boolean);
                    const on = ids.includes(String(f.id));
                    return (
                      <Checkbox
                        key={f.id}
                        label={f.label}
                        checked={on}
                        disabled={!on && ids.length >= 12}
                        onChange={() => {
                          const next = (
                            on ? ids.filter((x) => x !== String(f.id)) : [...ids, String(f.id)]
                          ).join(",");
                          setColumns(next);
                          setParam({ columns: next, page: params.get("page") });
                        }}
                      />
                    );
                  })}
                </div>
              </fieldset>
            ))}
        </div>
      </Modal>

      <AddToListDialog
        open={addToList}
        onClose={() => setAddToList(false)}
        memberIds={[...selected]}
        lists={(lists.data?.items ?? []).filter((l) => l.isOwner)}
        onDone={() => {
          setAddToList(false);
          setSelecting(false);
          setSelected(new Set());
        }}
      />
    </div>
  );
}

function AddToListDialog({
  open,
  onClose,
  memberIds,
  lists,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  memberIds: number[];
  lists: MemberList[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [listId, setListId] = useState<string>("new");
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      let id = Number(listId);
      if (listId === "new") {
        const created = await post<{ id: number }>("/lists", { name, shared: false });
        id = created.id;
      }
      await post(`/lists/${id}/members`, { memberIds });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lists"] });
      toast(`${memberIds.length}名を社員リストに追加しました`);
      onDone();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="社員リストに追加"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={listId === "new" && !name.trim()}
            onClick={() => add.mutate()}
          >
            {memberIds.length}名を追加
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="追加先">
          <Select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="new">新しいリストを作る</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}（{l.memberCount}名）
              </option>
            ))}
          </Select>
        </Field>
        {listId === "new" && (
          <Field label="リスト名" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：新規事業チーム候補"
              autoFocus
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
