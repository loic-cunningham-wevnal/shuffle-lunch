import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import {
  HistoryEntrySchema,
  deleteHistoryEntry,
  isValidHistoryId,
  listHistory,
  loadHistoryEntry,
  makeHistoryId,
  saveHistoryEntry,
  type HistoryEntry,
} from "@cli/history";

const IdInput = z.object({
  id: z
    .string()
    .min(1)
    .refine(isValidHistoryId, { message: "invalid history id" }),
});

export const historyRouter = router({
  list: publicProcedure.query(async () => {
    return await listHistory();
  }),

  get: publicProcedure
    .input(IdInput)
    .query(async ({ input }) => {
      try {
        return await loadHistoryEntry(input.id);
      } catch (e) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: e instanceof Error ? e.message : "not found",
        });
      }
    }),

  // Create or overwrite an entry. The client provides the full snapshot —
  // server doesn't recompute scores (the dashboard already does that
  // client-side after edits, using cli/grouping/score.ts).
  save: publicProcedure
    .input(
      z.object({
        // Optional id — when omitted, derived from runAt.
        id: z.string().min(1).optional(),
        label: z.string().nullable().optional(),
        entry: HistoryEntrySchema.omit({
          id: true,
          updatedAt: true,
          label: true,
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const id = input.id ?? makeHistoryId(input.entry.runAt);
      if (!isValidHistoryId(id)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "invalid history id",
        });
      }
      const now = new Date().toISOString();
      const full: HistoryEntry = {
        ...input.entry,
        id,
        label: input.label ?? null,
        updatedAt: now,
      };
      await saveHistoryEntry(full);
      return { ok: true as const, id, updatedAt: now };
    }),

  delete: publicProcedure
    .input(IdInput)
    .mutation(async ({ input }) => {
      await deleteHistoryEntry(input.id);
      return { ok: true as const };
    }),
});
