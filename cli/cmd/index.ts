import { runProfiles } from "./profiles";
import { runEnrich } from "./enrich";
import { runShuffle } from "./shuffle";
import { runReport } from "./report";
import { runExportMembers } from "./export-members";
import { runImportMembers } from "./import-members";
import { runBlobSync } from "./blob-sync";
import { runBuildMembers } from "./build-members";

const HELP = `shuffle-lunch — group members for lunch

Usage:
  bun cli/cmd/index.ts <command> [options]

Commands:
  profiles            Print all merged profiles as JSON (members + Notion + cached enrichment).
  enrich              Run Claude (Sonnet 4.6) over un-cached profiles and write data/enriched/<no>.json.
                      Options: --force, --limit <N>, --concurrency <N> (default 4, alias -j).
  shuffle             Score-based group solver. Interactive picker for grouping profile.
                      Options:
                        --profile <name>          use a named profile (skips picker)
                        --weight.<key> <n>        override one weight (gender|dept|ei|vibe|mbti|age|tenure|confidence|recent)
                        --age-curve <n>           age compression exponent: 1.0 linear, 0.5 sqrt (default), 0.3 strong
                        --iterations <N>          override SA iterations per restart
                        --restarts <N>            override SA restarts
                        --seed <N>                seed RNG for reproducibility
                        --size <N> --count <N>    skip the size/count prompts
                        --save-as <name>          save effective config as data/grouping-profiles/<name>.json
                        --out <path>              override the output xlsx path (default data/history/<ISO>.xlsx)
                        --no-history              skip xlsx write + skip reading prior xlsx history
  report              Print a company report (gender / MBTI / vibe / department).
  export-members      Write the full member list (with cached enrichment) to an xlsx file
                      so editable enrichment fields can be tweaked by hand.
                      Options:
                        --out <path>              output xlsx (default data/members-flat.xlsx)
  import-members      Re-read an edited members-flat.xlsx and update the enrichment cache
                      for any rows whose gender/mbti/vibe/confidence/ai_notes changed.
                      Options:
                        --file <path>             input xlsx (required)
                        --dry-run                 show what would change without writing
  build-members       Parse members.xlsx + Notion + enrichment cache into the canonical
                      data/members.json file. Run before blob-sync.
                      Options:
                        --out <path>              override output path (default data/members.json)
  blob-sync           Upload data/members.json + data/history/* + data/grouping-profiles/*
                      to Vercel Blob. Requires BLOB_READ_WRITE_TOKEN env var.
                      Options:
                        --dry-run                 list what would be uploaded without writing
                        --prune                   delete blobs that don't have a local counterpart
                        --path <path>             override the default upload roots (repeatable)
  help                Show this help.
`;

const [, , command, ...rest] = process.argv;

switch (command) {
  case "profiles":
    await runProfiles();
    break;
  case "enrich":
    await runEnrich(rest);
    break;
  case "shuffle":
    await runShuffle(rest);
    break;
  case "report":
    await runReport();
    break;
  case "export-members":
    await runExportMembers(rest);
    break;
  case "import-members":
    await runImportMembers(rest);
    break;
  case "blob-sync":
    await runBlobSync(rest);
    break;
  case "build-members":
    await runBuildMembers(rest);
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(HELP);
    process.exit(1);
}
