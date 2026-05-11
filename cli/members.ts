import { z } from "zod";
import { readSheetRows, type RawRow } from "./excel";
import { MemberSchema, MembersSchema, type Member } from "./schema";

const SHEET_NAME = "メンバー一覧";

const COLUMNS = {
  no: "No.",
  name: "氏名",
  department: "部署",
  isRemote: "遠方/リモート",
  isUnavailable: "NG/休み",
  previousCount: "前回実施回数",
} as const;

const RawMemberSchema = z
  .object({
    [COLUMNS.no]: z.coerce.number().int().positive(),
    [COLUMNS.name]: z.string().min(1),
    [COLUMNS.department]: z.string().min(1),
    [COLUMNS.isRemote]: z.coerce.boolean(),
    [COLUMNS.isUnavailable]: z.coerce.boolean(),
    [COLUMNS.previousCount]: z.coerce.number().int().nonnegative(),
  })
  .transform(
    (row): Member => ({
      no: row[COLUMNS.no],
      name: row[COLUMNS.name].trim(),
      department: row[COLUMNS.department].trim(),
      isRemote: row[COLUMNS.isRemote],
      isUnavailable: row[COLUMNS.isUnavailable],
      previousCount: row[COLUMNS.previousCount],
    }),
  )
  .pipe(MemberSchema);

export async function loadMembers(filePath: string): Promise<Member[]> {
  const rows = await readSheetRows(filePath, SHEET_NAME);
  const parsed = rows
    .map((row, i) => ({ row, rowNumber: i + 2 }))
    .filter(({ row }) => {
      const name = row[COLUMNS.name];
      return typeof name === "string" && name.trim().length > 0;
    })
    .map(({ row, rowNumber }) => parseRow(row, rowNumber));
  return MembersSchema.parse(parsed);
}

function parseRow(row: RawRow, rowNumber: number): Member {
  const result = RawMemberSchema.safeParse(row);
  if (!result.success) {
    throw new Error(
      `Row ${rowNumber} failed validation: ${result.error.message}\n  raw: ${JSON.stringify(row)}`,
    );
  }
  return result.data;
}
