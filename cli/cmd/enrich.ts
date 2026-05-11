import pLimit from "p-limit";
import cliProgress from "cli-progress";
import { loadEnrichedMembers } from "./load";
import { enrichMember, ENRICHMENT_MODEL } from "../enrich";
import {
  memberSourceHash,
  readCached,
  writeCached,
} from "../enrichment-cache";
import type { FlatMember } from "../flat-member";
import type { Enrichment } from "../enrichment-schema";

type EnrichArgs = {
  force: boolean;
  limit: number | null;
  concurrency: number;
};

const DEFAULT_CONCURRENCY = 4;

export async function runEnrich(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  console.log(
    `\nshuffle-lunch enrich  model=${ENRICHMENT_MODEL}  concurrency=${args.concurrency}\n`,
  );

  const { members } = await loadEnrichedMembers();

  type Pending = { member: FlatMember; sourceHash: string };
  const pending: Pending[] = [];
  let upToDate = 0;
  for (const m of members) {
    const sourceHash = memberSourceHash(m);
    if (!args.force) {
      const cached = await readCached(m.no);
      if (cached && cached.sourceHash === sourceHash) {
        upToDate++;
        continue;
      }
    }
    pending.push({ member: m, sourceHash });
  }

  const targets =
    args.limit !== null ? pending.slice(0, args.limit) : pending;

  console.log(
    `Total profiles: ${members.length}  |  cached & current: ${upToDate}  |  to enrich: ${pending.length}  |  running: ${targets.length}\n`,
  );

  if (targets.length === 0) {
    console.log("Nothing to do.\n");
    return;
  }

  const bar = new cliProgress.SingleBar(
    {
      format:
        "[{bar}] {percentage}% | {value}/{total} | ok={succeeded} fail={failed} | elapsed {duration_formatted} | eta {eta_formatted}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
      forceRedraw: true,
    },
    cliProgress.Presets.shades_classic,
  );

  let succeeded = 0;
  let failed = 0;
  bar.start(targets.length, 0, { succeeded, failed });

  const limit = pLimit(args.concurrency);
  const tasks = targets.map((t) =>
    limit(async () => {
      const startedAt = Date.now();
      try {
        const enrichment = await enrichMember(t.member);
        await writeCached({
          memberNo: t.member.no,
          sourceHash: t.sourceHash,
          model: ENRICHMENT_MODEL,
          generatedAt: new Date().toISOString(),
          enrichment,
        });
        succeeded++;
        bar.increment({ succeeded, failed });
        printResult(t.member, enrichment, Date.now() - startedAt);
      } catch (e) {
        failed++;
        bar.increment({ succeeded, failed });
        printError(t.member, (e as Error).message, Date.now() - startedAt);
      }
    }),
  );

  await Promise.all(tasks);
  bar.stop();
  console.log(`\nDone. ${succeeded} ok, ${failed} failed.\n`);
}

function printResult(
  member: FlatMember,
  e: Enrichment,
  durationMs: number,
): void {
  const dur = `${(durationMs / 1000).toFixed(1)}s`;
  const conf = e.confidence[0]!.toUpperCase();
  const note = e.notes ? truncate(e.notes, 70) : "";
  console.log(
    `  ✓ ${dur.padStart(5)} #${String(member.no).padStart(3)} ${pad(member.name, 18)} ${pad(e.gender, 7)} ${pad(e.mbti, 8)} ${pad(e.vibe, 11)} [${conf}] ${note}`,
  );
}

function printError(member: FlatMember, message: string, durationMs: number): void {
  const dur = `${(durationMs / 1000).toFixed(1)}s`;
  const firstLine = message.split("\n")[0]!.slice(0, 140);
  console.log(
    `  ✗ ${dur.padStart(5)} #${String(member.no).padStart(3)} ${pad(member.name, 18)} ${firstLine}`,
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function parseArgs(args: string[]): EnrichArgs {
  let force = false;
  let limit: number | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--force") force = true;
    else if (a === "--limit") {
      const next = args[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1)
        throw new Error("--limit must be a positive integer");
      limit = n;
    } else if (a === "--concurrency" || a === "-j") {
      const next = args[++i];
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1)
        throw new Error("--concurrency must be a positive integer");
      concurrency = n;
    } else {
      throw new Error(`Unknown enrich arg: ${a}`);
    }
  }
  return { force, limit, concurrency };
}
