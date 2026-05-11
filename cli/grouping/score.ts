import type { FlatMember } from "../flat-member";
import {
  ageProximity,
  confidenceFloor,
  deptDiversity,
  eiBalance,
  genderBalance,
  mbtiDiversity,
  recentPairPenalty,
  tenureMix,
  vibeDiversity,
} from "./metrics";
import {
  METRIC_KEYS,
  type MetricKey,
  type MetricParams,
  type Weights,
} from "./profile-config";
import type { RecentPairs } from "./pair-key";

export type MetricBreakdown = Record<MetricKey, number>;

export type ScoringContext = {
  weights: Weights;
  history: RecentPairs;
  metricParams: MetricParams;
};

export function metricsForGroup(
  group: FlatMember[],
  ctx: ScoringContext,
): MetricBreakdown {
  return {
    genderBalance: genderBalance(group),
    deptDiversity: deptDiversity(group),
    eiBalance: eiBalance(group),
    vibeDiversity: vibeDiversity(group),
    mbtiDiversity: mbtiDiversity(group),
    ageProximity: ageProximity(group, ctx.metricParams.ageCurveExponent),
    tenureMix: tenureMix(group),
    confidenceFloor: confidenceFloor(group),
    recentPairPenalty: recentPairPenalty(group, ctx.history),
  };
}

export function scoreGroup(
  group: FlatMember[],
  ctx: ScoringContext,
): { score: number; breakdown: MetricBreakdown } {
  const breakdown = metricsForGroup(group, ctx);
  const score = weightedAverage(breakdown, ctx.weights);
  return { score, breakdown };
}

export function weightedAverage(
  breakdown: MetricBreakdown,
  weights: Weights,
): number {
  let num = 0;
  let den = 0;
  for (const k of METRIC_KEYS) {
    const w = weights[k];
    if (w <= 0) continue;
    num += w * breakdown[k];
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

export type SolutionScore = {
  total: number;
  groupScores: number[];
  groupBreakdowns: MetricBreakdown[];
};

export function scoreSolution(
  groups: FlatMember[][],
  ctx: ScoringContext,
): SolutionScore {
  const groupScores: number[] = [];
  const groupBreakdowns: MetricBreakdown[] = [];
  for (const g of groups) {
    const { score, breakdown } = scoreGroup(g, ctx);
    groupScores.push(score);
    groupBreakdowns.push(breakdown);
  }
  const mean =
    groupScores.length === 0
      ? 0
      : groupScores.reduce((a, b) => a + b, 0) / groupScores.length;
  let variance = 0;
  for (const s of groupScores) variance += (s - mean) ** 2;
  variance /= Math.max(1, groupScores.length);
  const stddev = Math.sqrt(variance);
  return { total: mean - 0.5 * stddev, groupScores, groupBreakdowns };
}
