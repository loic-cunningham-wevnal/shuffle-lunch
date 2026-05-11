import { createHash } from "node:crypto";
import {
  EnrichmentRecordSchema,
  type EnrichmentRecord,
} from "./enrichment-schema";
import type { FlatMember } from "./flat-member";
import { flatMemberSourceJson } from "./flat-member";
import { exists, listDir, readJson, writeText } from "./storage";

const CACHE_DIR = "data/enriched";

export function memberSourceHash(member: FlatMember): string {
  // Stable cross-runtime digest of the source JSON. Truncated sha256 keeps
  // the cache record format compact.
  return createHash("sha256")
    .update(flatMemberSourceJson(member))
    .digest("hex")
    .slice(0, 16);
}

function pathFor(memberNo: number): string {
  return `${CACHE_DIR}/${memberNo}.json`;
}

export async function readCached(
  memberNo: number,
): Promise<EnrichmentRecord | null> {
  const path = pathFor(memberNo);
  if (!(await exists(path))) return null;
  try {
    const data = await readJson(path);
    const parsed = EnrichmentRecordSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCached(record: EnrichmentRecord): Promise<void> {
  await writeText(pathFor(record.memberNo), JSON.stringify(record, null, 2));
}

export async function loadAllCached(): Promise<Map<number, EnrichmentRecord>> {
  const map = new Map<number, EnrichmentRecord>();
  const entries = await listDir(CACHE_DIR);
  for (const e of entries) {
    if (!e.name.endsWith(".json")) continue;
    try {
      const data = await readJson(e.pathname);
      const parsed = EnrichmentRecordSchema.safeParse(data);
      if (parsed.success) map.set(parsed.data.memberNo, parsed.data);
    } catch {
      // skip malformed cache entry
    }
  }
  return map;
}
