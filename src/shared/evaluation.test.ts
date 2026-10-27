import { describe, expect, it } from "vitest";
import {
  nextStep,
  previousStep,
  rankFor,
  totalScore,
  validateGoalWeights,
  weightedAverage,
} from "./evaluation";

describe("評価の計算", () => {
  it("重み付き平均は未入力を除外する", () => {
    expect(
      weightedAverage([
        { weight: 60, score: 4 },
        { weight: 40, score: 2 },
      ]),
    ).toBeCloseTo(3.2);
    expect(
      weightedAverage([
        { weight: 60, score: 4 },
        { weight: 40, score: null },
      ]),
    ).toBe(4);
    expect(weightedAverage([{ weight: 1, score: null }])).toBeNull();
  });

  it("目標と行動を配分比率で合成する", () => {
    const score = totalScore({
      goals: [
        { weight: 50, score: 5 },
        { weight: 50, score: 3 },
      ],
      items: [
        { weight: 1, score: 2 },
        { weight: 1, score: 4 },
      ],
      goalWeight: 60,
      competencyWeight: 40,
    });
    // goals=4, items=3 → 4*0.6 + 3*0.4 = 3.6
    expect(score).toBe(3.6);
  });

  it("目標がない場合は行動評価のみで算出する", () => {
    expect(
      totalScore({ goals: [], items: [{ weight: 1, score: 3 }], goalWeight: 60, competencyWeight: 40 }),
    ).toBe(3);
  });

  it("ランクは下限値の高い順に判定する", () => {
    expect(rankFor(4.6)).toBe("S");
    expect(rankFor(3.75)).toBe("A");
    expect(rankFor(3.74)).toBe("B");
    expect(rankFor(0.5)).toBe("D");
    expect(rankFor(null)).toBeNull();
  });

  it("二次評価の有無でステップ遷移が変わる", () => {
    expect(nextStep("first", true)).toBe("second");
    expect(nextStep("first", false)).toBe("final");
    expect(previousStep("final", false)).toBe("first");
    expect(previousStep("goal", true)).toBeNull();
    expect(nextStep("done", true)).toBe("done");
  });

  it("目標ウェイトの合計は100", () => {
    expect(validateGoalWeights([60, 40])).toBeNull();
    expect(validateGoalWeights([60, 30])).toContain("90");
    expect(validateGoalWeights([])).toContain("1件以上");
  });
});
