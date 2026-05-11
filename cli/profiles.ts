import { loadMembers } from "./members";
import {
  loadNotionCsv,
  loadNotionMarkdownPages,
  type NotionCsvRow,
} from "./notion";
import { type NotionPage } from "./notion-md";
import { NameIndex } from "./match";
import { FlatMemberSchema, type FlatMember } from "./flat-member";
import type { Member } from "./schema";

export { FlatMemberSchema };

export type LoadFlatMembersArgs = {
  membersFile: string;
  notionCsv: string;
  notionDir: string;
};

export type LoadFlatMembersResult = {
  members: FlatMember[];
  unmatched: { csvNames: string[]; pageTitles: string[] };
};

export async function loadFlatMembers(
  args: LoadFlatMembersArgs,
): Promise<LoadFlatMembersResult> {
  const [members, csvRows, pages] = await Promise.all([
    loadMembers(args.membersFile),
    loadNotionCsv(args.notionCsv),
    loadNotionMarkdownPages(args.notionDir),
  ]);

  const memberIdx = new NameIndex<Member>(members, (m) => m.name);

  const matchedCsv = new Set<number>();
  const matchedPages = new Set<number>();

  const csvByMemberNo = new Map<number, NotionCsvRow>();
  csvRows.forEach((row, i) => {
    const m = memberIdx.find(row.name);
    if (m) {
      csvByMemberNo.set(m.no, row);
      matchedCsv.add(i);
    }
  });

  const pageByMemberNo = new Map<number, NotionPage>();
  pages.forEach((p, i) => {
    const m = memberIdx.find(p.title);
    if (m) {
      pageByMemberNo.set(m.no, p);
      matchedPages.add(i);
    }
  });

  const flat = members.map((m) =>
    buildFlatMember(m, csvByMemberNo.get(m.no), pageByMemberNo.get(m.no)),
  );

  const unmatched = {
    csvNames: csvRows.filter((_, i) => !matchedCsv.has(i)).map((r) => r.name),
    pageTitles: pages
      .filter((_, i) => !matchedPages.has(i))
      .map((p) => p.title),
  };

  return {
    members: flat.map((m) => FlatMemberSchema.parse(m)),
    unmatched,
  };
}

function buildFlatMember(
  m: Member,
  csv: NotionCsvRow | undefined,
  page: NotionPage | undefined,
): FlatMember {
  const ageRaw = csv?.age ?? page?.properties["年齢（自動動入力）"] ?? null;
  return {
    no: m.no,
    name: m.name,
    name_romaji: page ? extractRomaji(page.title) : null,
    department: m.department,
    detailed_department: tableCell(page, "部署"),
    job_title: tableCell(page, "役職"),
    joined_year: parseJoinedYear(tableCell(page, "入社年月")),
    age: parseAge(ageRaw),
    hometown: tableCell(page, "出身地"),
    hobbies: tableCell(page, "趣味・好きなもの"),
    comment: page?.comment ?? null,
    surprising_fact: tableCell(page, "実は〇〇なんです（意外な一面）"),
    is_remote: m.isRemote,
    is_unavailable: m.isUnavailable,
    prev_count: m.previousCount,
    birth_month_flag: csv?.birthMonthFlag ?? false,
    gender: null,
    mbti: null,
    vibe: null,
    confidence: null,
    ai_notes: null,
  };
}

function tableCell(page: NotionPage | undefined, key: string): string | null {
  if (!page) return null;
  const v = page.tableCells[key];
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const ROMAJI_RUN = /[A-Za-z]+(?:[\s　]+[A-Za-z]+)*/g;

function extractRomaji(title: string): string | null {
  const matches = title.match(ROMAJI_RUN);
  if (!matches || matches.length === 0) return null;
  const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
  const trimmed = longest.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJoinedYear(raw: string | null): number | null {
  if (raw === null) return null;
  // Some "入社年月" cells include extra notes; pick the first 20XX/21XX year.
  const m = raw.match(/(20\d{2}|21\d{2})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

function parseAge(raw: string | null): number | null {
  if (raw === null) return null;
  const m = raw.match(/(\d{1,3})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > 130) return null;
  return n;
}
