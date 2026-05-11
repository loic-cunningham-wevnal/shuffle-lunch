import { z } from "zod";
import { FlatMemberSchema, type FlatMember } from "../flat-member";
import { filterEligible, type FilterOptions } from "../groups";
import { createRng, type Rng } from "./rng";
import {
  DEFAULT_METRIC_PARAMS,
  type Weights,
  type SolverSettings,
  type MetricParams,
} from "./profile-config";
import { simulatedAnneal } from "./solver";
import { scoreSolution, type SolutionScore, type ScoringContext, type MetricBreakdown } from "./score";
import type { RecentPairs } from "./pair-key";

// `groupCount` (= bench) is the sentinel for "locked to bench". Group indices
// use 0..groupCount-1 inclusive.
export type LockTarget = number;
export type LockMap = Map<number, LockTarget>;

export type BuildScoredGroupsOptions = {
  profiles: FlatMember[];
  groupCount: number;
  groupSize: number;
  weights: Weights;
  solver: SolverSettings;
  metricParams?: MetricParams;
  history?: RecentPairs;
  filters?: FilterOptions;
  seed?: number;
  onProgress?: (info: {
    restart: number;
    iteration: number;
    best: number;
    current: number;
  }) => void;
  // Member.no → group index (0..groupCount-1) or `groupCount` for bench.
  // Locked members are placed in their target during warm-start AND restarts,
  // and the simulated-annealing loop refuses to swap them. The total head
  // count locked into a single group must not exceed `groupSize`.
  locks?: LockMap;
};

export type BuildScoredGroupsResult = {
  groups: FlatMember[][];
  bench: FlatMember[]; // members not assigned to any group
  initialScore: SolutionScore;
  finalScore: SolutionScore;
  used: number;
  ignored: number;
  seed: number;
};

export const MetricBreakdownSchema = z.object({
  genderBalance: z.number(),
  deptDiversity: z.number(),
  eiBalance: z.number(),
  vibeDiversity: z.number(),
  mbtiDiversity: z.number(),
  ageProximity: z.number(),
  tenureMix: z.number(),
  confidenceFloor: z.number(),
  recentPairPenalty: z.number(),
});

export const ScoredGroupSchema = z.object({
  id: z.number().int().positive(),
  members: z.array(FlatMemberSchema).min(2),
  score: z.number(),
  metrics: MetricBreakdownSchema,
});

export const ScoredGroupsSchema = z.array(ScoredGroupSchema);
export type ScoredGroup = z.infer<typeof ScoredGroupSchema>;

export async function buildScoredGroups(
  opts: BuildScoredGroupsOptions,
): Promise<BuildScoredGroupsResult> {
  const eligible = opts.filters
    ? filterEligible(opts.profiles, opts.filters)
    : opts.profiles;

  const required = opts.groupCount * opts.groupSize;
  if (eligible.length < required) {
    throw new Error(
      `Need ${required} eligible profiles for ${opts.groupCount}×${opts.groupSize}, got ${eligible.length}`,
    );
  }

  const seed = opts.seed ?? Date.now();
  const rng = createRng(seed);

  const history: RecentPairs = opts.history ?? { pairs: new Map(), maxSeen: 0 };
  const ctx: ScoringContext = {
    weights: opts.weights,
    history,
    metricParams: opts.metricParams ?? DEFAULT_METRIC_PARAMS,
  };

  const locks = opts.locks ?? new Map();
  validateLocks(eligible, locks, opts.groupCount, opts.groupSize);
  const lockedNos = new Set(locks.keys());

  const initialAssigned = warmStart(
    eligible,
    opts.groupCount,
    opts.groupSize,
    rng,
    locks,
  );
  const initialBench = leftoverBench(eligible, initialAssigned);
  const initialGroupsWithBench = withBench(initialAssigned, initialBench);
  const initialScore = scoreSolution(initialAssigned, ctx);

  let bestResult = simulatedAnneal(initialGroupsWithBench, ctx, {
    iterations: opts.solver.iterations,
    initialTemp: opts.solver.initialTemp,
    endTemp: opts.solver.endTemp,
    threeCycleProbability: opts.solver.threeCycleProbability,
    assignedGroupCount: opts.groupCount,
    rng,
    lockedMemberNos: lockedNos,
    onProgress: opts.onProgress
      ? (info) =>
          opts.onProgress!({
            restart: 0,
            iteration: info.iteration,
            best: info.best,
            current: info.current,
          })
      : undefined,
  });

  for (let r = 1; r < opts.solver.restarts; r++) {
    const restartRng = createRng(seed ^ ((r + 1) * 0x9e3779b1));
    const restartGroupsWithBench = restartShuffle(
      eligible,
      opts.groupCount,
      opts.groupSize,
      restartRng,
      locks,
    );
    const result = simulatedAnneal(restartGroupsWithBench, ctx, {
      iterations: opts.solver.iterations,
      initialTemp: opts.solver.initialTemp,
      endTemp: opts.solver.endTemp,
      threeCycleProbability: opts.solver.threeCycleProbability,
      assignedGroupCount: opts.groupCount,
      rng: restartRng,
      lockedMemberNos: lockedNos,
      onProgress: opts.onProgress
        ? (info) =>
            opts.onProgress!({
              restart: r,
              iteration: info.iteration,
              best: info.best,
              current: info.current,
            })
        : undefined,
    });
    if (result.totalScore > bestResult.totalScore) bestResult = result;
  }

  const assigned = bestResult.groups.slice(0, opts.groupCount);
  const bench = bestResult.groups[opts.groupCount] ?? [];
  const finalScore = scoreSolution(assigned, ctx);

  return {
    groups: assigned,
    bench,
    initialScore,
    finalScore,
    used: required,
    ignored: eligible.length - required,
    seed,
  };
}

