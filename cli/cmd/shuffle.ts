import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  text,
  confirm,
  select,
} from "@clack/prompts";
import cliProgress from "cli-progress";
import Table from "cli-table3";
import { filterEligible } from "../groups";
import { loadEnrichedMembers } from "./load";
import { parseShuffleArgs, type ShuffleArgs } from "./shuffle-args";
import {
  buildScoredGroups,
  buildScoredOutput,
  ScoredGroupsSchema,
} from "../grouping";
import {
  DEFAULT_PROFILE,
  METRIC_KEYS,
  type GroupingProfile,
} from "../grouping/profile-config";
import { listProfiles, loadProfile, saveProfile } from "../grouping/profile-store";
import { loadRecentPairs } from "../grouping/pair-history";
import { writeShuffleHistory, defaultHistoryPath } from "../excel-export";
import type { MetricBreakdown, SolutionScore } from "../grouping";
import type { FlatMember } from "../flat-member";

const DEFAULT_GROUP_SIZE = 5;

export async function runShuffle(rawArgs: string[]): Promise<void> {
  const args = parseShuffleArgs(rawArgs);
  intro("shuffle-lunch shuffle");

  const { members, unmatched, cachedEnrichmentCount } =
    await loadEnrichedMembers();
  const withNotion = members.filter(
    (m) => m.detailed_department || m.hobbies || m.comment || m.surprising_fact || m.hometown,
  ).length;
  log.info(
    `Loaded ${members.length} members | ${withNotion} with Notion | ${cachedEnrichmentCount} enriched`,
  );
  if (cachedEnrichmentCount === 0) {
    log.warn(
      "No enrichment cache found. Run `bun src/cli/index.ts enrich` first to use gender/MBTI/vibe in scoring.",
    );
  }
  if (unmatched.csvNames.length > 0 || unmatched.pageTitles.length > 0) {
    log.warn(
      `Notion entries with no matching member: csv=${unmatched.csvNames.length}, md=${unmatched.pageTitles.length} (skipped)`,
    );
  }

  const baseProfile = await pickProfile(args);
  const profile = applyOverrides(baseProfile, args);
  log.info(
    `Profile: ${baseProfile.name}${profile === baseProfile ? "" : " (with CLI overrides)"}`,
  );

  const filters = await pickFilters(profile, args);
  const eligible = filterEligible(members, filters);
  log.info(`${eligible.length} eligible after filtering`);

  const { groupCount, groupSize } = await pickGroupShape(eligible.length, args);

  const history = args.noHistory
    ? { pairs: new Map<string, number>(), maxSeen: 0 }
    : await loadRecentPairs(profile.history.lookbackRuns);
  if (!args.noHistory && history.maxSeen > 0) {
    log.info(`Pair history loaded: ${history.pairs.size} prior pairs (max ${history.maxSeen})`);
  }

  const totalIters = profile.solver.iterations * profile.solver.restarts;
  const bar = new cliProgress.SingleBar(
    {
      format:
        "[{bar}] {percentage}%  iter {value}/{total}  best={best}  current={current}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      forceRedraw: true,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(totalIters, 0, { best: "—", current: "—" });

  const result = await buildScoredGroups({
    profiles: eligible, // grouping API still uses opts.profiles as the field name (not renamed for stability)
    groupCount,
    groupSize,
    weights: profile.weights,
    solver: profile.solver,
    metricParams: profile.metricParams,
    history,
    seed: args.seed ?? undefined,
    onProgress: (info) => {
      const total = info.restart * profile.solver.iterations + info.iteration;
      bar.update(Math.min(total, totalIters), {
        best: info.best.toFixed(4),
        current: info.current.toFixed(4),
      });
    },
  });
  bar.update(totalIters, {
    best: result.finalScore.total.toFixed(4),
    current: result.finalScore.total.toFixed(4),
  });
  bar.stop();

  log.info(`Seed: ${result.seed}`);
  log.info(
    `Score: ${result.initialScore.total.toFixed(4)} → ${result.finalScore.total.toFixed(4)} (Δ ${((result.finalScore.total - result.initialScore.total) * 100).toFixed(2)} pts)`,
  );
  if (result.bench.length > 0) {
    log.info(
      `Optimized across full pool — ${result.bench.length} members benched (not in any final group)`,
    );
  }

  console.log();
  printScoreTable(result.initialScore, result.finalScore, profile.weights);
  console.log();
  printGroupSummary(result.groups, result.finalScore.groupBreakdowns);

  // Validate and emit JSON groups (each carries its own score + metric breakdown)
  const groupsForOutput = ScoredGroupsSchema.parse(
    buildScoredOutput(
      result.groups,
      result.finalScore.groupBreakdowns,
      result.finalScore.groupScores,
    ),
  );
  console.log();
  console.log(JSON.stringify(groupsForOutput, null, 2));

  if (!args.noHistory) {
    const runAt = new Date().toISOString();
    const outPath = args.out ?? defaultHistoryPath(runAt);
    await writeShuffleHistory(
      {
        runAt,
        profile,
        seed: result.seed,
        groupCount,
        groupSize,
        allMembers: members,
        groups: result.groups,
        bench: result.bench,
        initialScore: result.initialScore,
        finalScore: result.finalScore,
        used: result.used,
        filters,
      },
      outPath,
    );
    log.info(`History written: ${outPath}`);
  }

  if (args.saveAs) {
    const toSave: GroupingProfile = { ...profile, name: args.saveAs };
    await saveProfile(toSave);
    log.info(`Profile saved: data/grouping-profiles/${args.saveAs}.json`);
  }

  outro(`Generated ${result.groups.length} groups of ${groupSize}.`);
}

async function pickProfile(args: ShuffleArgs): Promise<GroupingProfile> {
  if (args.profile) return await loadProfile(args.profile);

  const available = await listProfiles();
  if (available.length === 0) return DEFAULT_PROFILE;

  const preferDefault = available.find((p) => p.name === "default");
  const ordered = preferDefault
    ? [preferDefault, ...available.filter((p) => p.name !== "default")]
    : available;

  const choice = await select({
    message: "Which grouping profile?",
    initialValue: ordered[0]!.name,
    options: ordered.map((p) => ({
      value: p.name,
      label: p.name,
      hint: p.description ?? undefined,
    })),
  });
  if (isCancel(choice)) bail();
  return ordered.find((p) => p.name === choice)!;
}

function applyOverrides(
  profile: GroupingProfile,
  args: ShuffleArgs,
): GroupingProfile {
  const hasOverrides =
    Object.keys(args.weightOverrides).length > 0 ||
    args.iterations !== null ||
    args.restarts !== null ||
    args.ageCurveExponent !== null;
  if (!hasOverrides) return profile;
  return {
    ...profile,
    weights: { ...profile.weights, ...args.weightOverrides },
    solver: {
      ...profile.solver,
      iterations: args.iterations ?? profile.solver.iterations,
      restarts: args.restarts ?? profile.solver.restarts,
    },
    metricParams: {
      ...profile.metricParams,
      ageCurveExponent:
        args.ageCurveExponent ?? profile.metricParams.ageCurveExponent,
    },
  };
}

async function pickFilters(
  profile: GroupingProfile,
  _args: ShuffleArgs,
): Promise<{ includeRemote: boolean; includeUnavailable: boolean }> {
  if (!process.stdin.isTTY) {
    log.info(
      `Non-TTY: using profile filters (remote=${profile.filters.includeRemote}, unavailable=${profile.filters.includeUnavailable})`,
    );
    return profile.filters;
  }
  const includeRemote = await confirm({
    message: "Include remote / distant members?",
    initialValue: profile.filters.includeRemote,
  });
  if (isCancel(includeRemote)) bail();
  const includeUnavailable = await confirm({
    message: "Include NG / unavailable members?",
    initialValue: profile.filters.includeUnavailable,
  });
  if (isCancel(includeUnavailable)) bail();
  return {
    includeRemote: includeRemote as boolean,
    includeUnavailable: includeUnavailable as boolean,
  };
}

async function pickGroupShape(
  eligibleCount: number,
  args: ShuffleArgs,
): Promise<{ groupCount: number; groupSize: number }> {
  let groupSize = args.size ?? null;
  if (groupSize === null) {
    const v = await text({
      message: "Group size?",
      initialValue: String(DEFAULT_GROUP_SIZE),
      validate: (s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 2)
          return "Group size must be an integer >= 2";
        if (n > eligibleCount) return `Cannot exceed ${eligibleCount}`;
        return undefined;
      },
    });
    if (isCancel(v)) bail();
    groupSize = Number(v);
  }
  const maxGroups = Math.floor(eligibleCount / groupSize);
  let groupCount = args.count ?? null;
  if (groupCount === null) {
    const v = await text({
      message: `Number of groups? (max ${maxGroups})`,
      initialValue: String(maxGroups),
      validate: (s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1) return "Enter a positive integer";
        if (n > maxGroups) return `Max is ${maxGroups} for size ${groupSize}`;
        return undefined;
      },
    });
    if (isCancel(v)) bail();
    groupCount = Number(v);
  }
  if (groupCount > maxGroups) {
    throw new Error(
      `Requested ${groupCount} groups of ${groupSize} but only ${maxGroups} fit in ${eligibleCount} eligible`,
    );
  }
  return { groupCount, groupSize };
}

