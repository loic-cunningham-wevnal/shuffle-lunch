import ExcelJS from "exceljs";
import { readBytes } from "./storage";

export type RawRow = Record<string, unknown>;

export async function readSheetRows(
  filePath: string,
  sheetName: string,
): Promise<RawRow[]> {
  const wb = await loadWorkbook(filePath);

  const sheet = wb.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(
      `Sheet "${sheetName}" not found. Available: ${wb.worksheets.map((s) => s.name).join(", ")}`,
    );
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col] = String(cellValue(cell.value) ?? "").trim();
  });

  const rows: RawRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row.hasValues) continue;

    const obj: RawRow = {};
    let hasAny = false;
    for (let c = 1; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const value = cellValue(row.getCell(c).value);
      obj[key] = value;
      if (value !== null && value !== undefined && value !== "") hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }

  return rows;
}

// Load an xlsx workbook by pathname. Routes through cli/storage so it works
// against the local filesystem in dev/CLI and against Vercel Blob in prod.
export async function loadWorkbook(
  pathname: string,
): Promise<ExcelJS.Workbook> {
  const buf = await readBytes(pathname);
  const wb = new ExcelJS.Workbook();
  // Cast to the type ExcelJS expects (Node Buffer is a Uint8Array view).
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
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
