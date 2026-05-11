"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/client";
import { useSettings, settingsToProfile } from "@/lib/settings-store";
import { useDebounced } from "@/hooks/use-debounced";
import { useSolver } from "@/hooks/use-solver";
import { useResultState, type ResultSnapshot } from "@/hooks/use-result-state";
import { hashSeedString } from "@/lib/seed";
import { filterEligible } from "@cli/groups";
import type { ScoringContext } from "@cli/grouping/score";
import type { HistoryEntry } from "@cli/history";
import { shuffleHistoryToBuffer } from "@cli/excel-builder";
import { importGroupsFromXlsx } from "@/lib/import-xlsx";
import { SettingsPanel } from "./settings-panel";
import { GroupsView } from "./groups-view";
import { RunStatus } from "./run-status";
import { PreviewPanel } from "./preview-panel";
import { HistoryPanel } from "./history-panel";
import { MembersPanel } from "./members-panel";
import { HeaderSearch } from "./header-search";

type Tab = "groups" | "preview" | "history" | "members";

export function ShuffleApp() {
  // Hydrate after client mount to avoid SSR/zustand-persist mismatch.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const settings = useSettings();
  const debounced = useDebounced(settings, 400);

  const utils = trpc.useUtils();
  const membersQuery = trpc.members.list.useQuery();
  const pairHistoryQuery = trpc.pairHistory.recent.useQuery(
    { lookbackRuns: debounced.historyLookbackRuns },
    { enabled: hydrated },
  );

  const eligible = useMemo(() => {
    if (!membersQuery.data) return [];
    return filterEligible(membersQuery.data.members, debounced.filters);
  }, [membersQuery.data, debounced.filters]);

  const groupSize = debounced.groupSize;
  const maxGroups = Math.max(1, Math.floor(eligible.length / groupSize));
  const groupCount =
    debounced.groupCount === 0
      ? maxGroups
      : Math.min(debounced.groupCount, maxGroups);

  const seedNumber = useMemo(
    () => hashSeedString(debounced.seedString),
    [debounced.seedString],
  );

  const { state: solverState, run, cancel } = useSolver();
  const result = useResultState();

  // Auto-run solver when not viewing a history/imported entry. We pause
  // auto-runs in non-live modes so a loaded snapshot isn't overwritten.
  const inHistoryMode = result.view?.mode.kind === "history";

  const solverLocks = useMemo(() => {
    const out = new Map<number, number>();
    for (const [no, target] of result.locks) {
      out.set(no, target === "bench" ? groupCount : target);
    }
    return out;
  }, [result.locks, groupCount]);

  useEffect(() => {
    if (!hydrated) return;
    if (inHistoryMode) return;
    if (!membersQuery.data || !pairHistoryQuery.data) return;
    if (eligible.length < groupCount * groupSize) return;
    run({
      profiles: eligible,
      groupCount,
      groupSize,
      weights: debounced.weights,
      solver: debounced.solver,
      metricParams: debounced.metricParams,
      history: pairHistoryQuery.data,
      seed: seedNumber,
      locks: solverLocks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    inHistoryMode,
    membersQuery.data,
    pairHistoryQuery.data,
    eligible,
    groupCount,
    groupSize,
    seedNumber,
    debounced.weights,
    debounced.solver,
    debounced.metricParams,
    solverLocks,
  ]);

  // Push solver result into the editable state.
  useEffect(() => {
    if (solverState.status !== "done" || !solverState.result) return;
    const r = solverState.result;
    const snapshot: ResultSnapshot = {
      groups: r.groups,
      bench: r.bench,
      initialScore: r.initialScore,
      finalScore: r.finalScore,
      used: r.used,
      seed: r.seed,
      groupCount,
      groupSize,
    };
    result.setFromSolver(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solverState.status, solverState.result]);

  const scoringCtx: ScoringContext = useMemo(
    () => ({
      weights: debounced.weights,
      metricParams: debounced.metricParams,
      history: pairHistoryQuery.data ?? { pairs: new Map(), maxSeen: 0 },
    }),
    [debounced.weights, debounced.metricParams, pairHistoryQuery.data],
  );

  const onMove = useCallback(
    (memberNo: number, to: number | "bench") => {
      result.moveMember(memberNo, to, scoringCtx);
    },
    [result, scoringCtx],
  );

  // Load a history entry into the editor.
  const loadEntry = useCallback(
    async (id: string) => {
      const entry: HistoryEntry = await utils.history.get.fetch({ id });
      result.setFromHistory(entry.id, entry.label, entry.updatedAt, {
        groups: entry.groups,
        bench: entry.bench,
        initialScore: entry.initialScore,
        finalScore: entry.finalScore,
        used: entry.used,
        seed: entry.seed,
        groupCount: entry.groupCount,
        groupSize: entry.groupSize,
      });
      setTab("groups");
    },
    [utils, result],
  );

  // Save mutation: persists current snapshot as new entry or updates loaded.
  const saveMutation = trpc.history.save.useMutation({
    onSuccess: () => {
      void utils.history.list.invalidate();
    },
  });

  const view = result.view;
  const onSaveNew = useCallback(async () => {
    if (!view) return;
    const runAt = new Date().toISOString();
    await saveMutation.mutateAsync({
      label: null,
      entry: buildHistoryPayload({
        snapshot: view.snapshot,
        runAt,
        profile: settingsToProfile(debounced),
        filters: debounced.filters,
        allMembers: membersQuery.data?.members ?? [],
      }),
    });
  }, [view, saveMutation, debounced, membersQuery.data]);

  const onSaveOverwrite = useCallback(async () => {
    if (!view || view.mode.kind !== "history") return;
    await saveMutation.mutateAsync({
      id: view.mode.id,
      label: view.mode.label,
      entry: buildHistoryPayload({
        snapshot: view.snapshot,
        runAt: view.snapshot.seed
          ? new Date(view.mode.updatedAt).toISOString()
          : new Date().toISOString(),
        profile: settingsToProfile(debounced),
        filters: debounced.filters,
        allMembers: membersQuery.data?.members ?? [],
      }),
    });
  }, [view, saveMutation, debounced, membersQuery.data]);

  // ----- Top toolbar: download / import / clear -----
  const [toolbarStatus, setToolbarStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const flashStatus = (msg: string) => {
    setToolbarStatus(msg);
    window.setTimeout(() => {
      setToolbarStatus((cur) => (cur === msg ? null : cur));
    }, 4000);
  };

  const onDownload = useCallback(async () => {
    if (!view) return;
    const payload = {
      runAt: new Date().toISOString(),
      profile: settingsToProfile(debounced),
      seed: view.snapshot.seed,
      groupCount: view.snapshot.groupCount,
      groupSize: view.snapshot.groupSize,
      allMembers: membersQuery.data?.members ?? [],
      groups: view.snapshot.groups,
      bench: view.snapshot.bench,
      initialScore: view.snapshot.initialScore,
      finalScore: view.snapshot.finalScore,
      used: view.snapshot.used,
      filters: debounced.filters,
    };
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
      flashStatus(`Downloaded ${filename}`);
    } catch (e) {
      flashStatus(
        `Download failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [view, debounced, membersQuery.data]);

  const onImportFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const { snapshot, warnings } = await importGroupsFromXlsx(
          buffer,
          membersQuery.data?.members ?? [],
          scoringCtx,
          seedNumber,
        );
        result.setFromImport(snapshot, file.name);
        setTab("groups");
        const w = warnings.length ? ` (${warnings.length} warnings)` : "";
        flashStatus(
          `Imported ${snapshot.groups.length} groups, ${snapshot.bench.length} benched${w}`,
        );
      } catch (e) {
        flashStatus(
          `Import failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [membersQuery.data, scoringCtx, seedNumber, result],
  );

  const onClearChanges = useCallback(() => {
    const confirmMsg = view?.hasEdits
      ? "Discard your unsaved edits and locks?"
      : "Clear the current saved snapshot from this browser?";
    if (!window.confirm(confirmMsg)) return;
    result.resetAll();
    flashStatus("Cleared.");
  }, [view, result]);

  // ----- Search → highlight -----
  // `liveMatches` = the full set of members matching the current query string
  // (updates as the user types). `highlight` = a one-off selection that scrolls
  // into view + flashes brighter than the live ring.
  const [liveMatches, setLiveMatches] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<
    { memberNo: number; gen: number } | null
  >(null);
  const highlightGenRef = useRef(0);

  const onSearchMatchesChange = useCallback((nos: Set<number>) => {
    setLiveMatches(nos);
    // Auto-switch to Groups tab as soon as the user starts typing — search
    // is meaningless on Members / Excel preview / History tabs.
    if (nos.size > 0) setTab("groups");
  }, []);

  const onSearchSelect = useCallback(
    (memberNo: number) => {
      setTab("groups");
      highlightGenRef.current += 1;
      setHighlight({ memberNo, gen: highlightGenRef.current });
    },
    [],
  );

  const searchCandidates = useMemo(() => {
    if (!view) return [];
    return [...view.snapshot.groups.flat(), ...view.snapshot.bench];
  }, [view]);

  const totalIters = debounced.solver.iterations * debounced.solver.restarts;
  const totalMembers = membersQuery.data?.members.length ?? 0;

  const [tab, setTab] = useState<Tab>("groups");
  const router = useRouter();
  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const visibleSnapshot = view?.snapshot ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* TOP BAR — brand, chips, centered search, action buttons. Always
          visible regardless of which tab is active. */}
      <header className="border-b border-zinc-800 px-4 py-2.5 flex items-center gap-4">
        <div className="shrink-0">
          <h1 className="text-sm font-semibold tracking-wider uppercase text-zinc-100 leading-none">
            shuffle-lunch
          </h1>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            score-based group solver · in-browser
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-400">
          <Chip label="members" value={String(totalMembers)} />
          <Chip
            label="eligible"
            value={String(eligible.length)}
            tone={eligible.length < groupCount * groupSize ? "warn" : undefined}
          />
          <Chip label="groups" value={`${groupCount} × ${groupSize}`} />
          {result.locks.size > 0 ? (
            <button
              type="button"
              onClick={result.clearLocks}
              title="Clear all locks"
              className="flex items-baseline gap-1.5 px-2 py-0.5 rounded border border-[#7e57ff]/50 bg-[#7e57ff]/10 text-[#a98aff] hover:bg-[#7e57ff]/20"
            >
              <span className="text-[10px] uppercase tracking-wider">
                locked
              </span>
              <span className="text-xs font-mono tabular-nums">
                {result.locks.size}
              </span>
              <span className="text-[10px] opacity-70 ml-0.5">clear</span>
            </button>
          ) : null}
        </div>

        {/* Centered search — flex-1 to take all remaining space, justify-center
            inside to center the input within it. */}
        <div className="flex-1 flex justify-center min-w-0">
          <HeaderSearch
            candidates={searchCandidates}
            onSelect={onSearchSelect}
            onMatchesChange={onSearchMatchesChange}
          />
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <ToolbarButton
            onClick={onDownload}
            disabled={!view}
            title="Download current state as .xlsx"
          >
            <DownloadIcon />
            <span className="hidden lg:inline">Download</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => importInputRef.current?.click()}
            title="Import a starting state from an .xlsx file"
          >
            <UploadIcon />
            <span className="hidden lg:inline">Import</span>
          </ToolbarButton>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (f) void onImportFile(f);
            }}
          />
          <ToolbarButton
            onClick={onClearChanges}
            tone="danger"
            title="Discard local edits and persisted state"
          >
            <TrashIcon />
            <span className="hidden lg:inline">Clear</span>
          </ToolbarButton>
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded px-2 py-1.5 ml-1"
          >
            sign out
          </button>
        </div>
      </header>

      {/* SECONDARY BAR — solver status, mode/save controls, toolbar feedback. */}
      <div className="border-b border-zinc-800 px-4 py-1.5 flex items-center gap-3 bg-zinc-950/60">
        <ModeBadge view={view} hasEdits={view?.hasEdits ?? false} />
        <RunStatus state={solverState} totalIters={totalIters} />
        {solverState.status === "running" ? (
          <button
            type="button"
            onClick={cancel}
            className="text-xs bg-rose-900/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-200 rounded px-2 py-0.5"
          >
            cancel
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {toolbarStatus ? (
            <span className="text-[11px] text-zinc-400">{toolbarStatus}</span>
          ) : null}
          <SaveControls
            view={view}
            saving={saveMutation.isPending}
            error={saveMutation.error?.message ?? null}
            onSaveNew={onSaveNew}
            onSaveOverwrite={onSaveOverwrite}
            onBackToLive={result.backToLive}
          />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <aside className="w-80 shrink-0 border-r border-zinc-800 overflow-y-auto p-3">
          <SettingsPanel eligibleCount={eligible.length} />
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <nav className="flex items-center gap-1 border-b border-zinc-800 px-3">
            <TabButton active={tab === "groups"} onClick={() => setTab("groups")}>
              Groups
            </TabButton>
            <TabButton
              active={tab === "preview"}
              onClick={() => setTab("preview")}
            >
              Excel preview
            </TabButton>
            <TabButton
              active={tab === "history"}
              onClick={() => setTab("history")}
            >
              History
            </TabButton>
            <TabButton
              active={tab === "members"}
              onClick={() => setTab("members")}
            >
              Members
            </TabButton>
          </nav>
          <div className="flex-1 overflow-auto p-4 min-h-0">
            {tab === "groups" ? (
              <GroupsView
                groups={visibleSnapshot?.groups ?? []}
                bench={visibleSnapshot?.bench ?? []}
                finalScore={visibleSnapshot?.finalScore ?? null}
                groupSize={groupSize}
                locks={result.locks}
                highlight={highlight}
                liveMatches={liveMatches}
                onMove={onMove}
                onToggleLock={result.toggleLock}
              />
            ) : tab === "preview" ? (
              <PreviewPanel
                snapshot={visibleSnapshot}
                allMembers={membersQuery.data?.members ?? []}
                seedNumber={seedNumber}
                profile={settingsToProfile(debounced)}
                filters={debounced.filters}
              />
            ) : tab === "history" ? (
              <HistoryPanel
                onLoad={loadEntry}
                loadedId={
                  view?.mode.kind === "history" ? view.mode.id : null
                }
              />
            ) : (
              <MembersPanel />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function buildHistoryPayload(args: {
  snapshot: ResultSnapshot;
  runAt: string;
  profile: ReturnType<typeof settingsToProfile>;
  filters: { includeRemote: boolean; includeUnavailable: boolean };
  allMembers: import("@cli/flat-member").FlatMember[];
}): Omit<HistoryEntry, "id" | "updatedAt" | "label"> {
  const { snapshot, runAt, profile, filters, allMembers } = args;
  return {
    runAt,
    profile,
    seed: snapshot.seed,
    groupCount: snapshot.groupCount,
    groupSize: snapshot.groupSize,
    filters,
    allMembers,
    groups: snapshot.groups,
    bench: snapshot.bench,
    initialScore: snapshot.initialScore,
    finalScore: snapshot.finalScore,
    used: snapshot.used,
  };
}

function ModeBadge({
  view,
  hasEdits,
}: {
  view: ReturnType<typeof useResultState>["view"];
  hasEdits: boolean;
}) {
  if (!view) return null;
  if (view.mode.kind === "live") {
    return (
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        live{hasEdits ? " · edited" : ""}
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider text-[#a98aff] font-medium truncate max-w-[40ch]">
      editing · {view.mode.label || view.mode.id}
      {hasEdits ? " · unsaved" : ""}
    </span>
  );
}

function SaveControls({
  view,
  saving,
  error,
  onSaveNew,
  onSaveOverwrite,
  onBackToLive,
}: {
  view: ReturnType<typeof useResultState>["view"];
  saving: boolean;
  error: string | null;
  onSaveNew: () => void;
  onSaveOverwrite: () => void;
  onBackToLive: () => void;
}) {
  if (!view) return null;
  if (view.mode.kind === "live") {
    return (
      <>
        {error ? (
          <span className="text-[10px] text-rose-400" title={error}>
            save failed
          </span>
        ) : null}
        <button
          type="button"
          onClick={onSaveNew}
          disabled={saving}
          className="text-xs bg-[#7e57ff] hover:bg-[#8e66ff] disabled:opacity-50 text-white rounded px-2.5 py-1"
        >
          {saving ? "Saving…" : "Save to history"}
        </button>
      </>
    );
  }
  return (
    <>
      {error ? (
        <span className="text-[10px] text-rose-400" title={error}>
          save failed
        </span>
      ) : null}
      <button
        type="button"
        onClick={onBackToLive}
        className="text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-700 rounded px-2 py-1"
      >
        back to live
      </button>
      <button
        type="button"
        onClick={onSaveNew}
        disabled={saving}
        className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded px-2.5 py-1 disabled:opacity-50"
      >
        Save as new
      </button>
      <button
        type="button"
        onClick={onSaveOverwrite}
        disabled={saving}
        className="text-xs bg-[#7e57ff] hover:bg-[#8e66ff] disabled:opacity-50 text-white rounded px-2.5 py-1"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  tone,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  const base =
    "text-xs flex items-center gap-1.5 rounded px-2.5 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const palette =
    tone === "danger"
      ? "border-zinc-800 hover:border-rose-800/60 text-zinc-300 hover:text-rose-300 hover:bg-rose-950/30"
      : "border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${palette}`}
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div
      className={`flex items-baseline gap-1.5 px-2 py-0.5 rounded border ${
        tone === "warn"
          ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
          : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className="text-xs font-mono tabular-nums">{value}</span>
    </div>
  );
}

function TabButton({
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
      className={`text-xs px-3 py-2 border-b -mb-px ${
        active
          ? "border-[#7e57ff] text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
