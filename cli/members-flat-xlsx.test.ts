import { test, expect, afterAll } from "bun:test";
import { unlink } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  writeMembersFlatXlsx,
  readMembersFlatXlsx,
} from "./members-flat-xlsx";
import { FLAT_MEMBER_COLUMNS, type FlatMember } from "./flat-member";

const tempPaths: string[] = [];

function tempPath(): string {
  const p = `/tmp/members-test-${Math.random().toString(36).slice(2, 10)}.xlsx`;
  tempPaths.push(p);
  return p;
}

afterAll(async () => {
  for (const p of tempPaths) {
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
});

const fullyEnriched: FlatMember = {
  no: 1,
  name: "Alice",
  name_romaji: "Alice",
  department: "Engineering",
  detailed_department: "Platform",
  job_title: "Engineer",
  joined_year: 2020,
  age: 30,
  hometown: "Tokyo",
  hobbies: "running, reading",
  comment: "loves coffee",
  surprising_fact: "speaks 4 languages",
  is_remote: false,
  is_unavailable: false,
  prev_count: 2,
  birth_month_flag: true,
  gender: "female",
  mbti: "INTJ-A",
  vibe: "analytical",
  confidence: "high",
  ai_notes: "great match for technical groups",
};

const allNullEnrichment: FlatMember = {
  no: 2,
  name: "Bob",
  name_romaji: null,
  department: "Sales",
  detailed_department: null,
  job_title: null,
  joined_year: null,
  age: null,
  hometown: null,
  hobbies: null,
  comment: null,
  surprising_fact: null,
  is_remote: false,
  is_unavailable: false,
  prev_count: 0,
  birth_month_flag: false,
  gender: null,
  mbti: null,
  vibe: null,
  confidence: null,
  ai_notes: null,
};

const mixedNullable: FlatMember = {
  no: 3,
  name: "Carol",
  name_romaji: "Carol",
  department: "Design",
  detailed_department: null,
  job_title: "Designer",
  joined_year: 2022,
  age: null,
  hometown: "Osaka",
  hobbies: null,
  comment: "yoga enthusiast",
  surprising_fact: null,
  is_remote: true,
  is_unavailable: false,
  prev_count: 1,
  birth_month_flag: false,
  gender: "female",
  mbti: "Unknown",
  vibe: "creative",
  confidence: "medium",
  ai_notes: null,
};

test("members-flat-xlsx: round-trips 3 mixed rows without loss", async () => {
  const path = tempPath();
  const input: FlatMember[] = [fullyEnriched, allNullEnrichment, mixedNullable];

  await writeMembersFlatXlsx(input, path);
  const { rows, rowErrors } = await readMembersFlatXlsx(path);

  expect(rowErrors).toEqual([]);
  expect(rows).toEqual(input);
});

test("members-flat-xlsx: invalid mbti value lands in rowErrors and is excluded", async () => {
  const path = tempPath();
  // Write 2 valid rows + 1 with a bogus mbti directly with ExcelJS so we can
  // bypass the schema-enforced writer.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members");
  ws.columns = FLAT_MEMBER_COLUMNS.map((f) => ({ header: f, key: f }));
  ws.getRow(1).font = { bold: true };

  const writeRow = (m: Record<string, unknown>): void => {
    ws.addRow(m);
  };
  writeRow({ ...fullyEnriched });
  writeRow({
    ...allNullEnrichment,
    no: 99,
    name: "Bogus",
    mbti: "BOGUS-X",
  });
  writeRow({ ...mixedNullable });

  const buf = await wb.xlsx.writeBuffer();
  await Bun.write(path, buf);

  const { rows, rowErrors } = await readMembersFlatXlsx(path);
  expect(rows.length).toBe(2);
  expect(rowErrors.length).toBe(1);
  // Row 3 in the sheet = the bogus row (header is row 1).
  expect(rowErrors[0]!.rowNumber).toBe(3);
  expect(rowErrors[0]!.error.toLowerCase()).toContain("mbti");
  // Confirm survivors are the expected nos.
  expect(rows.map((r) => r.no).sort()).toEqual([1, 3]);
});

test("members-flat-xlsx: reordered header columns still parse via header-name lookup", async () => {
  const path = tempPath();
  const input: FlatMember[] = [fullyEnriched, allNullEnrichment, mixedNullable];

  // Build a file where columns are in REVERSE order vs FLAT_MEMBER_COLUMNS.
  const reversed = [...FLAT_MEMBER_COLUMNS].reverse();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Members");
  ws.columns = reversed.map((f) => ({ header: f, key: f }));
  ws.getRow(1).font = { bold: true };
  for (const m of input) {
    const row: Record<string, unknown> = {};
    for (const col of reversed) row[col] = m[col];
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  await Bun.write(path, buf);

  const { rows, rowErrors } = await readMembersFlatXlsx(path);
  expect(rowErrors).toEqual([]);
  expect(rows).toEqual(input);
});
