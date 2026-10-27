import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart, foldSeries } from "./charts";

describe("グラフ", () => {
  it("9系列目以降は「その他」にまとめる", () => {
    const data = {
      labels: ["A"],
      series: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, values: [i] })),
      total: 0,
    };
    const folded = foldSeries(data);
    expect(folded.series).toHaveLength(8);
    expect(folded.series.at(-1)).toEqual({ name: "その他", values: [7 + 8 + 9] });
  });

  it("横棒グラフは区分名と値を文字で表示し、表に切り替えられる", async () => {
    render(
      <BarChart
        data={{ labels: ["営業部", "開発部"], series: [{ name: "人数", values: [12, 30] }], total: 42 }}
      />,
    );
    expect(screen.getByText("営業部")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    screen.getByRole("button", { name: "表で見る" }).click();
    expect(await screen.findByRole("table")).toBeTruthy();
  });
});
