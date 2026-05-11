import Table from "cli-table3";
import { loadEnrichedMembers } from "./load";
import type { FlatMember } from "../flat-member";

// A FlatMember with all enrichment fields filled in (non-null).
type EnrichedMember = FlatMember & {
  gender: NonNullable<FlatMember["gender"]>;
  mbti: NonNullable<FlatMember["mbti"]>;
  vibe: NonNullable<FlatMember["vibe"]>;
  confidence: NonNullable<FlatMember["confidence"]>;
};

export async function runReport(): Promise<void> {
  const { members, cachedEnrichmentCount } = await loadEnrichedMembers();
  const enriched = members.filter(
    (m): m is EnrichedMember => m.gender !== null && m.mbti !== null && m.vibe !== null && m.confidence !== null,
  );

  printHeader(members.length, enriched.length, cachedEnrichmentCount);
  printGender(enriched);
  printMbtiAxes(enriched);
  printMbtiTypes(enriched);
  printVibe(enriched);
  printConfidence(enriched);
  printAvailability(enriched, members);
  printJobTitles(enriched);
  printDepartmentBreakdown(enriched);
  printDepartmentGender(enriched);
  printDepartmentVibe(enriched);
  printAge(enriched);
  printTenure(enriched);
  printBirthMonth(enriched);
  printLowConfidence(enriched);
}

function printHeader(total: number, enriched: number, cached: number): void {
  console.log();
  console.log("═".repeat(80));
  console.log("  SHUFFLE-LUNCH COMPANY REPORT");
  console.log("═".repeat(80));
  console.log(
    `  Total members: ${total}    Enriched: ${enriched} (${pct(enriched, total)})    Cached: ${cached}`,
  );
  console.log();
}

function printGender(rows: EnrichedMember[]): void {
  console.log(section("Gender distribution"));
  const counts = countBy(rows, (r) => r.gender);
  const t = new Table({ head: ["Gender", "Count", "%"], colAligns: ["left", "right", "right"] });
  for (const [k, v] of sortByValue(counts)) t.push([k, v, pct(v, rows.length)]);
  console.log(t.toString());
}

function printMbtiAxes(rows: EnrichedMember[]): void {
  console.log(section("MBTI axes (excluding 'Unknown')"));
  const known = rows.filter((r) => r.mbti !== "Unknown");
  const axes: Record<string, [string, string]> = {
    "E vs I": ["E", "I"],
    "N vs S": ["N", "S"],
    "T vs F": ["T", "F"],
    "J vs P": ["J", "P"],
    "Assertive vs Turbulent": ["A", "T"],
  };
  const t = new Table({
    head: ["Axis", "Side A", "Count", "%", "Side B", "Count", "%"],
    colAligns: ["left", "left", "right", "right", "left", "right", "right"],
  });
  for (const [label, [a, b]] of Object.entries(axes)) {
    const idx = label === "Assertive vs Turbulent" ? 5 : axisIndex(label);
    let aCount = 0;
    let bCount = 0;
    for (const r of known) {
      const ch = r.mbti[idx];
      if (ch === a) aCount++;
      else if (ch === b) bCount++;
    }
    t.push([
      label,
      a,
      aCount,
      pct(aCount, known.length),
      b,
      bCount,
      pct(bCount, known.length),
    ]);
  }
  console.log(t.toString());
}

function axisIndex(label: string): number {
  return { "E vs I": 0, "N vs S": 1, "T vs F": 2, "J vs P": 3 }[label] ?? 0;
}

