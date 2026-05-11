"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import type { FlatMember } from "@cli/flat-member";
import type { SolutionScore } from "@cli/grouping";
import type { LocksState } from "@/hooks/use-result-state";

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

const DRAG_MIME = "application/x-shuffle-lunch-member";

type DropTarget = number | "bench";

type Props = {
  groups: FlatMember[][];
  bench: FlatMember[];
  finalScore: SolutionScore | null;
  groupSize: number;
  locks: LocksState;
  // Member.no to scroll-into-view + flash. Caller bumps a generation token to
  // re-trigger the same member (so search-clearing-then-re-search works).
  highlight: { memberNo: number; gen: number } | null;
  // Live "search-as-you-type" highlight set. Every member whose .no is in this
  // set gets a soft amber ring; non-matching members dim to half-opacity so
  // the matches stand out across the page.
  liveMatches: Set<number>;
  // Move callback: index in [0..groups.length-1] to move into a group, or
  // "bench" to send to the bench. Members are identified by their .no.
  onMove: (memberNo: number, to: number | "bench") => void;
  onToggleLock: (memberNo: number) => void;
};

export function GroupsView({
  groups,
  bench,
  finalScore,
  groupSize,
  locks,
  highlight,
  liveMatches,
  onMove,
  onToggleLock,
}: Props) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [draggingNo, setDraggingNo] = useState<number | null>(null);
  const [flashingNo, setFlashingNo] = useState<number | null>(null);

  // When the parent bumps `highlight`, find the row by data-member-no, scroll
  // it into view, and flash a ring for ~1.5s. Looked up via document.query
  // rather than refs because group cards re-render frequently and stale refs
  // would point at unmounted nodes.
  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector<HTMLElement>(
      `[data-member-no="${highlight.memberNo}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashingNo(highlight.memberNo);
    const t = window.setTimeout(() => {
      setFlashingNo((cur) => (cur === highlight.memberNo ? null : cur));
    }, 1800);
    return () => window.clearTimeout(t);
  }, [highlight]);

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

  const handleDrop = (target: DropTarget) => (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    setDraggingNo(null);
    const data = e.dataTransfer.getData(DRAG_MIME);
    if (!data) return;
    const memberNo = Number(data);
    if (!Number.isInteger(memberNo)) return;
    onMove(memberNo, target);
  };

  const handleDragOver = (target: DropTarget) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== target) setDropTarget(target);
  };

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
      {groups.map((members, gi) => {
        const breakdown = finalScore?.groupBreakdowns[gi];
        const score = finalScore?.groupScores[gi] ?? 0;
        const overflowing = members.length > groupSize;
        const isDropTarget = dropTarget === gi;
        return (
          <div
            key={gi}
            onDragOver={handleDragOver(gi)}
            onDragLeave={() => {
              if (dropTarget === gi) setDropTarget(null);
            }}
            onDrop={handleDrop(gi)}
            className={`rounded-lg overflow-hidden transition-colors border ${
              isDropTarget
                ? "border-[#7e57ff] bg-[#7e57ff]/10"
                : overflowing
                  ? "border-amber-700/50 bg-amber-950/10"
                  : "border-zinc-800/60 bg-zinc-900/40"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/60">
              <div className="text-xs uppercase tracking-wider text-zinc-300">
                Group {gi + 1}
                <span
                  className={`ml-2 normal-case font-normal ${
                    overflowing ? "text-amber-300" : "text-zinc-500"
                  }`}
                  title={overflowing ? `Over capacity (${groupSize})` : undefined}
                >
                  ({members.length}
                  {overflowing ? `/${groupSize}` : ""})
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
                  isLocked={locks.has(m.no)}
                  onToggleLock={onToggleLock}
                  isDragging={draggingNo === m.no}
                  setDragging={setDraggingNo}
                  isFlashing={flashingNo === m.no}
                  liveMatch={liveMatches.has(m.no)}
                  searchActive={liveMatches.size > 0}
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
      <div
        onDragOver={handleDragOver("bench")}
        onDragLeave={() => {
          if (dropTarget === "bench") setDropTarget(null);
        }}
        onDrop={handleDrop("bench")}
        className={`rounded-lg overflow-hidden col-span-full border transition-colors ${
          dropTarget === "bench"
            ? "border-[#7e57ff] bg-[#7e57ff]/10"
            : "border-dashed border-zinc-800 bg-zinc-900/20"
        }`}
      >
        <div className="px-3 py-2 border-b border-zinc-800/60 text-xs uppercase tracking-wider text-zinc-400">
          Bench{" "}
          <span className="text-zinc-600 normal-case font-normal ml-1">
            ({bench.length})
          </span>
        </div>
        {bench.length === 0 ? (
          <div className="px-3 py-3 text-xs text-zinc-600">
            {dropTarget === "bench"
              ? "Drop here to bench"
              : "No benched members."}
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
                isLocked={locks.has(m.no)}
                onToggleLock={onToggleLock}
                isDragging={draggingNo === m.no}
                setDragging={setDraggingNo}
                isFlashing={flashingNo === m.no}
                liveMatch={liveMatches.has(m.no)}
                searchActive={liveMatches.size > 0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  currentGroupValue,
  groupOptions,
  onMove,
  isLocked,
  onToggleLock,
  isDragging,
  setDragging,
  isFlashing,
  liveMatch,
  searchActive,
}: {
  member: FlatMember;
  currentGroupValue: string;
  groupOptions: { value: string; label: string }[];
  onMove: (memberNo: number, to: number | "bench") => void;
  isLocked: boolean;
  onToggleLock: (memberNo: number) => void;
  isDragging: boolean;
  setDragging: (no: number | null) => void;
  isFlashing: boolean;
  liveMatch: boolean;
  searchActive: boolean;
}) {
  // Visual layering, brightest wins:
  //   1. Flash (just-selected from search): hard amber ring + pulse
  //   2. Live match (typing): softer amber ring
  //   3. Locked: purple ring
  //   4. Plain row
  // When search is active and this row is NOT a match, dim it so matches pop.
  const ringClass = isFlashing
    ? "ring-2 ring-[#fcd34d] bg-[#fcd34d]/15 animate-pulse"
    : liveMatch
      ? "ring-1 ring-[#fcd34d]/60 bg-[#fcd34d]/5"
      : isLocked
        ? "ring-1 ring-inset ring-[#7e57ff]/40 bg-[#7e57ff]/5"
        : "";
  const dim = searchActive && !liveMatch && !isFlashing;
  return (
    <li
      data-member-no={member.no}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, String(member.no));
        e.dataTransfer.effectAllowed = "move";
        setDragging(member.no);
      }}
      onDragEnd={() => setDragging(null)}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-all cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-30" : dim ? "opacity-25" : ""
      } ${ringClass}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(member.no);
        }}
        title={isLocked ? "Locked — click to unlock" : "Lock to this group"}
        aria-label={isLocked ? "Unlock member" : "Lock member"}
        className={`shrink-0 ${
          isLocked
            ? "text-[#a98aff]"
            : "text-zinc-700 hover:text-zinc-400"
        } transition-colors`}
      >
        {isLocked ? <LockClosedIcon /> : <LockOpenIcon />}
      </button>
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
        onClick={(e) => e.stopPropagation()}
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

function LockClosedIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function LockOpenIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </svg>
  );
}
