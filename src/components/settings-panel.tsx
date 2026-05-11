"use client";

import { useSettings } from "@/lib/settings-store";
import { Section } from "./section";
import { Slider } from "./slider";
import { SettingsIO } from "./settings-io";
import { trpc } from "@/trpc/client";
import type { GroupingProfile } from "@cli/grouping/profile-config";

const WEIGHT_LABELS: Record<string, string> = {
  genderBalance: "Gender balance",
  deptDiversity: "Dept diversity",
  eiBalance: "E/I balance",
  vibeDiversity: "Vibe diversity",
  mbtiDiversity: "MBTI diversity",
  ageProximity: "Age proximity",
  tenureMix: "Tenure mix",
  confidenceFloor: "Confidence floor",
  recentPairPenalty: "Recent-pair penalty",
};

type Props = {
  eligibleCount: number;
};

export function SettingsPanel({ eligibleCount }: Props) {
  const s = useSettings();
  const profilesQuery = trpc.profiles.list.useQuery();

  const maxGroups = Math.max(1, Math.floor(eligibleCount / s.groupSize));
  const effectiveCount =
    s.groupCount === 0 ? maxGroups : Math.min(s.groupCount, maxGroups);

  return (
    <div className="space-y-3">
      <Section title="Profile" defaultOpen>
        <label className="block">
          <span className="text-xs text-zinc-400 mb-1 block">Base profile</span>
          <select
            value={s.profileName}
            onChange={(e) => {
              const next = profilesQuery.data?.find(
                (p: GroupingProfile) => p.name === e.currentTarget.value,
              );
              if (next) s.loadFromProfile(next);
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm"
          >
            {(profilesQuery.data ?? []).map((p: GroupingProfile) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <SettingsIO />
      </Section>

      <Section title="Structure" defaultOpen>
        <Slider
          label="Group size"
          value={s.groupSize}
          min={2}
          max={12}
          step={1}
          onChange={(v) => s.set({ groupSize: v })}
        />
        <Slider
          label={
            <>
              Group count{" "}
              <span className="text-zinc-500 font-normal">(0 = auto/max)</span>
            </>
          }
          hint={`auto = ${maxGroups} (${effectiveCount * s.groupSize} of ${eligibleCount} eligible used)`}
          value={s.groupCount}
          min={0}
          max={maxGroups}
          step={1}
          onChange={(v) => s.set({ groupCount: v })}
        />
        <label className="block">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs font-medium text-zinc-200">Seed</span>
            <span className="text-[10px] text-zinc-500">deterministic if non-empty</span>
          </div>
          <input
            type="text"
            value={s.seedString}
            onChange={(e) => s.set({ seedString: e.currentTarget.value })}
            placeholder="wevnal-shuffle-lunch"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <Slider
          label="Iterations / restart"
          value={s.solver.iterations}
          min={1000}
          max={100000}
          step={1000}
          onChange={(v) => s.setSolver("iterations", v)}
          format={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Slider
          label="Restarts"
          value={s.solver.restarts}
          min={1}
          max={10}
          step={1}
          onChange={(v) => s.setSolver("restarts", v)}
        />
      </Section>

      <Section title="Weights" defaultOpen>
        {(Object.keys(s.weights) as Array<keyof typeof s.weights>).map((k) => (
          <Slider
            key={k}
            label={WEIGHT_LABELS[k] ?? k}
            value={s.weights[k]}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) => s.setWeight(k, v)}
            format={(v) => v.toFixed(2)}
          />
        ))}
      </Section>

      <Section title="Solver advanced" defaultOpen={false}>
        <Slider
          label="Initial temperature"
          value={s.solver.initialTemp}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => s.setSolver("initialTemp", v)}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="End temperature"
          value={s.solver.endTemp}
          min={0.0001}
          max={0.1}
          step={0.0001}
          onChange={(v) => s.setSolver("endTemp", v)}
          format={(v) => v.toFixed(4)}
        />
        <Slider
          label="3-cycle probability"
          hint="probability of a 3-group rotation per iter (helps escape local optima)"
          value={s.solver.threeCycleProbability}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(v) => s.setSolver("threeCycleProbability", v)}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Age curve exponent"
          hint="1.0 linear · 0.5 sqrt (default) · 0.3 compress · 0 ignore age"
          value={s.metricParams.ageCurveExponent}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => s.setMetricParam("ageCurveExponent", v)}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="History lookback (runs)"
          hint="penalize recently-paired members"
          value={s.historyLookbackRuns}
          min={0}
          max={10}
          step={1}
          onChange={(v) => s.set({ historyLookbackRuns: v })}
        />
      </Section>

      <Section title="Filters" defaultOpen={false}>
        <label className="flex items-center justify-between text-xs cursor-pointer">
          <span className="text-zinc-200">Include remote / distant</span>
          <input
            type="checkbox"
            checked={s.filters.includeRemote}
            onChange={(e) => s.setFilter("includeRemote", e.currentTarget.checked)}
            className="accent-[#7e57ff]"
          />
        </label>
        <label className="flex items-center justify-between text-xs cursor-pointer">
          <span className="text-zinc-200">Include NG / unavailable</span>
          <input
            type="checkbox"
            checked={s.filters.includeUnavailable}
            onChange={(e) =>
              s.setFilter("includeUnavailable", e.currentTarget.checked)
            }
            className="accent-[#7e57ff]"
          />
        </label>
      </Section>
    </div>
  );
}
