import { z } from "zod";
import { FlatMemberSchema, type FlatMember } from "./flat-member";

export const GroupSchema = z.object({
  id: z.number().int().positive(),
  members: z.array(FlatMemberSchema).min(2),
});

export const GroupsSchema = z.array(GroupSchema);

export type Group = z.infer<typeof GroupSchema>;

export type FilterOptions = {
  includeRemote?: boolean;
  includeUnavailable?: boolean;
};

export type BuildGroupsOptions = {
  groupCount: number;
  groupSize: number;
};

export function filterEligible(
  members: FlatMember[],
  opts: FilterOptions,
): FlatMember[] {
  return members.filter((m) => {
    if (!opts.includeUnavailable && m.is_unavailable) return false;
    if (!opts.includeRemote && m.is_remote) return false;
    return true;
  });
}

export function buildGroups(
  members: FlatMember[],
  { groupCount, groupSize }: BuildGroupsOptions,
): Group[] {
  if (groupCount < 1) {
    throw new Error(`groupCount must be >= 1 (got ${groupCount})`);
  }
  if (groupSize < 2) {
    throw new Error(`groupSize must be >= 2 (got ${groupSize})`);
  }
  const required = groupCount * groupSize;
  if (members.length < required) {
    throw new Error(
      `Need ${required} members for ${groupCount} groups of ${groupSize}, got ${members.length}`,
    );
  }

  const buckets = new Map<string, FlatMember[]>();
  for (const m of members) {
    const list = buckets.get(m.department) ?? [];
    list.push(m);
    buckets.set(m.department, list);
  }
  for (const list of buckets.values()) shuffle(list);

  const sortedDepartments = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  const groups: FlatMember[][] = Array.from({ length: groupCount }, () => []);
  let cursor = 0;
  for (const [, list] of sortedDepartments) {
    for (const member of list) {
      let attempts = 0;
      while (groups[cursor % groupCount]!.length >= groupSize) {
        cursor++;
        if (++attempts > groupCount) break;
      }
      if (attempts > groupCount) break;
      groups[cursor % groupCount]!.push(member);
      cursor++;
    }
    if (groups.every((g) => g.length >= groupSize)) break;
  }

  return GroupsSchema.parse(
    groups.map((m, i) => ({ id: i + 1, members: m })),
  );
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
