// Upload local data files into Vercel Blob storage. Required once before
// the deployed app can serve. Idempotent — overwrites existing blobs with
// the same pathname.
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=… bun cli/cmd/index.ts blob-sync [--dry-run]

import { stat } from "node:fs/promises";
import { intro, log, outro } from "@clack/prompts";
import { walkLocalFiles } from "./walk";
import { put, list, del } from "@vercel/blob";

const DEFAULT_PATHS = [
  "members.xlsx",
  "data/members-flat.xlsx",
  "data/enriched",
  "data/grouping-profiles",
  "data/history",
  "import",
];

// We deliberately skip Notion image attachments — the web app only parses
// markdown / csv / xlsx / json. Including images would balloon a 1 MB sync
// into a multi-hundred-MB one and burn the Vercel Blob free tier.
const DEFAULT_INCLUDE_EXTS = new Set([
  ".json",
  ".xlsx",
  ".csv",
  ".md",
]);

type Args = {
  dryRun: boolean;
  prune: boolean;
  paths: string[];
  includeAll: boolean;
};

export async function runBlobSync(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  intro(`shuffle-lunch blob-sync${args.dryRun ? " (dry-run)" : ""}`);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    log.error("BLOB_READ_WRITE_TOKEN env var is required.");
    log.info(
      "Get one from your Vercel project: Settings → Storage → connect Blob storage. " +
        "Then `vercel env pull .env.local` or copy the token into .env.local.",
    );
    process.exit(1);
  }

  // Collect every local file under the configured paths.
  const local: { fsPath: string; key: string; sizeBytes: number }[] = [];
  let skippedNonText = 0;
  for (const root of args.paths) {
    const exists = await safeStat(root);
    if (!exists) {
      log.warn(`skipped (missing): ${root}`);
      continue;
    }
    if (exists.isFile()) {
      if (args.includeAll || hasIncludedExt(root)) {
        local.push({ fsPath: root, key: root, sizeBytes: exists.size });
      } else {
        skippedNonText++;
      }
      continue;
    }
    for await (const file of walkLocalFiles(root)) {
      if (!args.includeAll && !hasIncludedExt(file)) {
        skippedNonText++;
        continue;
      }
      const s = await stat(file);
      local.push({ fsPath: file, key: file, sizeBytes: s.size });
    }
  }
  if (skippedNonText > 0 && !args.includeAll) {
    log.info(
      `Skipped ${skippedNonText} non-data files (images / binaries). Use --include-all to override.`,
    );
  }

  log.info(`Found ${local.length} local files to upload`);

  const totalBytes = local.reduce((sum, f) => sum + f.sizeBytes, 0);
  log.info(`Total size: ${formatBytes(totalBytes)}`);

  if (args.dryRun) {
    for (const f of local.slice(0, 30)) {
      console.log(`  ${f.key}  (${formatBytes(f.sizeBytes)})`);
    }
    if (local.length > 30) console.log(`  … and ${local.length - 30} more`);
    outro("Dry run complete (no uploads).");
    return;
  }

  let ok = 0;
  let failed = 0;
  let bytes = 0;
  const startedAt = Date.now();
  for (const f of local) {
    try {
      const body = await Bun.file(f.fsPath).arrayBuffer();
      await put(f.key, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      ok++;
      bytes += f.sizeBytes;
      if (ok % 10 === 0 || ok === local.length) {
        const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
        process.stdout.write(
          `  uploaded ${ok}/${local.length} (${formatBytes(bytes)}) in ${dur}s\r`,
        );
      }
    } catch (e) {
      failed++;
      log.warn(
        `failed: ${f.key} — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  process.stdout.write("\n");

  if (args.prune) {
    log.info("Scanning blob for stale entries to prune…");
    const localKeys = new Set(local.map((f) => f.key));
    let pruned = 0;
    let cursor: string | undefined;
    do {
      const page = await list({ cursor });
      for (const b of page.blobs) {
        if (!localKeys.has(b.pathname)) {
          await del(b.url);
          pruned++;
        }
      }
      cursor = page.cursor ?? undefined;
    } while (cursor);
    log.info(`Pruned ${pruned} stale blob(s)`);
  }

  outro(`Done. ${ok} uploaded, ${failed} failed, ${formatBytes(bytes)} total.`);
}

function parseArgs(args: string[]): Args {
  const out: Args = { dryRun: false, prune: false, paths: [], includeAll: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--prune") out.prune = true;
    else if (a === "--include-all") out.includeAll = true;
    else if (a === "--path") {
      const next = args[++i];
      if (!next) throw new Error("--path requires an argument");
      out.paths.push(next);
    } else {
      throw new Error(`Unknown blob-sync arg: ${a}`);
    }
  }
  if (out.paths.length === 0) out.paths = DEFAULT_PATHS;
  return out;
}

function hasIncludedExt(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return DEFAULT_INCLUDE_EXTS.has(path.slice(dot).toLowerCase());
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
