import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { formatFieldValue } from "../../shared/sheets";
import type { FieldValue, MemberSummary, Paged, SheetField } from "../../shared/types";
import { get, qs } from "../lib/api";
import { buildDeptTree, flattenDeptTree, useMasters } from "../lib/queries";
import { Face } from "./Face";
import { Checkbox, cx, Input, Select, Textarea } from "./ui";

/** 階層をインデントで表した部署の選択肢 */
export function DepartmentOptions() {
  const { data } = useMasters();
  const flat = useMemo(() => (data ? flattenDeptTree(buildDeptTree(data.departments)) : []), [data]);
  return (
    <>
      {flat.map((d) => (
        <option key={d.id} value={d.id}>
          {"　".repeat(d.depth)}
          {d.name}
        </option>
      ))}
    </>
  );
}

export function DepartmentSelect({
  value,
  onChange,
  placeholder = "すべての部署",
  id,
  className,
  required,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <Select
      id={id}
      aria-label={id ? undefined : "部署"}
      className={className}
      value={value ?? ""}
      required={required}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{placeholder}</option>
      <DepartmentOptions />
    </Select>
  );
}

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** 社員を検索して1人選ぶ */
export function MemberPicker({
  value,
  onChange,
  placeholder = "氏名・社員番号で検索",
  excludeIds = [],
  id,
}: {
  value: MemberSummary | null;
  onChange: (m: MemberSummary | null) => void;
  placeholder?: string;
  excludeIds?: number[];
  id?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q.trim());
  const listId = useId();
  const { data, isFetching } = useQuery({
    queryKey: ["member-picker", debounced],
    queryFn: () => get<Paged<MemberSummary>>(`/members${qs({ q: debounced, pageSize: 8 })}`),
    enabled: open && debounced.length > 0,
  });
  // 入力が確定するまで（デバウンス中）は前の語の候補を出さない
  const settled = debounced === q.trim();
  const items = settled ? (data?.items ?? []).filter((m) => !excludeIds.includes(m.id)) : [];
  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-white pr-1 pl-1.5">
        <Face member={value} size={26} />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-bold">
            {value.lastName} {value.firstName}
          </span>
          <span className="ml-2 text-xs text-ink-3">{value.departmentName}</span>
        </span>
        <button
          type="button"
          aria-label="選択を解除"
          onClick={() => onChange(null)}
          className="rounded p-1 text-ink-3 hover:bg-ai-50 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
      <Input
        id={id}
        value={q}
        placeholder={placeholder}
        className="pl-8"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && debounced && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-10 right-0 left-0 z-50 max-h-72 overflow-y-auto rounded-md border border-line bg-white shadow-lg"
        >
          {items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-ink-3">
              {isFetching || !settled ? "検索しています" : "見つかりません"}
            </div>
          ) : (
            items.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(m);
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-ai-50"
              >
                <Face member={m} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {m.lastName} {m.firstName}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {m.departmentName ?? "所属なし"}
                    <span className="tabular ml-2">{m.employeeCode}</span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** シート項目の入力欄 */
export function FieldInput({
  field,
  value,
  onChange,
  error,
  id,
}: {
  field: SheetField;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  error?: string;
  id?: string;
}) {
  const invalid = error ? true : undefined;
  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          aria-invalid={invalid}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          aria-invalid={invalid}
          type="number"
          inputMode="decimal"
          step="any"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="max-w-48"
        />
      );
    case "date":
      return (
        <Input
          id={id}
          aria-invalid={invalid}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="max-w-48"
        />
      );
    case "select":
      return (
        <Select
          id={id}
          aria-invalid={invalid}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="max-w-72"
        >
          <option value="">未選択</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1" id={id}>
          {field.options.map((o) => (
            <Checkbox
              key={o}
              label={o}
              checked={arr.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
            />
          ))}
        </div>
      );
    }
    case "checkbox":
      return (
        <Checkbox
          id={id}
          label="はい"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "url":
      return (
        <Input
          id={id}
          aria-invalid={invalid}
          type="url"
          placeholder="https://"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          id={id}
          aria-invalid={invalid}
          value={
            typeof value === "string" ? value : value === null || value === undefined ? "" : String(value)
          }
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** シート項目の値の表示 */
export function FieldValueView({ field, value }: { field: SheetField; value: FieldValue | undefined }) {
  const text = formatFieldValue(field, value);
  if (!text) return <span className="text-ink-3">—</span>;
  if (field.type === "url" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-ai-700 underline">
        {value}
      </a>
    );
  }
  if (field.type === "multiselect" && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v) => (
          <span key={v} className="rounded bg-line-2 px-1.5 py-0.5 text-xs">
            {v}
          </span>
        ))}
      </span>
    );
  }
  return <span className={cx(field.type === "textarea" && "whitespace-pre-wrap")}>{text}</span>;
}
