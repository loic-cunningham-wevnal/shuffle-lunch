// Local pre-processing: parse Notion + members.xlsx + enrichment cache into
// a single canonical FlatMember[] file. The deployed web app reads only this
// file (and group history / grouping profiles) — it never touches the raw
// Notion / xlsx sources, which stay on the operator's local disk.
//
// Run after `cli enrich` to bake the latest enrichments in, then `cli
// blob-sync` to upload to Vercel Blob.

import { intro, log, outro } from "@clack/prompts";
import { loadEnrichedMembers } from "./load";
import { writeText } from "../storage";

export const MEMBERS_BLOB_PATH = "data/members.json";

type Args = { out: string };

export async function runBuildMembers(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  intro("shuffle-lunch build-members");

  const { members, unmatched, cachedEnrichmentCount } =
    await loadEnrichedMembers();

  log.info(
    `Parsed ${members.length} members (${cachedEnrichmentCount} with cached enrichment)`,
  );
  if (unmatched.csvNames.length > 0 || unmatched.pageTitles.length > 0) {
    log.warn(
      `Notion entries with no matching member: csv=${unmatched.csvNames.length}, md=${unmatched.pageTitles.length}`,
    );
  }

  const json = JSON.stringify(members, null, 2);
  await writeText(args.out, json);
  log.info(`Wrote ${args.out} (${(json.length / 1024).toFixed(1)} KB)`);

  outro(
    `Done. Run \`bun cli/cmd/index.ts blob-sync\` to upload to Vercel Blob.`,
  );
}

function parseArgs(args: string[]): Args {
  let out: string = MEMBERS_BLOB_PATH;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") {
      const next = args[++i];
      if (!next) throw new Error("--out requires a path argument");
      out = next;
    } else {
      throw new Error(`Unknown build-members arg: ${a}`);
    }
  }
  return { out };
}
