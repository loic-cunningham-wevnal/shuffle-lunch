import ExcelJS from "exceljs";
import { FLAT_MEMBER_COLUMNS, type FlatMember } from "./flat-member";
import type { SolutionScore } from "./grouping";
import type { GroupingProfile } from "./grouping/profile-config";

export const HISTORY_DIR = "data/history";

export type ShuffleHistoryPayload = {
  runAt: string;
  profile: GroupingProfile;
  seed: number;
  groupCount: number;
  groupSize: number;
  // The full member pool (eligible + ineligible) — every row appears in the
  // "All Members" tab.
  allMembers: FlatMember[];
  // Final solution: groups in algorithm-output order.
  groups: FlatMember[][];
  bench: FlatMember[];
  initialScore: SolutionScore;
  finalScore: SolutionScore;
  used: number;
  // Eligibility filters applied at run time.
  filters: { includeRemote: boolean; includeUnavailable: boolean };
};

const METRIC_KEYS = [
  "genderBalance",
  "deptDiversity",
  "eiBalance",
  "vibeDiversity",
  "mbtiDiversity",
  "ageProximity",
  "tenureMix",
  "confidenceFloor",
  "recentPairPenalty",
] as const;

export function defaultHistoryPath(runAt: string): string {
  // Replace ':' and '.' with '-' for filename safety (matches the previous
  // JSON-history naming convention).
  const filename = `${runAt.replace(/[:.]/g, "-")}.xlsx`;
  return `${HISTORY_DIR}/${filename}`;
}

// Pure: builds the workbook in-memory. Browser-safe.
export function buildShuffleHistoryWorkbook(
  payload: ShuffleHistoryPayload,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  addGroupsTab(wb, payload);
  addAllMembersTab(wb, payload);
  addSettingsTab(wb, payload);
  return wb;
}

// Pure: returns xlsx bytes. Browser-safe (uses ArrayBuffer, not node:fs).
export async function shuffleHistoryToBuffer(
  payload: ShuffleHistoryPayload,
): Promise<ArrayBuffer> {
  const wb = buildShuffleHistoryWorkbook(payload);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

function addGroupsTab(
  wb: ExcelJS.Workbook,
  payload: ShuffleHistoryPayload,
): void {
  const ws = wb.addWorksheet("Groups");

  const headers: string[] = [
    "group_no",
    ...FLAT_MEMBER_COLUMNS,
    "group_score",
    ...METRIC_KEYS.map((k) => `g_${k}`),
  ];
  ws.columns = headers.map((h) => ({ header: h, key: h }));

  payload.groups.forEach((members, gi) => {
    const groupNo = gi + 1;
    const breakdown = payload.finalScore.groupBreakdowns[gi];
    const groupScore = payload.finalScore.groupScores[gi] ?? 0;
    const groupScoreRounded = Number(groupScore.toFixed(4));
    for (const m of members) {
      const row: Record<string, unknown> = { group_no: groupNo };
      for (const col of FLAT_MEMBER_COLUMNS) {
        row[col] = m[col];
      }
      row.group_score = groupScoreRounded;
      for (const k of METRIC_KEYS) {
        row[`g_${k}`] = breakdown ? breakdown[k] : 0;
      }
      ws.addRow(row);
    }
  });

  styleHeader(ws, headers.length);
}

function addAllMembersTab(
  wb: ExcelJS.Workbook,
  payload: ShuffleHistoryPayload,
): void {
  const ws = wb.addWorksheet("All Members");

  const headers: string[] = [...FLAT_MEMBER_COLUMNS, "assigned_group"];
  ws.columns = headers.map((h) => ({ header: h, key: h }));

  // Build no -> group_no map.
  const assignedByNo = new Map<number, number>();
  payload.groups.forEach((members, gi) => {
    for (const m of members) assignedByNo.set(m.no, gi + 1);
  });

  for (const m of payload.allMembers) {
    const row: Record<string, unknown> = {};
    for (const col of FLAT_MEMBER_COLUMNS) {
      row[col] = m[col];
    }
    row.assigned_group = assignedByNo.get(m.no) ?? null;
    ws.addRow(row);
  }

  styleHeader(ws, headers.length);
}

function addSettingsTab(
  wb: ExcelJS.Workbook,
  payload: ShuffleHistoryPayload,
): void {
  const ws = wb.addWorksheet("Settings");
  ws.columns = [
    { header: "key", key: "key" },
    { header: "value", key: "value" },
  ];

  const profile = payload.profile;
  const benched = payload.bench.length;
  const eligibleCount = payload.used + benched;

  const rows: Array<[string, unknown]> = [
    ["runAt", payload.runAt],
    ["profile", profile.name],
    ["seed", payload.seed],
    ["groupCount", payload.groupCount],
    ["groupSize", payload.groupSize],
    ["eligibleCount", eligibleCount],
    ["usedCount", payload.used],
    ["benchedCount", benched],
    ["totalScore", payload.finalScore.total],
    ["initialScore", payload.initialScore.total],
  ];

  for (const k of METRIC_KEYS) {
    rows.push([`weight.${k}`, profile.weights[k]]);
  }
  rows.push(["solver.iterations", profile.solver.iterations]);
  rows.push(["solver.restarts", profile.solver.restarts]);
  rows.push(["solver.initialTemp", profile.solver.initialTemp]);
  rows.push(["solver.endTemp", profile.solver.endTemp]);
  rows.push([
    "solver.threeCycleProbability",
    profile.solver.threeCycleProbability,
  ]);
  rows.push(["ageCurveExponent", profile.metricParams.ageCurveExponent]);
  rows.push(["historyLookbackRuns", profile.history.lookbackRuns]);
  rows.push(["includeRemote", payload.filters.includeRemote]);
  rows.push(["includeUnavailable", payload.filters.includeUnavailable]);

  for (const [key, value] of rows) ws.addRow({ key, value });

  styleHeader(ws, 2);
}

function styleHeader(ws: ExcelJS.Worksheet, columnCount: number): void {
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();
  if (columnCount >= 1) {
    const lastCol = colLetter(columnCount);
    ws.autoFilter = `A1:${lastCol}1`;
  }
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
