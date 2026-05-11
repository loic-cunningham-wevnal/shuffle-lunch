import type { FlatMember } from "../flat-member";
import { pairKey, type RecentPairs } from "./pair-key";

const SENIOR_AFTER_YEARS = 3;
const CONFIDENCE_SCORE: Record<string, number> = {
  low: 0.3,
  medium: 0.7,
  high: 1.0,
};

export function genderBalance(group: FlatMember[]): number {
  const known = group.filter((p) => p.gender !== null && p.gender !== "unknown");
  if (known.length === 0) return 0.5;
  const female = known.filter((p) => p.gender === "female").length;
  const frac = female / known.length;
  return 1 - 2 * Math.abs(frac - 0.5);
}

export function deptDiversity(group: FlatMember[]): number {
  if (group.length === 0) return 0;
  const unique = new Set(group.map((p) => p.department)).size;
  return unique / group.length;
}

export function eiBalance(group: FlatMember[]): number {
  let e = 0;
  let i = 0;
  for (const p of group) {
    const m = p.mbti;
    if (!m || m === "Unknown") continue;
    if (m[0] === "E") e++;
    else if (m[0] === "I") i++;
  }
  const known = e + i;
  if (known === 0) return 0.5;
  return 1 - 2 * Math.abs(e / known - 0.5);
}

export function vibeDiversity(group: FlatMember[]): number {
  if (group.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const p of group) {
    const v = p.vibe;
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0.5;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) entropy -= p * Math.log(p);
  }
  const maxEntropy = Math.log(Math.min(6, group.length));
  return maxEntropy === 0 ? 1 : entropy / maxEntropy;
}

export function mbtiDiversity(group: FlatMember[]): number {
  // For each axis (N/S, T/F, J/P), measure spread = 1 - 2·|maj_frac − 0.5|.
  // Mean over the 3 axes. Skips Unknown / missing.
  const axes: Array<[string, string, number]> = [
    ["N", "S", 1],
    ["T", "F", 2],
    ["J", "P", 3],
  ];
  const scores: number[] = [];
  for (const [a, , idx] of axes) {
    let aCount = 0;
    let total = 0;
    for (const p of group) {
      const m = p.mbti;
      if (!m || m === "Unknown") continue;
      const ch = m[idx];
      if (ch === a) aCount++, total++;
      else if (ch !== undefined) total++;
    }
    if (total === 0) {
      scores.push(0.5);
      continue;
    }
    scores.push(1 - 2 * Math.abs(aCount / total - 0.5));
  }
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// Returns 1.0 when ages are identical, 0 when their (curve-transformed)
// stddev exceeds the calibrated threshold. The curve compresses older ages so
// that a 1-year gap at 22 penalizes more than a 1-year gap at 42 — older
// people are statistically more likely to share life-stage interests across
// small age differences.
//
// `curveExponent` controls compression strength (default 0.5 = sqrt). 1.0 =
// linear (raw years), 0.3 = aggressive compression, 0 = ignore age entirely.
//
// Falls back to 0.5 if fewer than 2 ages are present (sparse Notion data).
export function ageProximity(
  group: FlatMember[],
  curveExponent: number = 0.5,
): number {
  const ages: number[] = [];
  for (const p of group) {
    if (p.age !== null) ages.push(p.age);
  }
  if (ages.length < 2) return 0.5;
  const perceived = ages.map((a) =>
    Math.pow(Math.max(1, a - 17), curveExponent),
  );
  const mean = perceived.reduce((a, b) => a + b, 0) / perceived.length;
  let variance = 0;
  for (const p of perceived) variance += (p - mean) ** 2;
  variance /= perceived.length;
  const stddev = Math.sqrt(variance);
  // Calibrate so that with the linear curve (exp=1.0) an 8-year stddev → 0,
  // matching the previous behavior. For other exponents, scale the threshold
  // by the same exponent so the metric stays in [0,1].
  const norm = Math.pow(8, curveExponent);
  return Math.max(0, 1 - stddev / norm);
}

export function tenureMix(group: FlatMember[], today = new Date()): number {
  const cutoff = today.getFullYear() - SENIOR_AFTER_YEARS;
  let senior = 0;
  let total = 0;
  for (const p of group) {
    if (p.joined_year === null) continue;
    total++;
    if (p.joined_year <= cutoff) senior++;
  }
  if (total === 0) return 0.5;
  return 1 - 2 * Math.abs(senior / total - 0.5);
}

export function confidenceFloor(group: FlatMember[]): number {
  let min = 1.0;
  let any = false;
  for (const p of group) {
    const c = p.confidence;
    if (!c) continue;
    any = true;
    const v = CONFIDENCE_SCORE[c] ?? 0.5;
    if (v < min) min = v;
  }
  return any ? min : 0.5;
}

export function recentPairPenalty(
  group: FlatMember[],
  history: RecentPairs,
): number {
  if (group.length < 2 || history.maxSeen === 0) return 1;
  let total = 0;
  let totalPairs = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      totalPairs++;
      const seen = history.pairs.get(pairKey(group[i]!.no, group[j]!.no)) ?? 0;
      total += seen;
    }
  }
  if (totalPairs === 0) return 1;
  const meanSeen = total / totalPairs;
  return 1 - meanSeen / history.maxSeen;
}
