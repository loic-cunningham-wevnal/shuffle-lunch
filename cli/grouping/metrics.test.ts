import { test, expect } from "bun:test";
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
import type { FlatMember } from "../flat-member";

function p(
  no: number,
  opts: {
    name?: string;
    department?: string;
    is_remote?: boolean;
    is_unavailable?: boolean;
    prev_count?: number;
    gender?: FlatMember["gender"];
    mbti?: FlatMember["mbti"];
    vibe?: FlatMember["vibe"];
    confidence?: FlatMember["confidence"];
    ai_notes?: string | null;
    enrichment?: null;
    joinedDate?: string | null;
    age?: string | null;
    joined_year?: number | null;
    age_num?: number | null;
  } = {},
): FlatMember {
  // For backwards-compat with old fixtures, allow joinedDate ("2018年1月") and age ("28 歳")
  const joined_year =
    opts.joined_year !== undefined
      ? opts.joined_year
      : opts.joinedDate === undefined
        ? null
        : opts.joinedDate === null
          ? null
          : (() => {
              const m = opts.joinedDate.match(/(20\d{2})/);
              return m ? Number(m[1]) : null;
            })();
  const age =
    opts.age_num !== undefined
      ? opts.age_num
      : opts.age === undefined
        ? null
        : opts.age === null
          ? null
          : (() => {
              const m = opts.age.match(/(\d+)/);
              return m ? Number(m[1]) : null;
            })();

  // If `enrichment: null` was passed (old API), null out all enrichment fields.
  const enrichmentNull = opts.enrichment === null;

  return {
    no,
    name: opts.name ?? `m${no}`,
    name_romaji: null,
    department: opts.department ?? "Eng",
    detailed_department: null,
    job_title: null,
    joined_year,
    age,
    hometown: null,
    hobbies: null,
    comment: null,
    surprising_fact: null,
    is_remote: opts.is_remote ?? false,
    is_unavailable: opts.is_unavailable ?? false,
    prev_count: opts.prev_count ?? 0,
    birth_month_flag: false,
    gender: enrichmentNull ? null : (opts.gender ?? "unknown"),
    mbti: enrichmentNull ? null : (opts.mbti ?? "Unknown"),
    vibe: enrichmentNull ? null : (opts.vibe ?? "social"),
    confidence: enrichmentNull ? null : (opts.confidence ?? "medium"),
    ai_notes: enrichmentNull ? null : (opts.ai_notes ?? null),
  };
}

test("genderBalance: perfect 50/50", () => {
  const g = [p(1, { gender: "female" }), p(2, { gender: "male" })];
  expect(genderBalance(g)).toBeCloseTo(1.0, 3);
});

test("genderBalance: all-male is worst", () => {
  const g = [1, 2, 3, 4].map((no) => p(no, { gender: "male" }));
  expect(genderBalance(g)).toBeCloseTo(0, 3);
});

test("genderBalance: ignores 'unknown'", () => {
  const g = [
    p(1, { gender: "female" }),
    p(2, { gender: "male" }),
    p(3, { gender: "unknown" }),
  ];
  expect(genderBalance(g)).toBeCloseTo(1.0, 3);
});

test("deptDiversity: all-different is 1, all-same is 1/N", () => {
  const allDiff = [
    p(1, { department: "A" }),
    p(2, { department: "B" }),
    p(3, { department: "C" }),
  ];
  expect(deptDiversity(allDiff)).toBeCloseTo(1.0);
  const allSame = [
    p(1, { department: "A" }),
    p(2, { department: "A" }),
    p(3, { department: "A" }),
  ];
  expect(deptDiversity(allSame)).toBeCloseTo(1 / 3);
});

test("eiBalance: perfect 50/50 from MBTI first letter", () => {
  const g = [p(1, { mbti: "ENTP-T" }), p(2, { mbti: "INFJ-A" })];
  expect(eiBalance(g)).toBeCloseTo(1.0);
});

test("eiBalance: all-E is 0", () => {
  const g = [p(1, { mbti: "ENTP-T" }), p(2, { mbti: "ESFP-A" })];
  expect(eiBalance(g)).toBeCloseTo(0);
});

test("eiBalance: all 'Unknown' falls back to 0.5", () => {
  const g = [p(1, { mbti: "Unknown" }), p(2, { mbti: "Unknown" })];
  expect(eiBalance(g)).toBeCloseTo(0.5);
});

test("vibeDiversity: all same vibe is 0; all different scales with entropy", () => {
  const allSame = [1, 2, 3, 4].map((n) => p(n, { vibe: "social" }));
  expect(vibeDiversity(allSame)).toBeCloseTo(0);
  const allDiff = [
    p(1, { vibe: "analytical" }),
    p(2, { vibe: "social" }),
    p(3, { vibe: "creative" }),
    p(4, { vibe: "playful" }),
  ];
  expect(vibeDiversity(allDiff)).toBeCloseTo(1.0);
});

