import { intro, log, outro } from "@clack/prompts";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadEnrichedMembers } from "./load";
import { writeMembersFlatXlsx } from "../members-flat-xlsx";

const DEFAULT_OUT = "data/members-flat.xlsx";

type ExportArgs = { out: string };

export async function runExportMembers(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  intro("shuffle-lunch export-members");

  const { members } = await loadEnrichedMembers();
  log.info(`Loaded ${members.length} members`);

  await mkdir(dirname(args.out), { recursive: true });
  await writeMembersFlatXlsx(members, args.out);

  log.info(`Exported ${members.length} members to ${args.out}`);
  log.info(
    "Editable columns when re-imported: gender, mbti, vibe, confidence, ai_notes (other edits are ignored — those fields are sourced from members.xlsx / Notion).",
  );
  outro("Done.");
}

function parseArgs(args: string[]): ExportArgs {
  let out = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") {
      const next = args[++i];
      if (!next) throw new Error("--out requires a path argument");
      out = next;
    } else {
      throw new Error(`Unknown export-members arg: ${a}`);
    }
  }
  return { out };
}
