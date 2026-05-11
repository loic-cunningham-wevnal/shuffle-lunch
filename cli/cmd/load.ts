import { loadFlatMembers } from "../profiles";
import { loadAllCached } from "../enrichment-cache";
import { LOAD_PROFILES_ARGS } from "./paths";
import type { FlatMember } from "../flat-member";

export type LoadEnrichedResult = {
  members: FlatMember[];
  unmatched: { csvNames: string[]; pageTitles: string[] };
  cachedEnrichmentCount: number;
};

export async function loadEnrichedMembers(): Promise<LoadEnrichedResult> {
  const [{ members, unmatched }, cache] = await Promise.all([
    loadFlatMembers(LOAD_PROFILES_ARGS),
    loadAllCached(),
  ]);
  let cachedEnrichmentCount = 0;
  const enriched: FlatMember[] = members.map((m) => {
    const rec = cache.get(m.no);
    if (!rec) return m;
    cachedEnrichmentCount++;
    return {
      ...m,
      gender: rec.enrichment.gender,
      mbti: rec.enrichment.mbti,
      vibe: rec.enrichment.vibe,
      confidence: rec.enrichment.confidence,
      ai_notes: rec.enrichment.notes,
    };
  });
  return { members: enriched, unmatched, cachedEnrichmentCount };
}
