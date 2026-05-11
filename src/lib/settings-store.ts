"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import {
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  DEFAULT_METRIC_PARAMS,
  DEFAULT_SOLVER,
  WeightsSchema,
  SolverSettingsSchema,
  MetricParamsSchema,
  FilterSettingsSchema,
  type GroupingProfile,
  type Weights,
  type SolverSettings,
  type MetricParams,
} from "@cli/grouping/profile-config";
import { DEFAULT_SEED_STRING } from "./seed";

export const SettingsSchema = z.object({
  profileName: z.string().min(1),
  groupSize: z.number().int().min(2).max(50),
  // 0 → "auto" (max that fits eligible/groupSize)
  groupCount: z.number().int().nonnegative(),
  seedString: z.string(),
  weights: WeightsSchema,
  solver: SolverSettingsSchema,
  metricParams: MetricParamsSchema,
  historyLookbackRuns: z.number().int().nonnegative(),
  filters: FilterSettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = {
  profileName: DEFAULT_PROFILE.name,
  groupSize: 5,
  groupCount: 0,
  seedString: DEFAULT_SEED_STRING,
  weights: DEFAULT_WEIGHTS,
  solver: DEFAULT_SOLVER,
  metricParams: DEFAULT_METRIC_PARAMS,
  historyLookbackRuns: DEFAULT_PROFILE.history.lookbackRuns,
  filters: DEFAULT_PROFILE.filters,
};

type SettingsStore = Settings & {
  set: (patch: Partial<Settings>) => void;
  setWeight: (key: keyof Weights, value: number) => void;
  setSolver: (key: keyof SolverSettings, value: number) => void;
  setMetricParam: (key: keyof MetricParams, value: number) => void;
  setFilter: (key: keyof Settings["filters"], value: boolean) => void;
  loadFromProfile: (profile: GroupingProfile) => void;
  importJson: (raw: unknown) => { ok: true } | { ok: false; error: string };
  exportJson: () => string;
  reset: () => void;
};

const STORAGE_KEY = "shuffle-lunch.settings";

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      setWeight: (key, value) =>
        set((s) => ({ weights: { ...s.weights, [key]: value } })),
      setSolver: (key, value) =>
        set((s) => ({ solver: { ...s.solver, [key]: value } })),
      setMetricParam: (key, value) =>
        set((s) => ({ metricParams: { ...s.metricParams, [key]: value } })),
      setFilter: (key, value) =>
        set((s) => ({ filters: { ...s.filters, [key]: value } })),
      loadFromProfile: (p) =>
        set({
          profileName: p.name,
          weights: p.weights,
          solver: p.solver,
          metricParams: p.metricParams,
          historyLookbackRuns: p.history.lookbackRuns,
          filters: p.filters,
        }),
      importJson: (raw) => {
        const parsed = SettingsSchema.safeParse(raw);
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
        }
        set(parsed.data);
        return { ok: true };
      },
      exportJson: () => {
        const s = get();
        const settings: Settings = {
          profileName: s.profileName,
          groupSize: s.groupSize,
          groupCount: s.groupCount,
          seedString: s.seedString,
          weights: s.weights,
          solver: s.solver,
          metricParams: s.metricParams,
          historyLookbackRuns: s.historyLookbackRuns,
          filters: s.filters,
        };
        return JSON.stringify(settings, null, 2);
      },
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only persist data, not action functions.
      partialize: (s) => ({
        profileName: s.profileName,
        groupSize: s.groupSize,
        groupCount: s.groupCount,
        seedString: s.seedString,
        weights: s.weights,
        solver: s.solver,
        metricParams: s.metricParams,
        historyLookbackRuns: s.historyLookbackRuns,
        filters: s.filters,
      }),
      // If a future schema break occurs, fall back to defaults rather than
      // crashing.
      migrate: (state, version) => {
        if (version === 1) return state as Settings;
        return DEFAULT_SETTINGS;
      },
    },
  ),
);

export function settingsToProfile(s: Settings): GroupingProfile {
  return {
    name: s.profileName,
    description: null,
    weights: s.weights,
    solver: s.solver,
    metricParams: s.metricParams,
    history: { lookbackRuns: s.historyLookbackRuns },
    filters: s.filters,
  };
}
