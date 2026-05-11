import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import {
  listProfiles,
  loadProfile,
  saveProfile,
} from "@cli/grouping/profile-store";
import {
  DEFAULT_PROFILE,
  GroupingProfileSchema,
} from "@cli/grouping/profile-config";

export const profilesRouter = router({
  list: publicProcedure.query(async () => {
    const profiles = await listProfiles();
    if (profiles.length === 0) return [DEFAULT_PROFILE];
    return profiles;
  }),

  get: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      return await loadProfile(input.name);
    }),

  save: publicProcedure
    .input(GroupingProfileSchema)
    .mutation(async ({ input }) => {
      await saveProfile(input);
      return { ok: true as const, name: input.name };
    }),
});
