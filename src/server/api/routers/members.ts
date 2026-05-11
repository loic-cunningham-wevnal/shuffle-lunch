import { router, publicProcedure } from "../trpc";
import { loadEnrichedMembers } from "@cli/cmd/load";

export const membersRouter = router({
  list: publicProcedure.query(async () => {
    const { members, unmatched, cachedEnrichmentCount } =
      await loadEnrichedMembers();
    return { members, unmatched, cachedEnrichmentCount };
  }),
});
