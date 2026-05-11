import { parse as parseCsv } from "csv-parse/sync";
import { parseNotionMarkdown, type NotionPage } from "./notion-md";
import { listDir, readText } from "./storage";

export type NotionCsvRow = {
  name: string;
  department: string | null;
  birthday: string | null;
  age: string | null;
  workTags: string[];
  lastUpdated: string | null;
  pastAssignments: string | null;
  birthMonthFlag: boolean;
};

const CSV_COL = {
  name: "Property",
  department: "部署",
  birthday: "生年月日",
  age: "年齢（自動動入力）",
  workTags: "職歴（バイト含む）",
  lastUpdated: "最終更新日時",
  pastAssignments: "これまでの担当案件※大体でOK",
  birthMonthFlag: "誕生月_Flag",
} as const;

export async function loadNotionCsv(filePath: string): Promise<NotionCsvRow[]> {
  const text = await readText(filePath);
  const records = parseCsv(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return records
    .filter((r) => (r[CSV_COL.name] ?? "").trim().length > 0)
    .map((r) => ({
      name: r[CSV_COL.name]!.trim(),
      department: nullIfEmpty(r[CSV_COL.department]),
      birthday: nullIfEmpty(r[CSV_COL.birthday]),
      age: nullIfEmpty(r[CSV_COL.age]),
      workTags: splitTags(r[CSV_COL.workTags]),
      lastUpdated: nullIfEmpty(r[CSV_COL.lastUpdated]),
      pastAssignments: nullIfEmpty(r[CSV_COL.pastAssignments]),
      birthMonthFlag: (r[CSV_COL.birthMonthFlag] ?? "").trim() === "Yes",
    }));
}

export async function loadNotionMarkdownPages(
  dir: string,
): Promise<NotionPage[]> {
  const entries = await listDir(dir);
  const pages: NotionPage[] = [];
  for (const e of entries) {
    if (!e.name.endsWith(".md")) continue;
    const text = await readText(e.pathname);
    const page = parseNotionMarkdown(text, e.name);
    if (page) pages.push(page);
  }
  return pages;
}

function nullIfEmpty(s: string | undefined): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function splitTags(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