export function buildScoredOutput(
  groups: FlatMember[][],
  groupBreakdowns: MetricBreakdown[],
  groupScores: number[],
): ScoredGroup[] {
  return groups.map((members, i) => ({
    id: i + 1,
    members,
    score: groupScores[i] ?? 0,
    metrics: groupBreakdowns[i]!,
  }));
}

// Validate that the locks fit within the requested shape. Catching this here
// gives a clean error to the caller before the solver bails on the same
// constraint inside SA.
function validateLocks(
  eligible: readonly FlatMember[],
  locks: LockMap,
  groupCount: number,
  groupSize: number,
): void {
  const eligibleNos = new Set(eligible.map((m) => m.no));
  const perGroup = new Array(groupCount).fill(0);
  for (const [no, target] of locks) {
    if (!eligibleNos.has(no)) {
      // Locks for filtered-out members are silently ignored — happens when
      // someone toggles availability after locking.
      continue;
    }
    if (target === groupCount) continue; // bench
    if (target < 0 || target >= groupCount) {
      throw new Error(
        `Lock target ${target} for member ${no} is outside [0, ${groupCount}]`,
      );
    }
    perGroup[target] = (perGroup[target] ?? 0) + 1;
    if (perGroup[target] > groupSize) {
      throw new Error(
        `Group ${target + 1} has ${perGroup[target]} locked members, exceeding groupSize=${groupSize}`,
      );
    }
  }
}

// Seeded version of the dept-bucket round-robin from src/groups.ts. Inlined so
// the seeded RNG can drive the per-bucket shuffle, giving deterministic output.
//
// Locked members are placed in their target group/bench first; the
// round-robin then fills remaining slots. If a member is locked to a group
// that's already full of other locked members, this throws (validateLocks
// catches that earlier).
function warmStart(
  profiles: FlatMember[],
  groupCount: number,
  groupSize: number,
  rng: Rng,
  locks: LockMap,
): FlatMember[][] {
  const groups: FlatMember[][] = Array.from({ length: groupCount }, () => []);

  // Seed locks first — locked-to-group entries land in their group, locked-to-
  // bench entries are removed from the pool entirely (they'll resurface as
  // bench in leftoverBench).
  const lockedNos = new Set<number>();
  for (const p of profiles) {
    const target = locks.get(p.no);
    if (target === undefined) continue;
    if (target === groupCount) {
      // bench
      lockedNos.add(p.no);
      continue;
    }
    groups[target]!.push(p);
    lockedNos.add(p.no);
  }

  const free = profiles.filter((p) => !lockedNos.has(p.no));

  const buckets = new Map<string, FlatMember[]>();
  for (const p of free) {
    const list = buckets.get(p.department) ?? [];
    list.push(p);
    buckets.set(p.department, list);
  }
  for (const list of buckets.values()) seededShuffle(list, rng);

  const sortedDepartments = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  let cursor = 0;
  for (const [, list] of sortedDepartments) {
    for (const member of list) {
      let attempts = 0;
      while (groups[cursor % groupCount]!.length >= groupSize) {
        cursor++;
        if (++attempts > groupCount) break;
      }
      if (attempts > groupCount) break;
      groups[cursor % groupCount]!.push(member);
      cursor++;
    }
    if (groups.every((g) => g.length >= groupSize)) break;
  }
  return groups;
}

// Restart shuffle with locks: locked members stay in their assigned group;
// remaining slots are filled with a re-shuffled subset of the unlocked pool.
function restartShuffle(
  eligible: readonly FlatMember[],
  groupCount: number,
  groupSize: number,
  rng: Rng,
  locks: LockMap,
): FlatMember[][] {
  const groups: FlatMember[][] = Array.from({ length: groupCount }, () => []);
  const benched: FlatMember[] = [];
  const lockedNos = new Set<number>();

  for (const p of eligible) {
    const target = locks.get(p.no);
    if (target === undefined) continue;
    if (target === groupCount) {
      benched.push(p);
    } else {
      groups[target]!.push(p);
    }
    lockedNos.add(p.no);
  }

  const free = eligible.filter((m) => !lockedNos.has(m.no));
  const shuffled = shuffleAll(free, rng);

  // Round-robin fill into groups respecting capacity.
  let cursor = 0;
  for (const m of shuffled) {
    let placed = false;
    for (let attempts = 0; attempts < groupCount; attempts++) {
      const idx = cursor % groupCount;
      cursor++;
      if (groups[idx]!.length < groupSize) {
        groups[idx]!.push(m);
        placed = true;
        break;
      }
    }
    if (!placed) benched.push(m);
  }
  return withBench(groups, benched);
}

function seededShuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function leftoverBench(
  eligible: readonly FlatMember[],
  assigned: readonly FlatMember[][],
): FlatMember[] {
  const used = new Set<number>();
  for (const g of assigned) for (const m of g) used.add(m.no);
  return eligible.filter((p) => !used.has(p.no));
}

function withBench(assigned: FlatMember[][], bench: FlatMember[]): FlatMember[][] {
  return bench.length > 0 ? [...assigned, [...bench]] : [...assigned];
}

function shuffleAll<T>(arr: readonly T[], rng: Rng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export {
  type GroupingProfile,
  type Weights,
  type SolverSettings,
  type MetricParams,
} from "./profile-config";
export { type SolutionScore, type MetricBreakdown } from "./score";
