"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlatMember } from "@cli/flat-member";

type Props = {
  // The visible roster — search runs against members in groups + bench (the
  // dashboard ignores anyone not currently in view to avoid jumping to a row
  // that doesn't exist).
  candidates: FlatMember[];
  onSelect: (memberNo: number) => void;
  // Fires on every query change with the *full* set of matching .no values
  // (not capped at the 10-row dropdown limit). Empty set when the query is
  // empty. The shell uses this to live-highlight matches in GroupsView.
  onMatchesChange?: (matchedNos: Set<number>) => void;
};

export function HeaderSearch({
  candidates,
  onSelect,
  onMatchesChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute matches against the full candidate list once. The dropdown shows
  // a sliced top-10; the parent gets the *complete* match set so it can
  // highlight every match in the groups view, not just the visible ones.
  const allMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as FlatMember[];
    return candidates.filter((m) => {
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.name_romaji?.toLowerCase().includes(q)) return true;
      if (m.department.toLowerCase().includes(q)) return true;
      if (m.detailed_department?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [query, candidates]);

  const matches = useMemo(() => allMatches.slice(0, 10), [allMatches]);

  // Push the full match set up to the shell whenever it changes.
  useEffect(() => {
    if (!onMatchesChange) return;
    onMatchesChange(new Set(allMatches.map((m) => m.no)));
  }, [allMatches, onMatchesChange]);

  // Reset active row whenever the result set changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [matches]);

  // Cmd/Ctrl-K to focus the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  function pick(no: number) {
    onSelect(no);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[activeIdx];
      if (m) pick(m.no);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 focus-within:border-[#7e57ff]/60 rounded-md px-3 py-1.5 transition-colors">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Find a member… name, romaji, dept"
          className="bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 flex-1 outline-none"
          aria-label="Search members"
        />
        <kbd className="text-[9px] text-zinc-500 font-mono border border-zinc-800 rounded px-1 py-0.5">
          ⌘K
        </kbd>
      </div>

      {open && matches.length > 0 ? (
        <ul
          className="absolute top-full left-0 right-0 mt-1 z-30 bg-zinc-950 border border-zinc-800 rounded-md shadow-2xl overflow-hidden"
          role="listbox"
        >
          {matches.map((m, i) => (
            <li key={m.no}>
              <button
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(m.no)}
                className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left ${
                  i === activeIdx
                    ? "bg-[#7e57ff]/15 text-zinc-100"
                    : "hover:bg-zinc-900 text-zinc-300"
                }`}
              >
                <span className="text-[10px] font-mono text-zinc-500 w-8 tabular-nums">
                  #{m.no}
                </span>
                <span className="text-sm flex-1 truncate">{m.name}</span>
                {m.name_romaji ? (
                  <span className="text-[10px] text-zinc-500 truncate max-w-[40%]">
                    {m.name_romaji}
                  </span>
                ) : null}
                <span className="text-[10px] text-zinc-500 truncate max-w-[30%]">
                  {m.department}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : open && query.trim() ? (
        <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-xs text-zinc-500">
          No matches in current view.
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-zinc-500"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
