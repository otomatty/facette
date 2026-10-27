import { useMutation } from "@tanstack/react-query";
import { FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ACCESS_LABELS,
  ACCESS_LEVELS,
  type AccessLevel,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type FieldType,
} from "../../../shared/constants";
import { resolveSheetAccess } from "../../../shared/permissions";
import type { FieldValue, Sheet, SheetField } from "../../../shared/types";
import { FieldInput } from "../../components/pickers";
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
  Segmented,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import { del, errorMessage, patch, post } from "../../lib/api";
import { queryClient, useSheets } from "../../lib/queries";
import { AccessBadge, FormError, MoveButtons, moveItem, SectionHeader } from "./common";

const KIND_LABELS = { single: "単一レコード", multi: "複数レコード" } as const;

function invalidateSheets() {
  queryClient.invalidateQueries({ queryKey: ["sheets"] });
  // 社員プロフィールのシート表示も更新する
  queryClient.invalidateQueries({ queryKey: ["member"] });
}

export function SheetsTab() {
  const sheets = useSheets();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Sheet | "new" | null>(null);
  const items = sheets.data ?? [];
  const selectedId = Number(params.get("sheet")) || items[0]?.id;
  const selected = items.find((s) => s.id === selectedId) ?? items[0];

  const select = (id: number) => {
    const next = new URLSearchParams(params);
    next.set("sheet", String(id));
    setParams(next, { replace: true });
  };

  const reorder = useMutation({
    mutationFn: (ordered: Sheet[]) => post("/sheets/reorder", { ids: ordered.map((s) => s.id) }),
    onMutate: (ordered) => {
      queryClient.setQueryData<Sheet[]>(["sheets"], ordered);
    },
    onSuccess: () => toast("シートの並び順を保存しました"),
    onError: (e) => toast(errorMessage(e), "error"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sheets"] }),
  });

  return (
    <div>
      <SectionHeader
        title="シート"
        description="社員ごとに管理する項目をシートとしてまとめます。シートは社員プロフィールのタブとして、この並び順で表示されます。"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            シートを作成
          </Button>
        }
      />
      {sheets.isLoading && <Loading />}
      {sheets.error && <ErrorBox error={sheets.error} onRetry={() => sheets.refetch()} />}
      {sheets.data && items.length === 0 && (
        <div className="rounded-lg border border-line bg-white">
          <EmptyState icon={<FileSpreadsheet className="size-10" />} title="シートがありません">
            シートを作成すると、社員プロフィールに項目を追加できます。
          </EmptyState>
        </div>
      )}
      {items.length > 0 && selected && (
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label="シート一覧" className="self-start rounded-lg border border-line bg-white">
            <ul className="divide-y divide-line-2">
              {items.map((s, i) => {
                const active = s.id === selected.id;
                return (
                  <li key={s.id} className={cx("flex items-center", active && "bg-ai-50")}>
                    <button
                      type="button"
                      onClick={() => select(s.id)}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "min-w-0 flex-1 py-2.5 pr-1 pl-3 text-left",
                        active && "shadow-[inset_3px_0_0_var(--color-ai-700)]",
                      )}
                    >
                      <span
                        className={cx(
                          "block truncate text-sm",
                          active ? "font-bold text-ai-800" : "font-bold",
                        )}
                      >
                        {s.name}
                      </span>
                      <span className="tabular block text-xs text-ink-3">
                        {KIND_LABELS[s.kind]}、{s.fields.length}項目
                      </span>
                    </button>
                    <span className="pr-1.5">
                      <MoveButtons
                        name={s.name}
                        index={i}
                        count={items.length}
                        disabled={reorder.isPending}
                        onMove={(to) => reorder.mutate(moveItem(items, i, to))}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </nav>
          <SheetDetail key={selected.id} sheet={selected} onEdit={() => setEditing(selected)} />
        </div>
      )}
      {editing && (
        <SheetFormDialog
          sheet={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(id) => select(id)}
        />
      )}
    </div>
  );
}

const ACCESS_ROWS: { key: "self" | "hr" | "manager" | "member"; label: string }[] = [
  { key: "self", label: "本人" },
  { key: "hr", label: "人事担当" },
  { key: "manager", label: "マネージャー" },
  { key: "member", label: "全社に公開" },
];

function SheetDetail({ sheet, onEdit }: { sheet: Sheet; onEdit: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editingField, setEditingField] = useState<SheetField | "new" | null>(null);
  const [, setParams] = useSearchParams();

  const removeSheet = useMutation({
    mutationFn: () => del(`/sheets/${sheet.id}`),
    onSuccess: () => {
      setParams({}, { replace: true });
      invalidateSheets();
      toast(`シート「${sheet.name}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const reorderFields = useMutation({
    mutationFn: (ordered: SheetField[]) =>
      post(`/sheets/${sheet.id}/fields/reorder`, { ids: ordered.map((f) => f.id) }),
    onMutate: (ordered) => {
      queryClient.setQueryData<Sheet[]>(["sheets"], (old) =>
        old?.map((s) => (s.id === sheet.id ? { ...s, fields: ordered } : s)),
      );
    },
    onSuccess: () => toast("項目の並び順を保存しました"),
    onError: (e) => toast(errorMessage(e), "error"),
    onSettled: () => invalidateSheets(),
  });
  const removeField = useMutation({
    mutationFn: (f: SheetField) => del(`/sheets/${sheet.id}/fields/${f.id}`),
    onSuccess: (_, f) => {
      invalidateSheets();
      toast(`項目「${f.label}」を削除しました`);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const level = (key: (typeof ACCESS_ROWS)[number]["key"]) =>
    key === "self" ? sheet.selfAccess : sheet.permissions[key];

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-lg border border-line bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-4 py-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
              {sheet.name}
              <Badge tone="fuji">{KIND_LABELS[sheet.kind]}</Badge>
            </h3>
            {sheet.description && <p className="mt-0.5 text-xs text-ink-3">{sheet.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={onEdit}>
              設定を編集
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              loading={removeSheet.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `シート「${sheet.name}」を削除しますか？`,
                    message:
                      "このシートの項目と、全社員分の入力済みデータ・変更申請がすべて削除され、元に戻せません。",
                    confirmLabel: "削除",
                    danger: true,
                  })
                )
                  removeSheet.mutate();
              }}
            >
              削除
            </Button>
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-4">
          {ACCESS_ROWS.map((r) => (
            <div key={r.key}>
              <dt className="text-xs text-ink-3">{r.label}</dt>
              <dd className="mt-0.5">
                <AccessBadge level={level(r.key)} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-white">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line-2 px-4 py-2">
          <h3 className="text-[15px] font-bold">
            項目<span className="tabular ml-1.5 text-xs font-normal text-ink-3">{sheet.fields.length}件</span>
          </h3>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => setEditingField("new")}
          >
            項目を追加
          </Button>
        </header>
        {sheet.fields.length === 0 ? (
          <EmptyState title="項目がありません">
            項目を追加すると、社員プロフィールのこのシートで入力できるようになります。
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line-2">
            {sheet.fields.map((f, i) => (
              <li key={f.id} className="flex items-start gap-2 py-2.5 pr-2 pl-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-bold">{f.label}</span>
                    {f.required && <Badge tone="beni">必須</Badge>}
                    <span className="text-xs text-ink-3">{FIELD_TYPE_LABELS[f.type]}</span>
                  </div>
                  {f.helpText && <p className="mt-0.5 text-xs text-ink-2">{f.helpText}</p>}
                  {f.options.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {f.options.map((o) => (
                        <span key={o} className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] text-ink-2">
                          {o}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <MoveButtons
                    name={f.label}
                    index={i}
                    count={sheet.fields.length}
                    disabled={reorderFields.isPending}
                    onMove={(to) => reorderFields.mutate(moveItem(sheet.fields, i, to))}
                  />
                  <IconButton label={`${f.label}を編集`} onClick={() => setEditingField(f)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`${f.label}を削除`}
                    className="hover:bg-beni-100 hover:text-beni"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `項目「${f.label}」を削除しますか？`,
                          message: "全社員分の、この項目に入力済みのデータも削除され、元に戻せません。",
                          confirmLabel: "削除",
                          danger: true,
                        })
                      )
                        removeField.mutate(f);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {editingField && (
        <FieldFormDialog
          sheet={sheet}
          field={editingField === "new" ? null : editingField}
          onClose={() => setEditingField(null)}
        />
      )}
    </div>
  );
}

// ───────── シートの作成・編集 ─────────
type SheetForm = {
  name: string;
  description: string;
  kind: Sheet["kind"];
  selfAccess: AccessLevel;
  permissions: Sheet["permissions"];
};

const ACCESS_OPTIONS = ACCESS_LEVELS.map((v) => ({ value: v, label: ACCESS_LABELS[v] }));

function AccessField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: AccessLevel;
  onChange: (v: AccessLevel) => void;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="text-[13px] font-bold">{label}</p>
        <p className="text-xs text-ink-3">{help}</p>
      </div>
      <Segmented label={label} options={ACCESS_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

/** 設定から、立場ごとの実際の見え方を求める */
function EffectiveAccess({ form }: { form: SheetForm }) {
  const base = { roleAccess: form.permissions, selfAccess: form.selfAccess };
  const rows: { label: string; level: AccessLevel }[] = [
    {
      label: "本人（一般社員の場合）",
      level: resolveSheetAccess({ ...base, role: "member", isSelf: true, inScope: true }),
    },
    {
      label: "人事担当",
      level: resolveSheetAccess({ ...base, role: "hr", isSelf: false, inScope: true }),
    },
    {
      label: "マネージャー（自部署配下の社員）",
      level: resolveSheetAccess({ ...base, role: "manager", isSelf: false, inScope: true }),
    },
    {
      label: "マネージャー（それ以外の社員）",
      level: resolveSheetAccess({ ...base, role: "manager", isSelf: false, inScope: false }),
    },
    {
      label: "一般社員（他の社員）",
      level: resolveSheetAccess({ ...base, role: "member", isSelf: false, inScope: false }),
    },
  ];
  return (
    <div className="rounded-md bg-canvas px-3 py-2.5">
      <p className="mb-1.5 text-xs font-bold text-ink-2">この設定での見え方</p>
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <dt className="text-ink-2">{r.label}</dt>
            <dd>
              <AccessBadge level={r.level} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-ink-3">システム管理者は、すべてのシートを常に編集できます。</p>
    </div>
  );
}

function SheetFormDialog({
  sheet,
  onClose,
  onCreated,
}: {
  sheet: Sheet | null;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<SheetForm>(() => ({
    name: sheet?.name ?? "",
    description: sheet?.description ?? "",
    kind: sheet?.kind ?? "single",
    selfAccess: sheet?.selfAccess ?? "view",
    permissions: sheet?.permissions ?? { hr: "edit", manager: "view", member: "none" },
  }));
  const set = <K extends keyof SheetForm>(k: K, v: SheetForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setPerm = (k: keyof Sheet["permissions"], v: AccessLevel) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: v } }));

  const save = useMutation({
    mutationFn: async () => {
      if (sheet) {
        await patch(`/sheets/${sheet.id}`, form);
        return null;
      }
      return (await post<{ id: number }>("/sheets", form)).id;
    },
    onSuccess: (createdId) => {
      invalidateSheets();
      toast(
        sheet ? `シート「${form.name.trim()}」を保存しました` : `シート「${form.name.trim()}」を作成しました`,
      );
      if (createdId) onCreated(createdId);
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={sheet ? "シートの設定を編集" : "シートを作成"}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {sheet ? "保存" : "作成"}
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
        <Field label="シート名" required htmlFor="sh-name">
          <Input
            id="sh-name"
            value={form.name}
            maxLength={60}
            placeholder="例：資格・免許"
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="説明" htmlFor="sh-desc" help="社員プロフィールのシートの見出しの下に表示されます。">
          <Textarea
            id="sh-desc"
            rows={2}
            maxLength={400}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold text-ink-2">データの持ち方</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["single", "社員ごとに1件の項目を持ちます。例：自己紹介、人事基本情報"],
                ["multi", "社員ごとに何件でも行を追加できます。例：資格、研修の受講履歴"],
              ] as const
            ).map(([k, help]) => (
              <label
                key={k}
                className={cx(
                  "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5",
                  form.kind === k ? "border-ai-500 bg-ai-50" : "border-line hover:border-ai-200",
                )}
              >
                <input
                  type="radio"
                  name="sheet-kind"
                  className="mt-1 accent-ai-700"
                  checked={form.kind === k}
                  onChange={() => set("kind", k)}
                />
                <span>
                  <span className="block text-sm font-bold">{KIND_LABELS[k]}</span>
                  <span className="block text-xs text-ink-3">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-bold text-ink-2">閲覧・編集の権限</legend>
          <div className="divide-y divide-line-2">
            <AccessField
              label="本人"
              help="自分のプロフィールのこのシートを、本人がどう扱えるか。単一レコードで「閲覧」にすると、本人は変更を申請できます。"
              value={form.selfAccess}
              onChange={(v) => set("selfAccess", v)}
            />
            <AccessField
              label="人事担当"
              help="全社員のこのシートに適用します。"
              value={form.permissions.hr}
              onChange={(v) => setPerm("hr", v)}
            />
            <AccessField
              label="マネージャー"
              help="自部署と配下の部署の社員にだけ適用します。それ以外の社員は、全社に公開する範囲で見えます。"
              value={form.permissions.manager}
              onChange={(v) => setPerm("manager", v)}
            />
            <AccessField
              label="一般社員（全社に公開する範囲）"
              help="全社員が他の社員のこのシートを見られるかを決めます。「編集」にしても、他の社員に対しては閲覧までです。"
              value={form.permissions.member}
              onChange={(v) => setPerm("member", v)}
            />
          </div>
        </fieldset>
        <EffectiveAccess form={form} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ───────── 項目の追加・編集 ─────────
type FieldForm = {
  label: string;
  type: FieldType;
  required: boolean;
  helpText: string;
  optionsText: string;
};

function parseOptions(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function hasOptions(t: FieldType) {
  return t === "select" || t === "multiselect";
}

function FieldFormDialog({
  sheet,
  field,
  onClose,
}: {
  sheet: Sheet;
  field: SheetField | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const previewId = useId();
  const [form, setForm] = useState<FieldForm>(() => ({
    label: field?.label ?? "",
    type: field?.type ?? "text",
    required: field?.required ?? false,
    helpText: field?.helpText ?? "",
    optionsText: field?.options.join("\n") ?? "",
  }));
  const [preview, setPreview] = useState<FieldValue>(null);
  const set = <K extends keyof FieldForm>(k: K, v: FieldForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const options = useMemo(
    () => (hasOptions(form.type) ? parseOptions(form.optionsText) : []),
    [form.type, form.optionsText],
  );
  // 種類を変えたら見本の入力値を消す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 種類の変更時だけ実行する
  useEffect(() => setPreview(null), [form.type]);

  const previewField: SheetField = {
    id: 0,
    sheetId: sheet.id,
    label: form.label.trim() || "項目名",
    type: form.type,
    options,
    required: form.required,
    helpText: form.helpText.trim(),
    sortOrder: 0,
  };
  const optionsError =
    hasOptions(form.type) && form.optionsText.trim() !== "" && options.length === 0
      ? "選択肢を1つ以上入力してください"
      : options.some((o) => o.length > 60)
        ? "選択肢は1つ60文字以内にしてください"
        : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: form.label.trim(),
        type: form.type,
        required: form.required,
        helpText: form.helpText.trim(),
        options,
      };
      return field
        ? patch(`/sheets/${sheet.id}/fields/${field.id}`, body)
        : post(`/sheets/${sheet.id}/fields`, body);
    },
    onSuccess: () => {
      invalidateSheets();
      toast(
        field ? `項目「${form.label.trim()}」を保存しました` : `項目「${form.label.trim()}」を追加しました`,
      );
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={field ? "項目を編集" : `「${sheet.name}」に項目を追加`}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {field ? "保存" : "追加"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid content-start gap-4">
          <FormError error={save.error} />
          <Field label="種類" required htmlFor="fd-type">
            <Select id="fd-type" value={form.type} onChange={(e) => set("type", e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {field && field.type !== form.type && (
            <p className="rounded-md bg-yamabuki-50 px-3 py-2 text-xs text-ink-2" role="status">
              入力済みのデータは変換されません。新しい種類に合わない値は、次に編集するときに入力し直す必要があります。
            </p>
          )}
          <Field label="項目名" required htmlFor="fd-label">
            <Input
              id="fd-label"
              value={form.label}
              maxLength={60}
              placeholder="例：資格名"
              onChange={(e) => set("label", e.target.value)}
            />
          </Field>
          {hasOptions(form.type) && (
            <Field
              label="選択肢"
              required
              htmlFor="fd-options"
              error={optionsError}
              help={`1行に1つ入力します。${options.length ? `${options.length}個` : ""}`}
            >
              <Textarea
                id="fd-options"
                rows={5}
                value={form.optionsText}
                aria-invalid={optionsError ? true : undefined}
                placeholder={"例：\n東京本社\n大阪支社\nリモート"}
                onChange={(e) => set("optionsText", e.target.value)}
              />
            </Field>
          )}
          <Field label="補足説明" htmlFor="fd-help" help="入力欄の下に表示されます。">
            <Input
              id="fd-help"
              value={form.helpText}
              maxLength={200}
              onChange={(e) => set("helpText", e.target.value)}
            />
          </Field>
          <Checkbox
            label={form.type === "checkbox" ? "必須（チェックの種類では使われません）" : "必須にする"}
            checked={form.required}
            disabled={form.type === "checkbox"}
            onChange={(e) => set("required", e.target.checked)}
          />
          <button type="submit" hidden />
        </div>
        <div className="self-start rounded-md border border-dashed border-line bg-canvas/60 p-4">
          <p className="mb-3 text-xs font-bold text-ink-3">入力欄の見本</p>
          <div className="rounded-md bg-white p-3">
            <Field
              label={previewField.label}
              required={previewField.required && previewField.type !== "checkbox"}
              help={previewField.helpText}
              htmlFor={previewId}
            >
              {hasOptions(form.type) && options.length === 0 ? (
                <p className="text-xs text-ink-3">選択肢を入力すると表示されます。</p>
              ) : (
                <FieldInput id={previewId} field={previewField} value={preview} onChange={setPreview} />
              )}
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">見本に入力した内容は保存されません。</p>
        </div>
      </form>
    </Modal>
  );
}
