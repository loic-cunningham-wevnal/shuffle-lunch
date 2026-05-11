import { intro, log, outro } from "@clack/prompts";
import { loadEnrichedMembers } from "./load";
import { readMembersFlatXlsx } from "../members-flat-xlsx";
import {
  memberSourceHash,
  readCached,
  writeCached,
} from "../enrichment-cache";
import type { FlatMember } from "../flat-member";
import type { EnrichmentRecord } from "../enrichment-schema";

type ImportArgs = { file: string; dryRun: boolean };

type ChangeDescriptor = {
  member: FlatMember;
  changes: string[];
  newRecord: EnrichmentRecord;
};

export async function runImportMembers(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  intro(
    `shuffle-lunch import-members${args.dryRun ? " (dry-run)" : ""}`,
  );

  const { rows, rowErrors } = await readMembersFlatXlsx(args.file);
  log.info(`Read ${rows.length} rows from ${args.file}`);
  for (const e of rowErrors) {
    log.warn(`Row ${e.rowNumber}: ${e.error}`);
  }

  const { members } = await loadEnrichedMembers();
  const byNo = new Map<number, FlatMember>();
  for (const m of members) byNo.set(m.no, m);

  let unknownMemberSkipped = 0;
  let incompleteSkipped = 0;
  let updated = 0;
  let unchanged = 0;
  const changeList: ChangeDescriptor[] = [];

  for (const row of rows) {
    const current = byNo.get(row.no);
    if (!current) {
      log.warn(`Row no=${row.no}: no matching member in source data, skipping`);
      unknownMemberSkipped++;
      continue;
    }

    const cached = await readCached(row.no);
    const cachedE = cached?.enrichment ?? null;

    const sameGender = cachedE?.gender === row.gender;
    const sameMbti = cachedE?.mbti === row.mbti;
    const sameVibe = cachedE?.vibe === row.vibe;
    const sameConfidence = cachedE?.confidence === row.confidence;
    const sameNotes = (cachedE?.notes ?? null) === (row.ai_notes ?? null);

    if (
      cachedE &&
      sameGender &&
      sameMbti &&
      sameVibe &&
      sameConfidence &&
      sameNotes
    ) {
      unchanged++;
      continue;
    }

    // Need all four required enrichment enum fields to be non-null.
    if (
      row.gender === null ||
      row.mbti === null ||
      row.vibe === null ||
      row.confidence === null
    ) {
      const missing: string[] = [];
      if (row.gender === null) missing.push("gender");
      if (row.mbti === null) missing.push("mbti");
      if (row.vibe === null) missing.push("vibe");
      if (row.confidence === null) missing.push("confidence");
      log.warn(
        `Row no=${row.no} (${row.name}): incomplete enrichment, missing ${missing.join(", ")} — skipped`,
      );
      incompleteSkipped++;
      continue;
    }

    const changes: string[] = [];
    if (!sameGender)
      changes.push(`gender: ${fmt(cachedE?.gender)} → ${fmt(row.gender)}`);
    if (!sameMbti)
      changes.push(`mbti: ${fmt(cachedE?.mbti)} → ${fmt(row.mbti)}`);
    if (!sameVibe)
      changes.push(`vibe: ${fmt(cachedE?.vibe)} → ${fmt(row.vibe)}`);
    if (!sameConfidence)
      changes.push(
        `confidence: ${fmt(cachedE?.confidence)} → ${fmt(row.confidence)}`,
      );
    if (!sameNotes)
      changes.push(`ai_notes: ${fmt(cachedE?.notes)} → ${fmt(row.ai_notes)}`);

    const record: EnrichmentRecord = {
      memberNo: row.no,
      sourceHash: memberSourceHash(current),
      model: "manual-edit",
      generatedAt: new Date().toISOString(),
      enrichment: {
        gender: row.gender,
        mbti: row.mbti,
        vibe: row.vibe,
        confidence: row.confidence,
        notes: row.ai_notes,
      },
    };

    changeList.push({ member: current, changes, newRecord: record });
    updated++;
  }

  if (!args.dryRun) {
    for (const c of changeList) {
      await writeCached(c.newRecord);
    }
  }

  console.log();
  console.log(`Members in xlsx: ${rows.length}`);
  console.log(`Rows skipped (parse error): ${rowErrors.length}`);
  console.log(`Rows skipped (unknown member no): ${unknownMemberSkipped}`);
  console.log(`Rows skipped (incomplete enrichment): ${incompleteSkipped}`);
  console.log(`Enrichments ${args.dryRun ? "would-be-updated" : "updated"}: ${updated}`);
  console.log(`Enrichments unchanged: ${unchanged}`);

  if (args.dryRun && changeList.length > 0) {
    console.log();
    console.log("Changes (dry-run, not written):");
    for (const c of changeList) {
      console.log(
        `  #${c.member.no} — ${c.member.name} — ${c.changes.join(", ")}`,
      );
    }
  }

  outro(args.dryRun ? "Dry-run complete (no files written)." : "Done.");
}

function fmt(v: string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v;
}

function parseArgs(args: string[]): ImportArgs {
  let file: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") {
      const next = args[++i];
      if (!next) throw new Error("--file requires a path argument");
      file = next;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown import-members arg: ${a}`);
    }
  }
  if (!file) throw new Error("import-members: --file <path> is required");
  return { file, dryRun };
}
