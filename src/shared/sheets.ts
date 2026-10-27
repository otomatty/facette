import { isIsoDate } from "./dates";
import type { FieldValue, SheetField } from "./types";

export type NormalizeResult =
  | { ok: true; data: Record<string, FieldValue> }
  | { ok: false; errors: Record<string, string> };

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * シートの入力値を項目定義に従って検証・正規化する。
 * 未定義の項目は捨て、型を揃える。
 */
export function normalizeRecordData(fields: SheetField[], input: Record<string, unknown>): NormalizeResult {
  const data: Record<string, FieldValue> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const key = String(f.id);
    const raw = input[key];
    if (isEmpty(raw)) {
      if (f.required && f.type !== "checkbox") errors[key] = `${f.label}を入力してください`;
      data[key] = f.type === "checkbox" ? false : f.type === "multiselect" ? [] : null;
      continue;
    }
    switch (f.type) {
      case "text":
      case "textarea": {
        const s = String(raw).trim();
        const max = f.type === "text" ? 200 : 4000;
        if (s.length > max) errors[key] = `${f.label}は${max}文字以内で入力してください`;
        data[key] = s;
        break;
      }
      case "url": {
        const s = String(raw).trim();
        if (!/^https?:\/\/\S+$/.test(s))
          errors[key] = `${f.label}は http(s):// から始まる URL を入力してください`;
        data[key] = s;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) errors[key] = `${f.label}は数値で入力してください`;
        data[key] = Number.isFinite(n) ? n : null;
        break;
      }
      case "date": {
        const s = String(raw).trim().replace(/\//g, "-");
        const padded = s.replace(
          /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
          (_, y, m, d) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
        );
        if (!isIsoDate(padded)) errors[key] = `${f.label}は日付（YYYY-MM-DD）で入力してください`;
        data[key] = padded;
        break;
      }
      case "select": {
        const s = String(raw);
        if (!f.options.includes(s)) errors[key] = `${f.label}の選択肢にない値です`;
        data[key] = s;
        break;
      }
      case "multiselect": {
        const arr = Array.isArray(raw) ? raw.map(String) : String(raw).split("|").filter(Boolean);
        const bad = arr.filter((v) => !f.options.includes(v));
        if (bad.length) errors[key] = `${f.label}の選択肢にない値です（${bad.join("、")}）`;
        data[key] = [...new Set(arr)];
        break;
      }
      case "checkbox": {
        data[key] =
          raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "はい" || raw === "○";
        break;
      }
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data };
}

/** 表示用に値を文字列化 */
export function formatFieldValue(field: Pick<SheetField, "type">, value: FieldValue | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (field.type === "checkbox") return value ? "はい" : "いいえ";
  if (Array.isArray(value)) return value.join("、");
  if (field.type === "number" && typeof value === "number") return value.toLocaleString("ja-JP");
  return String(value);
}
