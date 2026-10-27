import { describe, expect, it } from "vitest";
import { ageOn, formatDateJa, formatDateTimeJa, isIsoDate, tenureYears, todayJst } from "./dates";
import { normalizeForSearch } from "./text";

describe("日付", () => {
  it("誕生日の前後で年齢が変わる", () => {
    expect(ageOn("1990-10-27", "2026-10-26")).toBe(35);
    expect(ageOn("1990-10-27", "2026-10-27")).toBe(36);
    expect(ageOn(null, "2026-10-27")).toBeNull();
  });
  it("勤続年数", () => {
    expect(tenureYears("2016-04-01", "2026-04-01")).toBe(10);
    expect(tenureYears("2027-01-01", "2026-04-01")).toBeNull();
  });
  it("日本時間の日付", () => {
    expect(todayJst(new Date("2026-10-27T16:00:00Z"))).toBe("2026-10-28");
  });
  it("ISO 日付の検証", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024/02/01")).toBe(false);
  });
  it("表示形式", () => {
    expect(formatDateJa("2026-04-01")).toBe("2026年4月1日");
    expect(formatDateTimeJa("2026-10-27 01:02:03")).toBe("2026/10/27 10:02");
  });
});

describe("検索語の正規化", () => {
  it("カタカナ・全角英数・空白を揃える", () => {
    expect(normalizeForSearch("ヤマダ　タロウ")).toBe("やまだたろう");
    expect(normalizeForSearch("Ｅ００１")).toBe("e001");
  });
});