function printMbtiTypes(rows: EnrichedMember[]): void {
  console.log(section("MBTI type distribution"));
  const counts = countBy(rows, (r) => r.mbti);
  const t = new Table({
    head: ["Type", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const [k, v] of sortByValue(counts)) t.push([k, v, pct(v, rows.length)]);
  console.log(t.toString());
}

function printVibe(rows: EnrichedMember[]): void {
  console.log(section("Vibe distribution"));
  const counts = countBy(rows, (r) => r.vibe);
  const t = new Table({
    head: ["Vibe", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const [k, v] of sortByValue(counts)) t.push([k, v, pct(v, rows.length)]);
  console.log(t.toString());
}

function printConfidence(rows: EnrichedMember[]): void {
  console.log(section("Enrichment confidence"));
  const counts = countBy(rows, (r) => r.confidence);
  const t = new Table({
    head: ["Confidence", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const k of ["high", "medium", "low"]) {
    const v = counts.get(k) ?? 0;
    t.push([k, v, pct(v, rows.length)]);
  }
  console.log(t.toString());
}

function printAvailability(_rows: EnrichedMember[], all: FlatMember[]): void {
  console.log(section("Availability flags (whole company)"));
  const remote = all.filter((m) => m.is_remote).length;
  const ng = all.filter((m) => m.is_unavailable).length;
  const t = new Table({
    head: ["Flag", "Count", "% of total"],
    colAligns: ["left", "right", "right"],
  });
  t.push(["Remote / distant", remote, pct(remote, all.length)]);
  t.push(["NG / unavailable", ng, pct(ng, all.length)]);
  t.push([
    "Eligible (neither)",
    all.length - remote - ng,
    pct(all.length - remote - ng, all.length),
  ]);
  console.log(t.toString());
}

function printJobTitles(rows: EnrichedMember[]): void {
  console.log(section("Job titles (top 10, from Notion)"));
  const titles = countBy(
    rows.filter((r) => r.job_title),
    (r) => r.job_title!.trim(),
  );
  const t = new Table({
    head: ["Title", "Count"],
    colAligns: ["left", "right"],
  });
  for (const [k, v] of sortByValue(titles).slice(0, 10)) t.push([k, v]);
  console.log(t.toString());
}

function printDepartmentBreakdown(rows: EnrichedMember[]): void {
  console.log(section("Department breakdown"));
  const counts = countBy(rows, (r) => r.department);
  const t = new Table({
    head: ["Department", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const [k, v] of sortByValue(counts)) t.push([k, v, pct(v, rows.length)]);
  console.log(t.toString());
}

function printDepartmentGender(rows: EnrichedMember[]): void {
  console.log(section("Department × gender"));
  const depts = [...new Set(rows.map((r) => r.department))].sort();
  const t = new Table({
    head: ["Department", "Male", "Female", "Unknown", "Total", "%F"],
    colAligns: ["left", "right", "right", "right", "right", "right"],
  });
  for (const d of depts) {
    const inDept = rows.filter((r) => r.department === d);
    const male = inDept.filter((r) => r.gender === "male").length;
    const female = inDept.filter((r) => r.gender === "female").length;
    const unk = inDept.length - male - female;
    t.push([d, male, female, unk, inDept.length, pct(female, inDept.length)]);
  }
  console.log(t.toString());
}

function printDepartmentVibe(rows: EnrichedMember[]): void {
  console.log(section("Department × vibe"));
  const depts = [...new Set(rows.map((r) => r.department))].sort();
  const vibes = ["analytical", "social", "quiet", "playful", "mentor", "creative"];
  const t = new Table({
    head: ["Department", ...vibes, "Total"],
    colAligns: ["left", ...vibes.map(() => "right" as const), "right"],
  });
  for (const d of depts) {
    const inDept = rows.filter((r) => r.department === d);
    const counts = vibes.map(
      (v) => inDept.filter((r) => r.vibe === v).length,
    );
    t.push([d, ...counts.map((c) => c || ""), inDept.length]);
  }
  console.log(t.toString());
}

function printAge(rows: EnrichedMember[]): void {
  const ages: number[] = [];
  for (const r of rows) if (r.age !== null) ages.push(r.age);
  if (ages.length === 0) return;
  console.log(section(`Age distribution (n=${ages.length})`));
  const buckets: Record<string, number> = {
    "20-24": 0, "25-29": 0, "30-34": 0, "35-39": 0, "40-44": 0, "45+": 0,
  };
  for (const a of ages) {
    if (a < 25) buckets["20-24"]!++;
    else if (a < 30) buckets["25-29"]!++;
    else if (a < 35) buckets["30-34"]!++;
    else if (a < 40) buckets["35-39"]!++;
    else if (a < 45) buckets["40-44"]!++;
    else buckets["45+"]!++;
  }
  const avg = ages.reduce((a, b) => a + b, 0) / ages.length;
  const sorted = [...ages].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const t = new Table({
    head: ["Bucket", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const [k, v] of Object.entries(buckets)) t.push([k, v, pct(v, ages.length)]);
  console.log(t.toString());
  console.log(
    `  Mean: ${avg.toFixed(1)}    Median: ${median}    Range: ${sorted[0]}–${sorted[sorted.length - 1]}`,
  );
}

function printTenure(rows: EnrichedMember[]): void {
  const years: number[] = [];
  for (const r of rows) if (r.joined_year !== null) years.push(r.joined_year);
  if (years.length === 0) return;
  console.log(section(`Joined year (n=${years.length})`));
  const counts = new Map<number, number>();
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
  const t = new Table({
    head: ["Year", "Count", "%"],
    colAligns: ["left", "right", "right"],
  });
  for (const [k, v] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    t.push([String(k), v, pct(v, years.length)]);
  }
  console.log(t.toString());
}

function printBirthMonth(rows: EnrichedMember[]): void {
  const flagged = rows.filter((r) => r.birth_month_flag).length;
  if (flagged === 0) return;
  console.log(section("Birth-month flag (this month's birthdays)"));
  const t = new Table({
    head: ["Flag", "Count"],
    colAligns: ["left", "right"],
  });
  t.push(["Birthday this month", flagged]);
  for (const r of rows.filter((r) => r.birth_month_flag)) {
    t.push([`  ${r.name} (${r.department})`, ""]);
  }
  console.log(t.toString());
}

function printLowConfidence(rows: EnrichedMember[]): void {
  const low = rows.filter((r) => r.confidence === "low");
  if (low.length === 0) return;
  console.log(section(`Low-confidence enrichments (n=${low.length})`));
  const t = new Table({
    head: ["#", "Name", "Dept", "Gender", "MBTI", "Vibe"],
    colAligns: ["right", "left", "left", "left", "left", "left"],
  });
  for (const r of low) {
    t.push([
      r.no,
      r.name,
      r.department,
      r.gender,
      r.mbti,
      r.vibe,
    ]);
  }
  console.log(t.toString());
}

function section(title: string): string {
  return `\n  ── ${title} ` + "─".repeat(Math.max(2, 78 - title.length - 6));
}

function countBy<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sortByValue(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function pct(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}