function printScoreTable(
  initial: SolutionScore,
  final: SolutionScore,
  weights: Record<string, number>,
): void {
  const t = new Table({
    head: ["Metric", "Weight", "Initial avg", "Final avg", "Δ"],
    colAligns: ["left", "right", "right", "right", "right"],
  });
  for (const k of METRIC_KEYS) {
    const i = mean(initial.groupBreakdowns.map((b) => b[k]));
    const f = mean(final.groupBreakdowns.map((b) => b[k]));
    t.push([
      k,
      weights[k]?.toFixed(2) ?? "0",
      i.toFixed(3),
      f.toFixed(3),
      arrow(f - i),
    ]);
  }
  console.log(t.toString());
}

function printGroupSummary(groups: FlatMember[][], breakdowns: MetricBreakdown[]): void {
  const t = new Table({
    head: ["Group", "N", "Depts", "♀", "♂", "Vibes", "MBTI Es", "MBTI Is", "Score"],
    colAligns: ["right", "right", "right", "right", "right", "right", "right", "right", "right"],
  });
  groups.forEach((g, i) => {
    const breakdown = breakdowns[i]!;
    const depts = new Set(g.map((p) => p.department)).size;
    const fem = g.filter((p) => p.gender === "female").length;
    const male = g.filter((p) => p.gender === "male").length;
    const vibes = new Set(g.map((p) => p.vibe).filter(Boolean)).size;
    let e = 0, ii = 0;
    for (const p of g) {
      const m = p.mbti;
      if (!m || m === "Unknown") continue;
      if (m[0] === "E") e++;
      else if (m[0] === "I") ii++;
    }
    const score =
      Object.values(breakdown).reduce((sum, v) => sum + v, 0) /
      Object.keys(breakdown).length;
    t.push([
      i + 1,
      g.length,
      depts,
      fem,
      male,
      vibes,
      e,
      ii,
      score.toFixed(3),
    ]);
  });
  console.log(t.toString());
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function arrow(delta: number): string {
  if (Math.abs(delta) < 0.001) return "·";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}

function bail(): never {
  cancel("Cancelled.");
  process.exit(0);
}
