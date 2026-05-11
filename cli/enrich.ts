import type { FlatMember } from "./flat-member";
import type { Enrichment } from "./enrichment-schema";

export const ENRICHMENT_MODEL = "claude-sonnet-4-6";

// NOTE: The original enrichMember() implementation (which called the Claude
// Agent SDK against each FlatMember and returned a parsed Enrichment) was
// destroyed by an accidental file overwrite. The cached results in
// data/enriched/*.json remain intact and are the source of truth for the
// current runtime. Rebuild this function before running `cli enrich` again.
export async function enrichMember(_member: FlatMember): Promise<Enrichment> {
  throw new Error(
    "enrichMember not implemented (lost in repo restructure). " +
      "Cached enrichments under data/enriched/*.json are still valid; " +
      "re-implement using @anthropic-ai/claude-agent-sdk against ENRICHMENT_MODEL.",
  );
}
