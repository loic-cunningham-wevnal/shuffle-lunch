import { z } from "zod";
import { MBTI_TYPES, VIBE_TAGS } from "./enrichment-schema";

export const FLAT_MEMBER_COLUMNS = [
  // Identity (always present)
  "no",
  "name",
  "name_romaji",

  // Org structure
  "department",
  "detailed_department",
  "job_title",
  "joined_year",

  // Personal context
  "age",
  "hometown",
  "hobbies",
  "comment",
  "surprising_fact",

  // Availability
  "is_remote",
  "is_unavailable",
  "prev_count",
  "birth_month_flag",

  // AI enrichment
  "gender",
  "mbti",
  "vibe",
  "confidence",
  "ai_notes",
] as const;

export const FlatMemberSchema = z.object({
  // Identity (always present)
  no: z.number().int().positive(),
  name: z.string().min(1),
  name_romaji: z.string().nullable(),

  // Org structure
  department: z.string().min(1),
  detailed_department: z.string().nullable(),
  job_title: z.string().nullable(),
  joined_year: z.number().int().nullable(),

  // Personal context
  age: z.number().int().nullable(),
  hometown: z.string().nullable(),
  hobbies: z.string().nullable(),
  comment: z.string().nullable(),
  surprising_fact: z.string().nullable(),

  // Availability (from Excel)
  is_remote: z.boolean(),
  is_unavailable: z.boolean(),
  prev_count: z.number().int().nonnegative(),
  birth_month_flag: z.boolean(),

  // AI enrichment (nullable until enriched)
  gender: z.enum(["male", "female", "unknown"]).nullable(),
  mbti: z.enum(MBTI_TYPES).nullable(),
  vibe: z.enum(VIBE_TAGS).nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  ai_notes: z.string().nullable(),
});

export type FlatMember = z.infer<typeof FlatMemberSchema>;

// Stable subset for enrichment-cache invalidation. Excludes enrichment outputs
// AND name_romaji (purely cosmetic). Mirrors what gets fed to the model.
// Returns the canonical JSON string; pass to Bun.hash (server) or any digest
// function. Kept fs/Bun-API-free so this module stays browser-importable.
export function flatMemberSourceJson(m: FlatMember): string {
  const subset = {
    name: m.name,
    department: m.department,
    detailed_department: m.detailed_department,
    job_title: m.job_title,
    joined_year: m.joined_year,
    age: m.age,
    hometown: m.hometown,
    hobbies: m.hobbies,
    comment: m.comment,
    surprising_fact: m.surprising_fact,
    birth_month_flag: m.birth_month_flag,
  };
  return JSON.stringify(subset);
}
