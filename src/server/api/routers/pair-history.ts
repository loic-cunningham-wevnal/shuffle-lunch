import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { loadRecentPairs } from "@cli/grouping/pair-history";

// RecentPairs ships a Map; superjson will preserve it across the wire.
export const pairHistoryRouter = router({
  recent: publicProcedure
    .input(z.object({ lookbackRuns: z.number().int().nonnegative() }))
    .query(async ({ input }) => {
      return await loadRecentPairs(input.lookbackRuns);
    }),
});
