"use client";

import { useMemo, useState } from "react";
import { shuffleHistoryToBuffer } from "@cli/excel-builder";
import type { ShuffleHistoryPayload } from "@cli/excel-builder";
import type { ResultSnapshot } from "@/hooks/use-result-state";
import type { GroupingProfile } from "@cli/grouping/profile-config";
import type { FlatMember } from "@cli/flat-member";
import { FLAT_MEMBER_COLUMNS } from "@cli/flat-member";

const METRIC_KEYS = [
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

type Props = {
  snapshot: ResultSnapshot | null;
  allMembers: FlatMember[];
  seedNumber: number;
  profile: GroupingProfile;
  filters: { includeRemote: boolean; includeUnavailable: boolean };
};

type PreviewTab = "groups" | "all-members" | "settings";

export function PreviewPanel(props: Props) {
  const [tab, setTab] = useState<PreviewTab>("groups");
  const [busy, setBusy] = useState<"download" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const payload = useMemo<ShuffleHistoryPayload | null>(() => {
    if (!props.snapshot) return null;
    return {
      runAt: new Date().toISOString(),
      profile: props.profile,
      seed: props.snapshot.seed,
      groupCount: props.snapshot.groupCount,
      groupSize: props.snapshot.groupSize,
      allMembers: props.allMembers,
      groups: props.snapshot.groups,
      bench: props.snapshot.bench,
      initialScore: props.snapshot.initialScore,
      finalScore: props.snapshot.finalScore,
      used: props.snapshot.used,
      filters: props.filters,
    };
  }, [props]);

  const onDownload = async () => {
    if (!payload) return;
    setBusy("download");
    try {
      const buf = await shuffleHistoryToBuffer(payload);
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const filename = `shuffle-lunch-${payload.runAt.replace(/[:.]/g, "-")}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback(`Downloaded ${filename}`);
    } catch (e) {
      setFeedback(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  if (!payload) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Run the solver first — the preview will appear once groups are scored.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-1 text-xs">
          <PreviewTabButton active={tab === "groups"} onClick={() => setTab("groups")}>
            Groups
          </PreviewTabButton>
          <PreviewTabButton
            active={tab === "all-members"}
            onClick={() => setTab("all-members")}
          >
            All Members
          </PreviewTabButton>
          <PreviewTabButton
            active={tab === "settings"}
            onClick={() => setTab("settings")}
          >
            Settings
          </PreviewTabButton>
        </div>
        <div className="flex items-center gap-2">
          {feedback ? (
            <span className="text-[11px] text-zinc-400">{feedback}</span>
          ) : null}
          <button
            type="button"
            onClick={onDownload}
            disabled={busy !== null}
            className="text-xs bg-[#7e57ff] hover:bg-[#8e66ff] text-white rounded px-2.5 py-1.5 disabled:opacity-50 font-medium"
          >
            {busy === "download" ? "Building…" : "Download .xlsx"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border border-zinc-800/60 rounded-lg bg-zinc-950/50">
        {tab === "groups" ? <GroupsTable payload={payload} /> : null}
        {tab === "all-members" ? <AllMembersTable payload={payload} /> : null}
        {tab === "settings" ? <SettingsTable payload={payload} /> : null}
      </div>
    </div>
  );
}

function PreviewTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
      }`}
    >
      {children}
    </button>
  );
}

function GroupsTable({ payload }: { payload: ShuffleHistoryPayload }) {
  const headers = [
    "group_no",
    ...FLAT_MEMBER_COLUMNS,
    "group_score",
    ...METRIC_KEYS.map((k) => `g_${k}`),
  ];
  return (
    <SheetTable headers={headers}>
      {payload.groups.flatMap((members, gi) => {
        const breakdown = payload.finalScore.groupBreakdowns[gi];
        const score = payload.finalScore.groupScores[gi] ?? 0;
        return members.map((m) => (
          <tr key={`${gi}-${m.no}`} className="even:bg-zinc-900/30">
            <Cell>{gi + 1}</Cell>
            {FLAT_MEMBER_COLUMNS.map((col) => (
              <Cell key={col}>{cellText(m[col])}</Cell>
            ))}
            <Cell mono>{score.toFixed(4)}</Cell>
            {METRIC_KEYS.map((k) => (
              <Cell key={k} mono>
                {breakdown ? breakdown[k].toFixed(3) : "—"}
              </Cell>
            ))}
          </tr>
        ));
      })}
    </SheetTable>
  );
}

function AllMembersTable({ payload }: { payload: ShuffleHistoryPayload }) {
  const assigned = new Map<number, number>();
  payload.groups.forEach((members, gi) => {
    for (const m of members) assigned.set(m.no, gi + 1);
  });
  const headers = [...FLAT_MEMBER_COLUMNS, "assigned_group"];
  return (
    <SheetTable headers={headers}>
      {payload.allMembers.map((m) => (
        <tr key={m.no} className="even:bg-zinc-900/30">
          {FLAT_MEMBER_COLUMNS.map((col) => (
            <Cell key={col}>{cellText(m[col])}</Cell>
          ))}
          <Cell mono>{assigned.get(m.no) ?? ""}</Cell>
        </tr>
      ))}
    </SheetTable>
  );
}

function SettingsTable({ payload }: { payload: ShuffleHistoryPayload }) {
  const profile = payload.profile;
  const benched = payload.bench.length;
  const eligibleCount = payload.used + benched;
  const rows: Array<[string, unknown]> = [
    ["runAt", payload.runAt],
    ["profile", profile.name],
    ["seed", payload.seed],
    ["groupCount", payload.groupCount],
    ["groupSize", payload.groupSize],
    ["eligibleCount", eligibleCount],
    ["usedCount", payload.used],
    ["benchedCount", benched],
    ["totalScore", payload.finalScore.total],
    ["initialScore", payload.initialScore.total],
    ...METRIC_KEYS.map(
      (k) => [`weight.${k}`, profile.weights[k]] as [string, unknown],
    ),
    ["solver.iterations", profile.solver.iterations],
    ["solver.restarts", profile.solver.restarts],
    ["solver.initialTemp", profile.solver.initialTemp],
    ["solver.endTemp", profile.solver.endTemp],
    ["solver.threeCycleProbability", profile.solver.threeCycleProbability],
    ["ageCurveExponent", profile.metricParams.ageCurveExponent],
    ["historyLookbackRuns", profile.history.lookbackRuns],
    ["includeRemote", payload.filters.includeRemote],
    ["includeUnavailable", payload.filters.includeUnavailable],
  ];
  return (
    <SheetTable headers={["key", "value"]}>
      {rows.map(([k, v]) => (
        <tr key={k} className="even:bg-zinc-900/30">
          <Cell>{k}</Cell>
          <Cell mono>{cellText(v)}</Cell>
        </tr>
      ))}
    </SheetTable>
  );
}

function SheetTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="text-xs w-full border-collapse">
      <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              className="text-left px-2 py-1.5 font-mono font-medium text-zinc-300 whitespace-nowrap border-r border-zinc-800/60 last:border-r-0"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  mono = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-2 py-1 border-r border-zinc-800/40 last:border-r-0 align-top whitespace-nowrap ${
        mono ? "font-mono tabular-nums text-zinc-300" : "text-zinc-200"
      }`}
    >
      {children}
    </td>
  );
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return String(v);
}

