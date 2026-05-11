"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { FlatMember } from "@cli/flat-member";
import type { SolutionScore } from "@cli/grouping";
import type { ScoringContext } from "@cli/grouping/score";
import { scoreSolution } from "@cli/grouping/score";

// Lock value: numeric group index 0..N-1, or "bench". The reducer translates
// to the solver's bench sentinel (= groupCount) when running.
export type LockValue = number | "bench";
export type LocksState = Map<number, LockValue>;

// Where the visible result came from. `live` = current solver output (with
// optional manual edits on top). `history` = loaded a saved entry.
export type ResultMode =
  | { kind: "live" }
  | { kind: "history"; id: string; label: string | null; updatedAt: string };

export type ResultSnapshot = {
  groups: FlatMember[][];
  bench: FlatMember[];
  initialScore: SolutionScore;
  finalScore: SolutionScore;
  used: number;
  // Inputs needed to round-trip the result (recomputing scores client-side
  // after edits, or persisting to history).
  seed: number;
  groupCount: number;
  groupSize: number;
};

type State =
  | { kind: "empty"; locks: LocksState }
  | {
      kind: "loaded";
      mode: ResultMode;
      snapshot: ResultSnapshot;
      hasEdits: boolean;
      locks: LocksState;
    };

type Action =
  | { type: "set-from-solver"; snapshot: ResultSnapshot }
  | {
      type: "set-from-history";
      id: string;
      label: string | null;
      updatedAt: string;
      snapshot: ResultSnapshot;
    }
  | {
      type: "move-member";
      memberNo: number;
      toGroupIndex: number | "bench";
      ctx: ScoringContext;
    }
  | { type: "toggle-lock"; memberNo: number }
  | { type: "clear-locks" }
  | { type: "discard-edits" }
  | { type: "back-to-live" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set-from-solver": {
      // Live solver output replaces any non-edited live snapshot. If the user
      // has edits on the live view, we leave them in place — slider tweaks
      // don't blow away manual edits silently.
      if (
        state.kind === "loaded" &&
        state.mode.kind === "live" &&
        state.hasEdits
      ) {
        return state;
      }
      // Carry locks across solver runs (they describe user intent, not the
      // run output) but reconcile their target group indexes against the new
      // snapshot — if a member ended up in a different group than they were
      // locked to, the lock value still points at the original index because
      // the solver respected it.
      return {
        kind: "loaded",
        mode: { kind: "live" },
        snapshot: action.snapshot,
        hasEdits: false,
        locks: state.locks,
      };
    }
    case "set-from-history": {
      // Loading a history entry wipes locks — they're transient editing intent
      // tied to a particular live run.
      return {
        kind: "loaded",
        mode: {
          kind: "history",
          id: action.id,
          label: action.label,
          updatedAt: action.updatedAt,
        },
        snapshot: action.snapshot,
        hasEdits: false,
        locks: new Map(),
      };
    }
    case "move-member": {
      if (state.kind !== "loaded") return state;
      const moved = applyMove(
        state.snapshot,
        action.memberNo,
        action.toGroupIndex,
        action.ctx,
      );
      if (!moved) return state;
      // If the member is locked, update their lock to follow the manual move.
      // Otherwise leave locks alone.
      let nextLocks = state.locks;
      if (state.locks.has(action.memberNo)) {
        nextLocks = new Map(state.locks);
        nextLocks.set(action.memberNo, action.toGroupIndex);
      }
      return { ...state, snapshot: moved, hasEdits: true, locks: nextLocks };
    }
    case "toggle-lock": {
      if (state.kind !== "loaded") return state;
      const next = new Map(state.locks);
      if (next.has(action.memberNo)) {
        next.delete(action.memberNo);
      } else {
        // Lock to current location.
        const loc = locateMember(state.snapshot, action.memberNo);
        if (!loc) return state;
        next.set(action.memberNo, loc);
      }
      return { ...state, locks: next };
    }
    case "clear-locks": {
      if (state.locks.size === 0) return state;
      return state.kind === "loaded"
        ? { ...state, locks: new Map() }
        : { ...state, locks: new Map() };
    }
    case "discard-edits": {
      // Without retaining the pre-edit snapshot, discarding edits in live
      // mode is a no-op here — the next solver run will replace the snapshot.
      // We just drop the dirty flag so future solver runs are accepted.
      if (state.kind !== "loaded") return state;
      return { ...state, hasEdits: false };
    }
    case "back-to-live": {
      // Same: drop the loaded mode; the next solver run will repopulate.
      if (state.kind !== "loaded") return { kind: "empty", locks: state.locks };
      return { kind: "empty", locks: state.locks };
    }
  }
}

