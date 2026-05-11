"use client";

// Parse a shuffle-lunch xlsx export back into a result snapshot. We read the
// "Groups" sheet to recover the assignment, the "All Members" sheet to find
// benched members, and rebuild snapshot fields by joining against the live
// member list (so we don't drag along stale enrichment).

import ExcelJS from "exceljs";
import type { FlatMember } from "@cli/flat-member";
import type { ScoringContext } from "@cli/grouping/score";
import { scoreSolution } from "@cli/grouping/score";
import type { ResultSnapshot } from "@/hooks/use-result-state";

export type ImportResult = {
  snapshot: ResultSnapshot;
  warnings: string[];
};

export async function importGroupsFromXlsx(
  buffer: ArrayBuffer,
  members: FlatMember[],
  ctx: ScoringContext,
  fallbackSeed: number,
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const groupsSheet = wb.getWorksheet("Groups");
  if (!groupsSheet) {
    throw new Error("Imported xlsx is missing a 'Groups' sheet.");
  }

  // Header row → column indices for the fields we care about.
  const headerRow = groupsSheet.getRow(1);
  let groupCol = -1;
  let noCol = -1;
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const v = String(cell.value ?? "").trim();
    if (v === "group_no") groupCol = col;
    else if (v === "no") noCol = col;
  });
  if (groupCol < 0 || noCol < 0) {
    throw new Error(
      "Imported 'Groups' sheet must have both 'group_no' and 'no' columns.",
    );
  }

  const memberByNo = new Map(members.map((m) => [m.no, m]));
  const warnings: string[] = [];
  const groupsByNo = new Map<number, FlatMember[]>();

  for (let r = 2; r <= groupsSheet.rowCount; r++) {
    const row = groupsSheet.getRow(r);
    if (!row.hasValues) continue;
    const groupNo = Number(row.getCell(groupCol).value);
    const memberNo = Number(row.getCell(noCol).value);
    if (!Number.isInteger(groupNo) || !Number.isInteger(memberNo)) continue;
    const member = memberByNo.get(memberNo);
    if (!member) {
      warnings.push(`Row ${r}: member #${memberNo} no longer exists, skipped.`);
      continue;
    }
    const list = groupsByNo.get(groupNo) ?? [];
    list.push(member);
    groupsByNo.set(groupNo, list);
  }

  // Collapse to a dense array indexed by group_no order (group_no is 1-based
  // in the export).
  const sortedGroupNos = [...groupsByNo.keys()].sort((a, b) => a - b);
  if (sortedGroupNos.length === 0) {
    throw new Error("Imported 'Groups' sheet had no usable rows.");
  }
  const groups: FlatMember[][] = sortedGroupNos.map(
    (gn) => groupsByNo.get(gn)!,
  );
  const groupCount = groups.length;
  const groupSize = Math.max(...groups.map((g) => g.length));

  // Bench: members marked assigned_group=null in the "All Members" sheet, OR
  // simply any member not present in any group. The latter is the more robust
  // definition because the All Members sheet may lag.
  const used = new Set<number>();
  for (const g of groups) for (const m of g) used.add(m.no);

  const benchSheet = wb.getWorksheet("All Members");
  let bench: FlatMember[] = [];
  if (benchSheet) {
    let benchNoCol = -1;
    let assignedCol = -1;
    benchSheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const v = String(cell.value ?? "").trim();
      if (v === "no") benchNoCol = col;
      else if (v === "assigned_group") assignedCol = col;
    });
    if (benchNoCol > 0 && assignedCol > 0) {
      for (let r = 2; r <= benchSheet.rowCount; r++) {
        const row = benchSheet.getRow(r);
        if (!row.hasValues) continue;
        const memberNo = Number(row.getCell(benchNoCol).value);
        const assigned = row.getCell(assignedCol).value;
        const isBenched =
          assigned === null || assigned === undefined || assigned === "";
        if (!Number.isInteger(memberNo)) continue;
        if (!isBenched) continue;
        if (used.has(memberNo)) continue;
        const member = memberByNo.get(memberNo);
        if (member) bench.push(member);
      }
    }
  }
  if (bench.length === 0) {
    // Fallback: any current member not assigned to a group.
    bench = members.filter((m) => !used.has(m.no));
  }

  // Rescore using the *current* scoring context so the score reflects the
  // live weights, not whatever profile the file was exported with.
  const finalScore = scoreSolution(groups, ctx);

  const snapshot: ResultSnapshot = {
    groups,
    bench,
    initialScore: finalScore,
    finalScore,
    used: groups.reduce((sum, g) => sum + g.length, 0),
    seed: fallbackSeed,
    groupCount,
    groupSize,
  };

  return { snapshot, warnings };
}
