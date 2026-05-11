import { z } from "zod";

export const VIBE_TAGS = [
  "analytical",
  "social",
  "quiet",
  "playful",
  "mentor",
  "creative",
] as const;

const MBTI_BASE_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP",
] as const;

export const MBTI_TYPES = [
  "Unknown",
  ...MBTI_BASE_TYPES.flatMap((t) => [`${t}-A`, `${t}-T`] as const),
] as const;

export const EnrichmentSchema = z.object({
  gender: z.enum(["male", "female", "unknown"]),
  mbti: z.enum(MBTI_TYPES),
  vibe: z.enum(VIBE_TAGS),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.string().nullable(),
});

export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const EnrichmentRecordSchema = z.object({
  memberNo: z.number().int().positive(),
  sourceHash: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  enrichment: EnrichmentSchema,
});

export type EnrichmentRecord = z.infer<typeof EnrichmentRecordSchema>;
