import { test, expect, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import ExcelJS from "exceljs";
import { writeShuffleHistory } from "./excel-export";
import { DEFAULT_PROFILE } from "./grouping/profile-config";
import type { FlatMember } from "./flat-member";
import type { SolutionScore, MetricBreakdown } from "./grouping";

function mockMember(no: number, name: string, dept: string): FlatMember {
  return {
    no,
    name,
    name_romaji: null,
    department: dept,
    detailed_department: null,
    job_title: null,
    joined_year: null,
    age: 30,
    hometown: null,
    hobbies: null,
    comment: null,
    surprising_fact: null,
    is_remote: false,
    is_unavailable: false,
    prev_count: 0,
    birth_month_flag: false,
    gender: "unknown",
    mbti: null,
    vibe: null,
    confidence: null,
    ai_notes: null,
  };
}

const tempPath = `/tmp/shuffle-test-${Math.random().toString(36).slice(2, 10)}.xlsx`;

afterAll(async () => {
  try {
    await unlink(tempPath);
  } catch {
    // Ignore cleanup errors.
  }
});

test("writeShuffleHistory round-trip: 3 tabs in expected order with right row counts", async () => {
  // 3 groups × 3 members = 9 assigned. Pool = 10 (one benched).
  const allMembers: FlatMember[] = [];
  for (let i = 1; i <= 10; i++) {
    allMembers.push(mockMember(i, `Member${i}`, `Dept${i % 3}`));
  }
  const groups: FlatMember[][] = [
    [allMembers[0]!, allMembers[1]!, allMembers[2]!],
    [allMembers[3]!, allMembers[4]!, allMembers[5]!],
    [allMembers[6]!, allMembers[7]!, allMembers[8]!],
  ];
  const bench = [allMembers[9]!];

  const breakdown: MetricBreakdown = {
    genderBalance: 0.5,
    deptDiversity: 0.6,
    eiBalance: 0.7,
    vibeDiversity: 0.4,
    mbtiDiversity: 0.5,
    ageProximity: 0.8,
    tenureMix: 0.3,
    confidenceFloor: 0.9,
    recentPairPenalty: 1.0,
  };
  const finalScore: SolutionScore = {
    total: 0.65,
    groupScores: [0.6, 0.65, 0.7],
    groupBreakdowns: [breakdown, breakdown, breakdown],
  };
  const initialScore: SolutionScore = {
    total: 0.5,
    groupScores: [0.5, 0.5, 0.5],
    groupBreakdowns: [breakdown, breakdown, breakdown],
  };

  await writeShuffleHistory(
    {
      runAt: "2026-05-11T04:30:22.000Z",
      profile: DEFAULT_PROFILE,
      seed: 42,
      groupCount: 3,
      groupSize: 3,
      allMembers,
      groups,
      bench,
      initialScore,
      finalScore,
      used: 9,
      filters: { includeRemote: false, includeUnavailable: false },
    },
    tempPath,
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(tempPath);

  // Tab order matters.
  expect(wb.worksheets.map((w) => w.name)).toEqual([
    "Groups",
    "All Members",
    "Settings",
  ]);

  const groupsWs = wb.getWorksheet("Groups")!;
  // 1 header + 9 member rows.
  expect(groupsWs.rowCount).toBe(10);

  // Spot-check group_no column for every member row.
  const headerCells: string[] = [];
  groupsWs.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headerCells[col] = String(cell.value ?? "");
  });
  const groupNoCol = headerCells.indexOf("group_no");
  expect(groupNoCol).toBeGreaterThan(0);
  const noCol = headerCells.indexOf("no");
  expect(noCol).toBeGreaterThan(0);
  // First three rows = group 1, next three = 2, last three = 3.
  expect(Number(groupsWs.getRow(2).getCell(groupNoCol).value)).toBe(1);
  expect(Number(groupsWs.getRow(4).getCell(groupNoCol).value)).toBe(1);
  expect(Number(groupsWs.getRow(5).getCell(groupNoCol).value)).toBe(2);
  expect(Number(groupsWs.getRow(8).getCell(groupNoCol).value)).toBe(3);

  const allWs = wb.getWorksheet("All Members")!;
  // 1 header + 10 members.
  expect(allWs.rowCount).toBe(11);

  // assigned_group should be set for the first 9 and empty for the benched one.
  const allHeaderCells: string[] = [];
  allWs.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    allHeaderCells[col] = String(cell.value ?? "");
  });
  const assignedCol = allHeaderCells.indexOf("assigned_group");
  expect(assignedCol).toBeGreaterThan(0);
  const benchedAssigned = allWs.getRow(11).getCell(assignedCol).value;
  expect(benchedAssigned == null || benchedAssigned === "").toBe(true);
  expect(Number(allWs.getRow(2).getCell(assignedCol).value)).toBe(1);

  const settingsWs = wb.getWorksheet("Settings")!;
  // Read all key/value pairs.
  const settingsKeys = new Set<string>();
  for (let r = 2; r <= settingsWs.rowCount; r++) {
    const k = String(settingsWs.getRow(r).getCell(1).value ?? "");
    if (k) settingsKeys.add(k);
  }
  for (const expected of [
    "runAt",
    "profile",
    "seed",
    "groupCount",
    "groupSize",
    "eligibleCount",
    "usedCount",
    "benchedCount",
    "totalScore",
    "initialScore",
    "weight.genderBalance",
    "weight.recentPairPenalty",
    "solver.iterations",
    "solver.restarts",
    "solver.initialTemp",
    "solver.endTemp",
    "solver.threeCycleProbability",
    "ageCurveExponent",
    "historyLookbackRuns",
    "includeRemote",
    "includeUnavailable",
  ]) {
    expect(settingsKeys.has(expected)).toBe(true);
  }
});
