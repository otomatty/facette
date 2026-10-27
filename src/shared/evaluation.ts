import { DEFAULT_RANK_RULES, type EvalPhase, type EvalStep } from "./constants";

export type RankRule = { rank: string; min: number };

export type WeightedScore = { weight: number; score: number | null | undefined };

/** 重み付き平均。未入力（null）は除外し、全て未入力なら null */
export function weightedAverage(items: WeightedScore[]): number | null {
  let sum = 0;
  let total = 0;
  for (const it of items) {
    if (it.score === null || it.score === undefined || Number.isNaN(it.score)) continue;
    const w = Math.max(it.weight, 0);
    sum += it.score * w;
    total += w;
  }
  if (total === 0) return null;
  return sum / total;
}

export type ScoreInput = {
  goals: WeightedScore[];
  items: WeightedScore[];
  goalWeight: number;
  competencyWeight: number;
};

/** 目標（業績）と行動（コンピテンシー）を配分比率で合成した総合点 */
export function totalScore(input: ScoreInput): number | null {
  const g = weightedAverage(input.goals);
  const c = weightedAverage(input.items);
  const parts: WeightedScore[] = [];
  if (input.goals.length > 0) parts.push({ weight: input.goalWeight, score: g });
  if (input.items.length > 0) parts.push({ weight: input.competencyWeight, score: c });
  const avg = weightedAverage(parts);
  return avg === null ? null : Math.round(avg * 100) / 100;
}

export function rankFor(score: number | null, rules: RankRule[] = DEFAULT_RANK_RULES): string | null {
  if (score === null) return null;
  const sorted = [...rules].sort((a, b) => b.min - a.min);
  for (const r of sorted) {
    if (score >= r.min) return r.rank;
  }
  return sorted.at(-1)?.rank ?? null;
}

/** 次のステップ（二次評価を使わない場合はスキップ） */
export function nextStep(step: EvalStep, useSecond: boolean): EvalStep {
  switch (step) {
    case "goal":
      return "self";
    case "self":
      return "first";
    case "first":
      return useSecond ? "second" : "final";
    case "second":
      return "final";
    case "final":
      return "done";
    case "done":
      return "done";
  }
}

/** 差し戻し先のステップ */
export function previousStep(step: EvalStep, useSecond: boolean): EvalStep | null {
  switch (step) {
    case "goal":
      return null;
    case "self":
      return "goal";
    case "first":
      return "self";
    case "second":
      return "first";
    case "final":
      return useSecond ? "second" : "first";
    case "done":
      return "final";
  }
}

/** ステップごとに入力するフェーズ */
export function phaseOfStep(step: EvalStep): EvalPhase | null {
  if (step === "self" || step === "first" || step === "second" || step === "final") return step;
  return null;
}

export function validateGoalWeights(weights: number[]): string | null {
  if (weights.length === 0) return "目標を1件以上登録してください";
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum !== 100) return `目標のウェイト合計を100にしてください（現在 ${sum}）`;
  return null;
}
