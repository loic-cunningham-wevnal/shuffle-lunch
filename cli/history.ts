// Canonical JSON snapshot for one shuffle run. Persisted to
// data/history/<id>.json via the storage abstraction (local fs in dev, Vercel
// Blob in prod). Reversible — the dashboard can load any entry back into the
// editor and re-save.

import { z } from "zod";
import { FlatMemberSchema } from "./flat-member";
import { GroupingProfileSchema } from "./grouping/profile-config";
import { exists, listDir, readJson, remove, writeText } from "./storage";

export const HISTORY_DIR = "data/history";

const ScoreSchema = z.object({
  total: z.number(),
  groupScores: z.array(z.number()),
  groupBreakdowns: z.array(
    z.object({
      genderBalance: z.number(),
      deptDiversity: z.number(),
      eiBalance: z.number(),
      vibeDiversity: z.number(),
      mbtiDiversity: z.number(),
      ageProximity: z.number(),
      tenureMix: z.number(),
      confidenceFloor: z.number(),
      recentPairPenalty: z.number(),
    }),
  ),
});

export const HistoryEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  runAt: z.string().min(1),
  updatedAt: z.string().min(1),
  profile: GroupingProfileSchema,
  seed: z.number(),
  groupCount: z.number().int().positive(),
  groupSize: z.number().int().positive(),
  filters: z.object({
    includeRemote: z.boolean(),
    includeUnavailable: z.boolean(),
  }),
  allMembers: z.array(FlatMemberSchema),
  groups: z.array(z.array(FlatMemberSchema)),
  bench: z.array(FlatMemberSchema),
  initialScore: ScoreSchema,
  finalScore: ScoreSchema,
  used: z.number().int().nonnegative(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistorySummarySchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  runAt: z.string(),
  updatedAt: z.string(),
  groupCount: z.number().int(),
  groupSize: z.number().int(),
  used: z.number().int(),
  totalScore: z.number(),
  sizeBytes: z.number().nonnegative().nullable(),
});
export type HistorySummary = z.infer<typeof HistorySummarySchema>;

const ID_PATTERN = /^[\w.\-:]+$/;

export function isValidHistoryId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.includes("..");
}

function pathFor(id: string): string {
  if (!isValidHistoryId(id)) throw new Error(`Invalid history id: ${id}`);
  return `${HISTORY_DIR}/${id}.json`;
}

export function makeHistoryId(runAt: string): string {
  // Filesystem-safe ISO-8601 (drop subsecond/zone separators).
  return runAt.replace(/[:.]/g, "-");
}

export async function listHistory(): Promise<HistorySummary[]> {
  const entries = await listDir(HISTORY_DIR);
  const out: HistorySummary[] = [];
  for (const e of entries) {
    if (!e.name.endsWith(".json")) continue;
    try {
      const parsed = HistoryEntrySchema.safeParse(await readJson(e.pathname));
      if (!parsed.success) continue;
      out.push({
        id: parsed.data.id,
        label: parsed.data.label,
        runAt: parsed.data.runAt,
        updatedAt: parsed.data.updatedAt,
        groupCount: parsed.data.groupCount,
        groupSize: parsed.data.groupSize,
        used: parsed.data.used,
        totalScore: parsed.data.finalScore.total,
        sizeBytes: e.sizeBytes ?? null,
      });
    } catch {
      // skip malformed
    }
  }
  // Newest first.
  out.sort((a, b) => b.runAt.localeCompare(a.runAt));
  return out;
}

export async function loadHistoryEntry(id: string): Promise<HistoryEntry> {
  const path = pathFor(id);
  if (!(await exists(path))) throw new Error(`History entry not found: ${id}`);
  return HistoryEntrySchema.parse(await readJson(path));
}

export async function saveHistoryEntry(entry: HistoryEntry): Promise<void> {
  HistoryEntrySchema.parse(entry);
  await writeText(pathFor(entry.id), JSON.stringify(entry, null, 2));
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await remove(pathFor(id));
}