function locateMember(
  snapshot: ResultSnapshot,
  memberNo: number,
): LockValue | null {
  for (let gi = 0; gi < snapshot.groups.length; gi++) {
    if (snapshot.groups[gi]!.some((m) => m.no === memberNo)) return gi;
  }
  if (snapshot.bench.some((m) => m.no === memberNo)) return "bench";
  return null;
}

function applyMove(
  snapshot: ResultSnapshot,
  memberNo: number,
  toGroupIndex: number | "bench",
  ctx: ScoringContext,
): ResultSnapshot | null {
  const allLocations = [...snapshot.groups, snapshot.bench];
  let from: { listIdx: number; memberIdx: number; member: FlatMember } | null =
    null;
  for (let li = 0; li < allLocations.length; li++) {
    const list = allLocations[li]!;
    const idx = list.findIndex((m) => m.no === memberNo);
    if (idx >= 0) {
      from = { listIdx: li, memberIdx: idx, member: list[idx]! };
      break;
    }
  }
  if (!from) return null;

  const groups = snapshot.groups.map((g) => g.slice());
  const bench = snapshot.bench.slice();

  // Remove from source.
  if (from.listIdx === groups.length) {
    bench.splice(from.memberIdx, 1);
  } else {
    groups[from.listIdx]!.splice(from.memberIdx, 1);
  }

  // Insert at destination.
  if (toGroupIndex === "bench") {
    bench.push(from.member);
  } else {
    if (toGroupIndex < 0 || toGroupIndex >= groups.length) return null;
    groups[toGroupIndex]!.push(from.member);
  }

  const finalScore = scoreSolution(groups, ctx);
  // Used = members in any non-bench group.
  const used = groups.reduce((sum, g) => sum + g.length, 0);

  return {
    ...snapshot,
    groups,
    bench,
    used,
    finalScore,
  };
}

export function useResultState() {
  const [state, dispatch] = useReducer(
    reducer,
    { kind: "empty", locks: new Map() } as State,
  );

  const setFromSolver = useCallback((snapshot: ResultSnapshot) => {
    dispatch({ type: "set-from-solver", snapshot });
  }, []);

  const setFromHistory = useCallback(
    (
      id: string,
      label: string | null,
      updatedAt: string,
      snapshot: ResultSnapshot,
    ) => {
      dispatch({ type: "set-from-history", id, label, updatedAt, snapshot });
    },
    [],
  );

  const moveMember = useCallback(
    (
      memberNo: number,
      toGroupIndex: number | "bench",
      ctx: ScoringContext,
    ) => {
      dispatch({ type: "move-member", memberNo, toGroupIndex, ctx });
    },
    [],
  );

  const toggleLock = useCallback(
    (memberNo: number) => dispatch({ type: "toggle-lock", memberNo }),
    [],
  );
  const clearLocks = useCallback(() => dispatch({ type: "clear-locks" }), []);
  const discardEdits = useCallback(() => dispatch({ type: "discard-edits" }), []);
  const backToLive = useCallback(() => dispatch({ type: "back-to-live" }), []);

  const view = useMemo(() => {
    if (state.kind === "empty") return null;
    return {
      mode: state.mode,
      snapshot: state.snapshot,
      hasEdits: state.hasEdits,
    };
  }, [state]);

  return {
    view,
    locks: state.locks,
    setFromSolver,
    setFromHistory,
    moveMember,
    toggleLock,
    clearLocks,
    discardEdits,
    backToLive,
  };
}
