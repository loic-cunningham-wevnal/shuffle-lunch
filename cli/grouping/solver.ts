import type { FlatMember } from "../flat-member";
import {
  metricsForGroup,
  weightedAverage,
  type MetricBreakdown,
  type ScoringContext,
} from "./score";
import type { Rng } from "./rng";

export type SolverOptions = {
  iterations: number;
  initialTemp: number;
  endTemp: number;
  threeCycleProbability: number;
  // The first `assignedGroupCount` entries of `initialGroups` are real groups.
  // Any additional entries are treated as a bench: members can swap in/out of
  // real groups, but the bench's score is excluded from the solution total.
  assignedGroupCount: number;
  rng: Rng;
  onProgress?: (info: { iteration: number; best: number; current: number }) => void;
  progressInterval?: number;
  // Set of member.no values that must stay in their current group for the
  // entire run. Any swap proposal touching a locked member is skipped.
  lockedMemberNos?: Set<number>;
};

export type SolverResult = {
  // Includes the bench at index `assignedGroupCount` if there was one. Caller
  // is responsible for stripping it.
  groups: FlatMember[][];
  groupScores: number[]; // length = assignedGroupCount
  groupBreakdowns: MetricBreakdown[]; // length = assignedGroupCount
  totalScore: number;
  iterationsRun: number;
};

export function simulatedAnneal(
  initialGroups: FlatMember[][],
  ctx: ScoringContext,
  opts: SolverOptions,
): SolverResult {
  const groups = initialGroups.map((g) => [...g]);
  const N = opts.assignedGroupCount;
  if (N <= 0 || N > groups.length) {
    throw new Error(
      `assignedGroupCount=${N} must be in [1, ${groups.length}]`,
    );
  }

  // Only assigned groups get scored.
  const breakdowns: MetricBreakdown[] = new Array(N);
  const groupScores: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    breakdowns[i] = metricsForGroup(groups[i]!, ctx);
    groupScores[i] = weightedAverage(breakdowns[i]!, ctx.weights);
  }

  let bestGroups = groups.map((g) => [...g]);
  let bestBreakdowns = breakdowns.map((b) => ({ ...b }));
  let bestGroupScores = [...groupScores];
  let bestTotal = solutionTotal(groupScores);
  let currentTotal = bestTotal;

  const { iterations, initialTemp, endTemp, threeCycleProbability, rng } = opts;
  const alpha = (endTemp / initialTemp) ** (1 / Math.max(1, iterations - 1));
  let temp = initialTemp;

  const progressEvery = opts.progressInterval ?? Math.max(1, Math.floor(iterations / 100));
  const newGroupScores = groupScores.slice();
  const locked = opts.lockedMemberNos ?? new Set<number>();

  for (let iter = 0; iter < iterations; iter++) {
    const useThreeCycle =
      groups.length >= 3 && rng.next() < threeCycleProbability;

    const move = useThreeCycle
      ? applyThreeCycle(groups, rng, locked)
      : applyPairSwap(groups, rng, locked);
    if (move === null) {
      temp *= alpha;
      continue;
    }
    const { affected, revert } = move;

    // Recompute breakdowns only for affected ASSIGNED groups (skip bench).
    const newBreakdowns: (MetricBreakdown | null)[] = affected.map((gi) =>
      gi < N ? metricsForGroup(groups[gi]!, ctx) : null,
    );
    const newScores: (number | null)[] = newBreakdowns.map((b) =>
      b === null ? null : weightedAverage(b, ctx.weights),
    );

    for (let k = 0; k < affected.length; k++) {
      const gi = affected[k]!;
      if (gi < N) newGroupScores[gi] = newScores[k]!;
    }
    const newTotal = solutionTotal(newGroupScores);
    const delta = newTotal - currentTotal;

    const accept = delta >= 0 ? true : rng.next() < Math.exp(delta / Math.max(temp, 1e-9));

    if (accept) {
      for (let k = 0; k < affected.length; k++) {
        const gi = affected[k]!;
        if (gi < N) {
          breakdowns[gi] = newBreakdowns[k]!;
          groupScores[gi] = newScores[k]!;
        }
      }
      currentTotal = newTotal;
      if (currentTotal > bestTotal) {
        bestTotal = currentTotal;
        bestGroups = groups.map((g) => [...g]);
        bestBreakdowns = breakdowns.map((b) => ({ ...b }));
        bestGroupScores = [...groupScores];
      }
    } else {
      revert();
      for (const gi of affected) {
        if (gi < N) newGroupScores[gi] = groupScores[gi]!;
      }
    }

    if (opts.onProgress && iter % progressEvery === 0) {
      opts.onProgress({ iteration: iter, best: bestTotal, current: currentTotal });
    }
    temp *= alpha;
  }

  if (opts.onProgress) {
    opts.onProgress({ iteration: iterations, best: bestTotal, current: currentTotal });
  }

  return {
    groups: bestGroups,
    groupScores: bestGroupScores,
    groupBreakdowns: bestBreakdowns,
    totalScore: bestTotal,
    iterationsRun: iterations,
  };
}

