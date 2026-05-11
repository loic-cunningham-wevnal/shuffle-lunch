import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import {
  FlatMemberSchema,
  type FlatMember,
} from "@cli/flat-member";
import { exists, readJson, writeText } from "@cli/storage";

export const MEMBERS_PATH = "data/members.json";

const MembersListSchema = z.array(FlatMemberSchema);

async function loadAll(): Promise<FlatMember[]> {
  if (!(await exists(MEMBERS_PATH))) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${MEMBERS_PATH} not found. Run \`bun cli/cmd/index.ts build-members\` then \`blob-sync\`.`,
    });
  }
  return MembersListSchema.parse(await readJson(MEMBERS_PATH));
}

async function saveAll(members: FlatMember[]): Promise<void> {
  await writeText(MEMBERS_PATH, JSON.stringify(members, null, 2));
}

// Subset of FlatMember fields the UI is allowed to edit. We omit `no` (the
// stable identifier) and the org-derived fields that come from members.xlsx
// — those are owned by the local CLI build pipeline.
const MemberPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    name_romaji: z.string().nullable().optional(),
    department: z.string().min(1).optional(),
    detailed_department: z.string().nullable().optional(),
    job_title: z.string().nullable().optional(),
    joined_year: z.number().int().nullable().optional(),
    age: z.number().int().nullable().optional(),
    hometown: z.string().nullable().optional(),
    hobbies: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    surprising_fact: z.string().nullable().optional(),
    is_remote: z.boolean().optional(),
    is_unavailable: z.boolean().optional(),
    prev_count: z.number().int().nonnegative().optional(),
    birth_month_flag: z.boolean().optional(),
    gender: z.enum(["male", "female", "unknown"]).nullable().optional(),
    mbti: FlatMemberSchema.shape.mbti.optional(),
    vibe: FlatMemberSchema.shape.vibe.optional(),
    confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
    ai_notes: z.string().nullable().optional(),
  })
  .strict();

// Required + optional shape for creation. `no` is server-assigned (max+1).
const CreateMemberSchema = FlatMemberSchema.omit({ no: true });

export const membersRouter = router({
  list: publicProcedure.query(async () => {
    const members = await loadAll();
    return { members, total: members.length };
  }),

  update: publicProcedure
    .input(
      z.object({
        no: z.number().int().positive(),
        patch: MemberPatchSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const members = await loadAll();
      const idx = members.findIndex((m) => m.no === input.no);
      if (idx < 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Member no=${input.no} not found`,
        });
      }
      // Strip undefined keys so we don't accidentally null-out fields when the
      // client serializes optional properties as undefined → JSON drops them.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.patch)) {
        if (v !== undefined) cleaned[k] = v;
      }
      const updated = FlatMemberSchema.parse({ ...members[idx], ...cleaned });
      members[idx] = updated;
      await saveAll(members);
      return { ok: true as const, member: updated };
    }),

  // Create a new member. The server picks the next `no` as max + 1 so the
  // client never has to know the current highest id and concurrent creates
  // can't collide on a duplicate.
  create: publicProcedure
    .input(CreateMemberSchema)
    .mutation(async ({ input }) => {
      const members = await loadAll();
      const nextNo =
        members.reduce((acc, m) => (m.no > acc ? m.no : acc), 0) + 1;
      const created: FlatMember = FlatMemberSchema.parse({
        ...input,
        no: nextNo,
      });
      members.push(created);
      await saveAll(members);
      return { ok: true as const, member: created };
    }),

  delete: publicProcedure
    .input(z.object({ no: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const members = await loadAll();
      const idx = members.findIndex((m) => m.no === input.no);
      if (idx < 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Member no=${input.no} not found`,
        });
      }
      const removed = members.splice(idx, 1)[0]!;
      await saveAll(members);
      return { ok: true as const, member: removed };
    }),
});
