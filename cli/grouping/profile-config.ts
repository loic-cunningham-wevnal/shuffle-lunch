import { z } from "zod";

export const METRIC_KEYS = [
  "genderBalance",
  "deptDiversity",
  "eiBalance",
  "vibeDiversity",
  "mbtiDiversity",
  "ageProximity",
  "tenureMix",
  "confidenceFloor",
  "recentPairPenalty",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const WeightsSchema = z.object({
  genderBalance: z.number().nonnegative(),
  deptDiversity: z.number().nonnegative(),
  eiBalance: z.number().nonnegative(),
  vibeDiversity: z.number().nonnegative(),
  mbtiDiversity: z.number().nonnegative(),
  ageProximity: z.number().nonnegative().default(0),
  tenureMix: z.number().nonnegative(),
  confidenceFloor: z.number().nonnegative(),
  recentPairPenalty: z.number().nonnegative(),
});
export type Weights = z.infer<typeof WeightsSchema>;

export const SolverSettingsSchema = z.object({
  iterations: z.number().int().positive(),
  restarts: z.number().int().positive(),
  initialTemp: z.number().positive(),
  endTemp: z.number().positive(),
  // Probability of using a 3-group rotation instead of a 2-group pair swap on
  // each iteration. 3-cycles help escape pair-locked local optima.
  threeCycleProbability: z.number().min(0).max(1).default(0.05),
});
export type SolverSettings = z.infer<typeof SolverSettingsSchema>;

export const HistorySettingsSchema = z.object({
  lookbackRuns: z.number().int().nonnegative(),
});
export type HistorySettings = z.infer<typeof HistorySettingsSchema>;

// Parameters controlling the *shape* of metrics (separate from weights).
export const MetricParamsSchema = z.object({
  // Exponent applied to (age - 17) before computing age-stddev.
  // 1.0 = linear (raw years).
  // 0.5 = sqrt curve (default) — a 1y gap at age 22 hurts more than 1y at 42.
  // 0.3 = strong compression — older groups get lots of slack.
  // 0   = ignore age differences entirely (curve flattens).
  ageCurveExponent: z.number().min(0).max(2).default(0.5),
});
export type MetricParams = z.infer<typeof MetricParamsSchema>;

export const FilterSettingsSchema = z.object({
  includeRemote: z.boolean(),
  includeUnavailable: z.boolean(),
});
export type FilterSettings = z.infer<typeof FilterSettingsSchema>;

export const GroupingProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  weights: WeightsSchema,
  solver: SolverSettingsSchema,
  metricParams: MetricParamsSchema.default({ ageCurveExponent: 0.5 }),
  history: HistorySettingsSchema,
  filters: FilterSettingsSchema,
});
export type GroupingProfile = z.infer<typeof GroupingProfileSchema>;

export const DEFAULT_WEIGHTS: Weights = {
  genderBalance: 0.7,
  deptDiversity: 1.5,
  eiBalance: 1.2,
  vibeDiversity: 1.0,
  mbtiDiversity: 0.7,
  ageProximity: 0.7,
  tenureMix: 0.5,
  confidenceFloor: 0.4,
  recentPairPenalty: 0.5,
};

export const DEFAULT_METRIC_PARAMS: MetricParams = {
  ageCurveExponent: 0.5,
};

export const DEFAULT_SOLVER: SolverSettings = {
  iterations: 50000,
  restarts: 4,
  initialTemp: 1.0,
  endTemp: 0.001,
  threeCycleProbability: 0.05,
};

export const DEFAULT_PROFILE: GroupingProfile = {
  name: "default",
  description:
    "Balanced default — cross-team, extroversion, vibe diversity, light age clustering with sqrt curve.",
  weights: DEFAULT_WEIGHTS,
  solver: DEFAULT_SOLVER,
  metricParams: DEFAULT_METRIC_PARAMS,
  history: { lookbackRuns: 2 },
  filters: { includeRemote: false, includeUnavailable: false },
};
