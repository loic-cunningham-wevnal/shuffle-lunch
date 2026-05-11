"use client";

import type { FlatMember } from "@cli/flat-member";
import type { SolutionScore } from "@cli/grouping";

const METRIC_LABELS: Record<string, string> = {
  genderBalance: "♀/♂",
  deptDiversity: "depts",
  eiBalance: "E/I",
  vibeDiversity: "vibe",
  mbtiDiversity: "mbti",
  ageProximity: "age",
  tenureMix: "tenure",
  confidenceFloor: "conf",
  recentPairPenalty: "pair",
};

type Props = {
  groups: FlatMember[][];
  bench: FlatMember[];
  finalScore: SolutionScore | null;
  // Move callback: index in [0..groups.length-1] to move into a group, or
  // "bench" to send to the bench. Members are identified by their .no.
  onMove: (memberNo: number, to: number | "bench") => void;
};

export function GroupsView({ groups, bench, finalScore, onMove }: Props) {
  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Adjust the sliders on the left — groups will appear here.
      </div>
    );
  }

  const groupOptions = groups.map((_, gi) => ({
    value: String(gi),
    label: `Group ${gi + 1}`,
  }));

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
      {groups.map((members, gi) => {
        const breakdown = finalScore?.groupBreakdowns[gi];
        const score = finalScore?.groupScores[gi] ?? 0;
        return (
          <div
            key={gi}
            className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/60">
              <div className="text-xs uppercase tracking-wider text-zinc-300">
                Group {gi + 1}
                <span className="ml-2 text-zinc-500 normal-case font-normal">
                  ({members.length})
                </span>
              </div>
              <div className="text-xs font-mono text-zinc-400 tabular-nums">
                {score.toFixed(3)}
              </div>
            </div>
            <ul className="divide-y divide-zinc-800/40">
              {members.map((m) => (
                <MemberRow
                  key={m.no}
                  member={m}
                  currentGroupValue={String(gi)}
                  groupOptions={groupOptions}
                  onMove={onMove}
                />
              ))}
            </ul>
            {breakdown ? (
              <div className="px-3 py-2 bg-zinc-950/60 border-t border-zinc-800/60 grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-mono tabular-nums text-zinc-500">
                {Object.entries(breakdown).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{METRIC_LABELS[k] ?? k}</span>
                    <span className="text-zinc-300">
                      {typeof v === "number" ? v.toFixed(2) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {bench.length > 0 || groups.length > 0 ? (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg overflow-hidden col-span-full">
          <div className="px-3 py-2 border-b border-zinc-800/60 text-xs uppercase tracking-wider text-zinc-400">
            Bench{" "}
            <span className="text-zinc-600 normal-case font-normal ml-1">
              ({bench.length})
            </span>
          </div>
          {bench.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-600">
              No benched members.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/40 max-h-48 overflow-y-auto">
              {bench.map((m) => (
                <MemberRow
                  key={m.no}
                  member={m}
                  currentGroupValue="bench"
                  groupOptions={groupOptions}
                  onMove={onMove}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MemberRow({
  member,
  currentGroupValue,
  groupOptions,
  onMove,
}: {
  member: FlatMember;
  currentGroupValue: string;
  groupOptions: { value: string; label: string }[];
  onMove: (memberNo: number, to: number | "bench") => void;
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm group">
      <span className="text-zinc-100 truncate flex-1 min-w-0">
        {member.name}
      </span>
      <span className="text-[10px] text-zinc-500 truncate flex-shrink-0 max-w-[40%]">
        {member.department}
      </span>
      <select
        value={currentGroupValue}
        onChange={(e) => {
          const v = e.currentTarget.value;
          onMove(member.no, v === "bench" ? "bench" : Number(v));
        }}
        className="ml-auto text-[10px] bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 cursor-pointer focus:outline-none focus:border-[#7e57ff]"
        aria-label={`Move ${member.name}`}
      >
        {groupOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="bench">Bench</option>
      </select>
    </li>
  );
}
