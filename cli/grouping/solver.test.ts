import { test, expect } from "bun:test";
import { buildScoredGroups } from "./index";
import { DEFAULT_PROFILE } from "./profile-config";
import { loadEnrichedMembers } from "../cmd/load";
import { filterEligible } from "../groups";

test("solver: deterministic with same seed", async () => {
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const opts = {
    profiles: eligible,
    groupCount: 10,
    groupSize: 5,
    weights: DEFAULT_PROFILE.weights,
    solver: { ...DEFAULT_PROFILE.solver, iterations: 2000, restarts: 2 },
    seed: 1234,
  };
  const a = await buildScoredGroups(opts);
  const b = await buildScoredGroups(opts);
  expect(a.finalScore.total).toBeCloseTo(b.finalScore.total, 6);
  // group composition should match
  for (let i = 0; i < a.groups.length; i++) {
    const aSet = a.groups[i]!.map((p) => p.no).sort().join(",");
    const bSet = b.groups[i]!.map((p) => p.no).sort().join(",");
    expect(aSet).toBe(bSet);
  }
});

test("solver: improves over warm-start round-robin", async () => {
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const result = await buildScoredGroups({
    profiles: eligible,
    groupCount: 30,
    groupSize: 5,
    weights: DEFAULT_PROFILE.weights,
    solver: { ...DEFAULT_PROFILE.solver, iterations: 5000, restarts: 2 },
    seed: 42,
  });
  expect(result.finalScore.total).toBeGreaterThan(result.initialScore.total);
});

test("solver: 3-cycle moves preserve membership and improve score", async () => {
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const result = await buildScoredGroups({
    profiles: eligible,
    groupCount: 12,
    groupSize: 5,
    weights: DEFAULT_PROFILE.weights,
    // Force 3-cycles on most iterations to exercise that code path.
    solver: {
      ...DEFAULT_PROFILE.solver,
      iterations: 4000,
      restarts: 1,
      threeCycleProbability: 0.9,
    },
    seed: 7,
  });
  // No duplicates / dropped members
  const allNos = result.groups.flat().map((p) => p.no);
  expect(new Set(allNos).size).toBe(allNos.length);
  expect(allNos.length).toBe(60);
  // Score must still improve over warm-start
  expect(result.finalScore.total).toBeGreaterThan(result.initialScore.total);
});

test("solver: bench members can swap into final groups", async () => {
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const groupCount = 20;
  const groupSize = 4;
  // We expect leftover bench of eligible.length - 80 members.
  expect(eligible.length).toBeGreaterThan(groupCount * groupSize);

  const result = await buildScoredGroups({
    profiles: eligible,
    groupCount,
    groupSize,
    weights: DEFAULT_PROFILE.weights,
    solver: { ...DEFAULT_PROFILE.solver, iterations: 5000, restarts: 2 },
    seed: 11,
  });
  // bench is reported and non-empty
  expect(result.bench.length).toBeGreaterThan(0);
  expect(result.groups.length).toBe(groupCount);
  for (const g of result.groups) expect(g.length).toBe(groupSize);

  // No member appears in both groups and bench
  const inGroups = new Set(result.groups.flat().map((p) => p.no));
  for (const b of result.bench) expect(inGroups.has(b.no)).toBe(false);

  // Total members across groups + bench equals eligible
  expect(inGroups.size + result.bench.length).toBe(eligible.length);
});

test("solver: full-pool optimization beats fixed warm-start subset", async () => {
  // With the bench enabled, the solver can substitute leftover members in.
  // The improvement should beat what the warm-start alone produced.
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const result = await buildScoredGroups({
    profiles: eligible,
    groupCount: 20,
    groupSize: 4,
    weights: DEFAULT_PROFILE.weights,
    solver: { ...DEFAULT_PROFILE.solver, iterations: 8000, restarts: 2 },
    seed: 1234,
  });
  expect(result.finalScore.total).toBeGreaterThan(result.initialScore.total);
});

test("solver: existing preset JSONs parse with threeCycleProbability default", async () => {
  // Sanity: schema defaults apply when the field is missing from disk.
  const { listProfiles } = await import("./profile-store");
  const profiles = await listProfiles();
  expect(profiles.length).toBeGreaterThan(0);
  for (const p of profiles) {
    expect(p.solver.threeCycleProbability).toBeGreaterThanOrEqual(0);
    expect(p.solver.threeCycleProbability).toBeLessThanOrEqual(1);
  }
});

test("solver: produces exactly groupCount × groupSize members, no duplicates", async () => {
  const { members } = await loadEnrichedMembers();
  const eligible = filterEligible(members, {});
  const result = await buildScoredGroups({
    profiles: eligible,
    groupCount: 20,
    groupSize: 5,
    weights: DEFAULT_PROFILE.weights,
    solver: { ...DEFAULT_PROFILE.solver, iterations: 1000, restarts: 1 },
    seed: 99,
  });
  expect(result.groups.length).toBe(20);
  for (const g of result.groups) expect(g.length).toBe(5);
  const allNos = result.groups.flat().map((p) => p.no);
  expect(new Set(allNos).size).toBe(allNos.length);
  expect(result.used).toBe(100);
  expect(result.ignored).toBe(eligible.length - 100);
});