test("mbtiDiversity: all-same axes → 0, perfect spread → 1", () => {
  const allSame = [1, 2].map((n) => p(n, { mbti: "INTJ-A" }));
  expect(mbtiDiversity(allSame)).toBeCloseTo(0);
  const perfectSpread = [
    p(1, { mbti: "INTJ-A" }),
    p(2, { mbti: "ESFP-T" }),
  ];
  expect(mbtiDiversity(perfectSpread)).toBeCloseTo(1.0);
});

test("tenureMix: 50/50 senior vs new is 1.0", () => {
  const g = [
    p(1, { joinedDate: "2018年1月" }),
    p(2, { joinedDate: "2019年1月" }),
    p(3, { joinedDate: "2025年1月" }),
    p(4, { joinedDate: "2026年1月" }),
  ];
  // With today=2026, cutoff=2023, 2 senior / 2 new → 1.0
  expect(tenureMix(g, new Date("2026-05-01"))).toBeCloseTo(1.0);
});

test("ageProximity: identical ages → 1.0", () => {
  const g = [
    p(1, { age: "30 歳" }),
    p(2, { age: "30 歳" }),
    p(3, { age: "30 歳" }),
    p(4, { age: "30 歳" }),
  ];
  expect(ageProximity(g)).toBeCloseTo(1.0);
});

test("ageProximity: spread of 2 years (28-30) is high", () => {
  const g = [
    p(1, { age: "28 歳" }),
    p(2, { age: "30 歳" }),
    p(3, { age: "30 歳" }),
    p(4, { age: "32 歳" }),
  ];
  // stddev ≈ 1.41 → score ≈ 1 - 1.41/8 ≈ 0.82
  expect(ageProximity(g)).toBeGreaterThan(0.75);
});

test("ageProximity: huge spread (25 vs 55) clamps near 0", () => {
  const g = [p(1, { age: "25 歳" }), p(2, { age: "55 歳" })];
  // Linear curve: score = 0 (raw stddev = 15 > 8 threshold)
  expect(ageProximity(g, 1.0)).toBe(0);
  // Sqrt curve: still very low but not exactly 0 (older end gets some slack)
  expect(ageProximity(g, 0.5)).toBeLessThan(0.5);
});

test("ageProximity: missing age data falls back to 0.5", () => {
  const g = [p(1), p(2)];
  expect(ageProximity(g)).toBe(0.5);
});

test("ageProximity: curve compresses older-pair penalties (30→40 lighter than 20→30)", () => {
  const young = [p(1, { age: "20 歳" }), p(2, { age: "30 歳" })];
  const mid = [p(1, { age: "30 歳" }), p(2, { age: "40 歳" })];
  const old = [p(1, { age: "40 歳" }), p(2, { age: "50 歳" })];

  // With sqrt curve (exp=0.5), the same 10y raw gap is more painful for younger pairs.
  const yScore = ageProximity(young, 0.5);
  const mScore = ageProximity(mid, 0.5);
  const oScore = ageProximity(old, 0.5);
  expect(mScore).toBeGreaterThan(yScore);
  expect(oScore).toBeGreaterThan(mScore);

  // With linear curve (exp=1.0), the three pairs score identically.
  expect(ageProximity(young, 1.0)).toBeCloseTo(ageProximity(mid, 1.0), 4);
  expect(ageProximity(mid, 1.0)).toBeCloseTo(ageProximity(old, 1.0), 4);
});

test("confidenceFloor: returns the lowest confidence in the group", () => {
  const g = [
    p(1, { confidence: "high" }),
    p(2, { confidence: "low" }),
    p(3, { confidence: "medium" }),
  ];
  expect(confidenceFloor(g)).toBeCloseTo(0.3);
});

test("recentPairPenalty: no history → 1.0", () => {
  const g = [p(1), p(2), p(3)];
  expect(recentPairPenalty(g, { pairs: new Map(), maxSeen: 0 })).toBe(1);
});

test("recentPairPenalty: every pair seen once when max=1 → 0", () => {
  const g = [p(1), p(2), p(3)];
  const pairs = new Map([
    ["1-2", 1],
    ["1-3", 1],
    ["2-3", 1],
  ]);
  expect(recentPairPenalty(g, { pairs, maxSeen: 1 })).toBeCloseTo(0);
});

test("recentPairPenalty: half the pairs seen → 0.5", () => {
  const g = [p(1), p(2), p(3), p(4)];
  // 6 pairs total, 3 seen at max=1
  const pairs = new Map([
    ["1-2", 1],
    ["1-3", 1],
    ["1-4", 1],
  ]);
  expect(recentPairPenalty(g, { pairs, maxSeen: 1 })).toBeCloseTo(0.5);
});
