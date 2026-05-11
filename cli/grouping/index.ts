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

  const initialAssigned = warmStart(eligible, opts.groupCount, opts.groupSize, rng);
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
    const shuffled = shuffleAll(eligible, restartRng);
    const restartAssigned = sliceIntoGroups(
      shuffled,
      opts.groupCount,
      opts.groupSize,
    );
    const restartBench = shuffled.slice(opts.groupCount * opts.groupSize);
    const restartGroupsWithBench = withBench(restartAssigned, restartBench);
    const result = simulatedAnneal(restartGroupsWithBench, ctx, {
      iterations: opts.solver.iterations,
      initialTemp: opts.solver.initialTemp,
      endTemp: opts.solver.endTemp,
      threeCycleProbability: opts.solver.threeCycleProbability,
      assignedGroupCount: opts.groupCount,
      rng: restartRng,
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

// Seeded version of the dept-bucket round-robin from src/groups.ts. Inlined so
// the seeded RNG can drive the per-bucket shuffle, giving deterministic output.
function warmStart(
  profiles: FlatMember[],
  groupCount: number,
  groupSize: number,
  rng: Rng,
): FlatMember[][] {
  const buckets = new Map<string, FlatMember[]>();
  for (const p of profiles) {
    const list = buckets.get(p.department) ?? [];
    list.push(p);
    buckets.set(p.department, list);
  }
  for (const list of buckets.values()) seededShuffle(list, rng);

  const sortedDepartments = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const groups: FlatMember[][] = Array.from({ length: groupCount }, () => []);
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

function sliceIntoGroups<T>(
  arr: T[],
  groupCount: number,
  groupSize: number,
): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < groupCount; i++) {
    out.push(arr.slice(i * groupSize, (i + 1) * groupSize));
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
