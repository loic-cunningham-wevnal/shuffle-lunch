import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  FLAT_MEMBER_COLUMNS,
  FlatMemberSchema,
  type FlatMember,
} from "./flat-member";

const SHEET_NAME = "Members";

type FlatField = (typeof FLAT_MEMBER_COLUMNS)[number];

// Columns that get wider default widths.
const WIDE_NAME_FIELDS = new Set<FlatField>([
  "name",
  "name_romaji",
  "department",
  "detailed_department",
  "job_title",
  "hometown",
]);
const FREE_TEXT_FIELDS = new Set<FlatField>([
  "hobbies",
  "comment",
  "surprising_fact",
  "ai_notes",
]);

function columnWidth(field: FlatField): number {
  if (FREE_TEXT_FIELDS.has(field)) return 40;
  if (WIDE_NAME_FIELDS.has(field)) return 18;
  return 12;
}

export async function writeMembersFlatXlsx(
  members: FlatMember[],
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = FLAT_MEMBER_COLUMNS.map((field) => ({
    header: field,
    key: field,
    width: columnWidth(field),
  }));

  for (const m of members) {
    const row: Record<string, unknown> = {};
    for (const col of FLAT_MEMBER_COLUMNS) {
      // null stays null — ExcelJS renders that as an empty cell.
      row[col] = m[col];
    }
    ws.addRow(row);
  }

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  const lastCol = colLetter(FLAT_MEMBER_COLUMNS.length);
  ws.autoFilter = `A1:${lastCol}1`;

  const buf = await wb.xlsx.writeBuffer();
  await Bun.write(outputPath, buf);
}

export type ReadMembersFlatXlsxResult = {
  rows: FlatMember[];
  rowErrors: { rowNumber: number; error: string }[];
};

export async function readMembersFlatXlsx(
  inputPath: string,
): Promise<ReadMembersFlatXlsxResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    throw new Error(
      `Sheet "${SHEET_NAME}" not found. Available: ${wb.worksheets.map((s) => s.name).join(", ")}`,
    );
  }

  // Map column index (1-based) → field name, based on the header row contents.
  const headerRow = ws.getRow(1);
  const knownFields = new Set<string>(FLAT_MEMBER_COLUMNS);
  const fieldByCol = new Map<number, FlatField>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const name = String(cellValue(cell.value) ?? "").trim();
    if (knownFields.has(name)) fieldByCol.set(col, name as FlatField);
  });

  const rows: FlatMember[] = [];
  const rowErrors: { rowNumber: number; error: string }[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;

    const candidate: Record<string, unknown> = {};
    let hasAny = false;
    for (const [col, field] of fieldByCol) {
      const v = cellValue(row.getCell(col).value);
      candidate[field] = coerceForField(field, v);
      if (v !== null && v !== undefined && v !== "") hasAny = true;
    }
    if (!hasAny) continue;

    // Fill in any field that the sheet didn't include with its default.
    for (const field of FLAT_MEMBER_COLUMNS) {
      if (!(field in candidate)) {
        candidate[field] = coerceForField(field, null);
      }
    }

    const parsed = FlatMemberSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      rowErrors.push({
        rowNumber: r,
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    }
  }

  return { rows, rowErrors };
}

// Nullable string fields.
const NULLABLE_STRING_FIELDS = new Set<FlatField>([
  "name_romaji",
  "detailed_department",
  "job_title",
  "hometown",
  "hobbies",
  "comment",
  "surprising_fact",
  "ai_notes",
]);

// Required non-null string fields.
const REQUIRED_STRING_FIELDS = new Set<FlatField>(["name", "department"]);

// Nullable int fields.
const NULLABLE_INT_FIELDS = new Set<FlatField>(["joined_year", "age"]);

// Boolean fields (default false when empty).
const BOOLEAN_FIELDS = new Set<FlatField>([
  "is_remote",
  "is_unavailable",
  "birth_month_flag",
]);

// Nullable enrichment enum fields (string-typed, leave as-is for zod).
const NULLABLE_ENUM_FIELDS = new Set<FlatField>([
  "gender",
  "mbti",
  "vibe",
  "confidence",
]);

function coerceForField(field: FlatField, raw: unknown): unknown {
  const empty = raw === null || raw === undefined || raw === "";

  if (field === "no") {
    if (empty) return undefined; // forces a zod validation error
    return toInt(raw);
  }
  if (field === "prev_count") {
    if (empty) return 0;
    return toInt(raw);
  }
  if (NULLABLE_INT_FIELDS.has(field)) {
    if (empty) return null;
    return toInt(raw);
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (empty) return false;
    return toBool(raw);
  }
  if (REQUIRED_STRING_FIELDS.has(field)) {
    if (empty) return undefined;
    return String(raw).trim();
  }
  if (NULLABLE_STRING_FIELDS.has(field)) {
    if (empty) return null;
    return String(raw);
  }
  if (NULLABLE_ENUM_FIELDS.has(field)) {
    if (empty) return null;
    return String(raw).trim();
  }
  return raw;
}

function toInt(raw: unknown): number | unknown {
  if (typeof raw === "number") {
    if (Number.isFinite(raw)) return Math.trunc(raw);
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return raw;
}

function toBool(raw: unknown): boolean | unknown {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no" || s === "") return false;
  }
  return raw;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value)
      return value.richText.map((t) => t.text).join("");
    if ("text" in value) return (value as { text: string }).text;
    if (value instanceof Date) return value;
  }
  return value;
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
