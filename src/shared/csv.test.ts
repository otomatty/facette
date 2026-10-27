import { describe, expect, it } from "vitest";
import { escapeCsvCell, parseCsv, toCsv } from "./csv";

describe("CSV", () => {
  it("カンマ・改行・引用符をエスケープする", () => {
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
    expect(escapeCsvCell("x\ny")).toBe('"x\ny"');
    expect(escapeCsvCell(["電車", "バス"])).toBe("電車|バス");
    expect(escapeCsvCell(null)).toBe("");
  });

  it("出力したものを読み戻せる（BOM・CRLF 対応）", () => {
    const rows = [
      ["社員番号", "氏名", "メモ"],
      ["E1", "山田, 太郎", '彼は"天才"\n二行目'],
    ];
    const text = `﻿${toCsv(rows)}\r\n`;
    expect(parseCsv(text)).toEqual(rows);
  });

  it("空行を無視する", () => {
    expect(parseCsv("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
