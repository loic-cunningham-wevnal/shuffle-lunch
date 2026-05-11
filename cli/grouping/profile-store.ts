import {
  GroupingProfileSchema,
  type GroupingProfile,
} from "./profile-config";
import { exists, listDir, readJson, writeText } from "../storage";

export const PROFILES_DIR = "data/grouping-profiles";

function pathFor(name: string): string {
  return `${PROFILES_DIR}/${name}.json`;
}

export async function listProfiles(): Promise<GroupingProfile[]> {
  const entries = await listDir(PROFILES_DIR);
  const profiles: GroupingProfile[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.name.endsWith(".json")) continue;
    try {
      const data = await readJson(e.pathname);
      const parsed = GroupingProfileSchema.safeParse(data);
      if (parsed.success) profiles.push(parsed.data);
    } catch {
      // skip unreadable
    }
  }
  return profiles;
}

export async function loadProfile(name: string): Promise<GroupingProfile> {
  const path = pathFor(name);
  if (!(await exists(path))) {
    throw new Error(`Grouping profile not found: ${name} (looked at ${path})`);
  }
  return GroupingProfileSchema.parse(await readJson(path));
}

export async function saveProfile(profile: GroupingProfile): Promise<void> {
  GroupingProfileSchema.parse(profile);
  await writeText(pathFor(profile.name), JSON.stringify(profile, null, 2));
}
