"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { SettingsPanel } from "./settings-panel";
import { GroupsView } from "./groups-view";
import { RunStatus } from "./run-status";
import { PreviewPanel } from "./preview-panel";
import { HistoryPanel } from "./history-panel";
import { MembersPanel } from "./members-panel";

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

  // Auto-run solver when not viewing a history entry. We pause auto-runs in
  // history mode so loaded edits aren't blown away by the slider re-runs.
  const inHistoryMode = result.view?.mode.kind === "history";

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
  }, [
    view,
    saveMutation,
    debounced,
    membersQuery.data,
  ]);

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
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-sm font-semibold tracking-wider uppercase text-zinc-100">
            shuffle-lunch
          </h1>
          <div className="text-[10px] text-zinc-500 leading-snug">
            score-based group solver · in-browser
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 ml-2">
          <Chip label="members" value={String(totalMembers)} />
          <Chip
            label="eligible"
            value={String(eligible.length)}
            tone={eligible.length < groupCount * groupSize ? "warn" : undefined}
          />
          <Chip label="groups" value={`${groupCount} × ${groupSize}`} />
        </div>

        <ModeBadge view={view} hasEdits={view?.hasEdits ?? false} />

        <div className="ml-auto flex items-center gap-3">
          <RunStatus state={solverState} totalIters={totalIters} />
          {solverState.status === "running" ? (
            <button
              type="button"
              onClick={cancel}
              className="text-xs bg-rose-900/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-200 rounded px-2 py-1"
            >
              cancel
            </button>
          ) : null}
          <SaveControls
            view={view}
            saving={saveMutation.isPending}
            error={saveMutation.error?.message ?? null}
            onSaveNew={onSaveNew}
            onSaveOverwrite={onSaveOverwrite}
            onBackToLive={result.backToLive}
          />
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded px-2 py-1"
          >
            sign out
          </button>
        </div>
      </header>

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
                onMove={onMove}
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
    <span className="text-[10px] uppercase tracking-wider text-[#a98aff] font-medium">
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
