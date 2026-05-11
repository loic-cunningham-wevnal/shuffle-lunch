import { z } from "zod";

export const MemberSchema = z.object({
  no: z.number().int().positive(),
  name: z.string().min(1),
  department: z.string().min(1),
  isRemote: z.boolean(),
  isUnavailable: z.boolean(),
  previousCount: z.number().int().nonnegative(),
});

export type Member = z.infer<typeof MemberSchema>;

export const MembersSchema = z.array(MemberSchema);
