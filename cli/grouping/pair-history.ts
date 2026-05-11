import { pairKey, type RecentPairs } from "./pair-key";
import { listDir, readJson } from "../storage";
import { z } from "zod";

export { pairKey };
export type { RecentPairs };

export const HISTORY_DIR = "data/history";

// We only need the member numbers per group from each historical entry, so
// parse defensively and ignore any other JSON shape changes.
const MinimalEntrySchema = z.object({
  groups: z.array(
    z.array(
      z.object({
        no: z.number().int().positive(),
      }),
    ),
  ),
});

export async function loadRecentPairs(
  lookbackRuns: number,
  dir: string = HISTORY_DIR,
): Promise<RecentPairs> {
  const empty: RecentPairs = { pairs: new Map(), maxSeen: 0 };
  if (lookbackRuns <= 0) return empty;

  const entries = await listDir(dir);
  const recent = entries
    .filter((e) => e.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(-lookbackRuns);

  const pairs = new Map<string, number>();
  let maxSeen = 0;
  for (const entry of recent) {
    let parsed: { groups: { no: number }[][] };
    try {
      parsed = MinimalEntrySchema.parse(await readJson(entry.pathname));
    } catch {
      continue;
    }
    for (const group of parsed.groups) {
      const sorted = group.map((m) => m.no).sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]}-${sorted[j]}`;
          const next = (pairs.get(key) ?? 0) + 1;
          pairs.set(key, next);
          if (next > maxSeen) maxSeen = next;
        }
      }
    }
  }
  return { pairs, maxSeen };
}
