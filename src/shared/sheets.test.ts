import { describe, expect, it } from "vitest";
import { formatFieldValue, normalizeRecordData } from "./sheets";
import type { SheetField } from "./types";

const f = (id: number, type: SheetField["type"], extra: Partial<SheetField> = {}): SheetField => ({
  id,
  sheetId: 1,
  label: `項目${id}`,
  type,
  options: [],
  required: false,
  helpText: "",
  sortOrder: id,
  ...extra,
});

describe("シート値の正規化", () => {
  it("型を揃え、未定義の項目を捨てる", () => {
    const fields = [
      f(1, "number"),
      f(2, "date"),
      f(3, "multiselect", { options: ["A", "B"] }),
      f(4, "checkbox"),
      f(5, "text"),
    ];
    const r = normalizeRecordData(fields, {
      "1": "1,200",
      "2": "2024/3/5",
      "3": "A|B|A",
      "4": "はい",
      "9": "x",
    });
    expect(r).toEqual({
      ok: true,
      data: { "1": 1200, "2": "2024-03-05", "3": ["A", "B"], "4": true, "5": null },
    });
  });

  it("必須・選択肢・URL・日付の誤りを項目ごとに返す", () => {
    const fields = [
      f(1, "text", { required: true }),
      f(2, "select", { options: ["高"] }),
      f(3, "url"),
      f(4, "date"),
      f(5, "number"),
    ];
    const r = normalizeRecordData(fields, {
      "2": "低",
      "3": "javascript:alert(1)",
      "4": "2024-13-01",
      "5": "abc",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("表示用の文字列化", () => {
    expect(formatFieldValue({ type: "checkbox" }, true)).toBe("はい");
    expect(formatFieldValue({ type: "multiselect" }, ["A", "B"])).toBe("A、B");
    expect(formatFieldValue({ type: "number" }, 12000)).toBe("12,000");
    expect(formatFieldValue({ type: "text" }, null)).toBe("");
  });
});