type Move = { affected: number[]; revert: () => void };

// Pick a group index with probability proportional to the number of members in
// that group. Keeps every member equally likely to be selected for a swap —
// otherwise a 70-member bench would be picked at the same rate as a 4-member
// group.
function pickGroupBySize(
  groups: FlatMember[][],
  rng: Rng,
  exclude: number[],
): number {
  let total = 0;
  for (let i = 0; i < groups.length; i++) {
    if (exclude.includes(i)) continue;
    total += groups[i]!.length;
  }
  if (total === 0) return -1;
  let r = rng.next() * total;
  for (let i = 0; i < groups.length; i++) {
    if (exclude.includes(i)) continue;
    r -= groups[i]!.length;
    if (r <= 0) return i;
  }
  // Floating-point fallback: return last non-excluded.
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!exclude.includes(i)) return i;
  }
  return -1;
}

// Pick an unlocked member from a group, or -1 if none. We iterate from a
// random offset and wrap so the choice stays roughly uniform among unlocked
// members without an extra allocation.
function pickUnlockedMemberIdx(
  group: FlatMember[],
  rng: Rng,
  locked: ReadonlySet<number>,
): number {
  const n = group.length;
  if (n === 0) return -1;
  const start = rng.int(n);
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % n;
    if (!locked.has(group[idx]!.no)) return idx;
  }
  return -1;
}

function applyPairSwap(
  groups: FlatMember[][],
  rng: Rng,
  locked: ReadonlySet<number>,
): Move | null {
  if (groups.length < 2) return null;
  const gi = pickGroupBySize(groups, rng, []);
  if (gi < 0) return null;
  const gj = pickGroupBySize(groups, rng, [gi]);
  if (gj < 0) return null;
  const arrI = groups[gi]!;
  const arrJ = groups[gj]!;
  if (arrI.length === 0 || arrJ.length === 0) return null;
  const idxI = pickUnlockedMemberIdx(arrI, rng, locked);
  const idxJ = pickUnlockedMemberIdx(arrJ, rng, locked);
  if (idxI < 0 || idxJ < 0) return null;
  const a = arrI[idxI]!;
  const b = arrJ[idxJ]!;
  arrI[idxI] = b;
  arrJ[idxJ] = a;
  return {
    affected: [gi, gj],
    revert: () => {
      arrI[idxI] = a;
      arrJ[idxJ] = b;
    },
  };
}

function applyThreeCycle(
  groups: FlatMember[][],
  rng: Rng,
  locked: ReadonlySet<number>,
): Move | null {
  if (groups.length < 3) return null;
  const gi = pickGroupBySize(groups, rng, []);
  if (gi < 0) return null;
  const gj = pickGroupBySize(groups, rng, [gi]);
  if (gj < 0) return null;
  const gk = pickGroupBySize(groups, rng, [gi, gj]);
  if (gk < 0) return null;
  const arrI = groups[gi]!;
  const arrJ = groups[gj]!;
  const arrK = groups[gk]!;
  if (arrI.length === 0 || arrJ.length === 0 || arrK.length === 0) return null;
  const idxI = pickUnlockedMemberIdx(arrI, rng, locked);
  const idxJ = pickUnlockedMemberIdx(arrJ, rng, locked);
  const idxK = pickUnlockedMemberIdx(arrK, rng, locked);
  if (idxI < 0 || idxJ < 0 || idxK < 0) return null;
  const a = arrI[idxI]!;
  const b = arrJ[idxJ]!;
  const c = arrK[idxK]!;
  // Rotation: a → gj, b → gk, c → gi
  arrI[idxI] = c;
  arrJ[idxJ] = a;
  arrK[idxK] = b;
  return {
    affected: [gi, gj, gk],
    revert: () => {
      arrI[idxI] = a;
      arrJ[idxJ] = b;
      arrK[idxK] = c;
    },
  };
}

function solutionTotal(groupScores: number[]): number {
  if (groupScores.length === 0) return 0;
  const mean = groupScores.reduce((a, b) => a + b, 0) / groupScores.length;
  let variance = 0;
  for (const s of groupScores) variance += (s - mean) ** 2;
  variance /= groupScores.length;
  return mean - 0.5 * Math.sqrt(variance);
}
