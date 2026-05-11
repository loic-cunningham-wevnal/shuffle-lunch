"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { FlatMember } from "@cli/flat-member";
import type { SolutionScore } from "@cli/grouping";
import type { ScoringContext } from "@cli/grouping/score";
import { scoreSolution } from "@cli/grouping/score";

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
  | { kind: "empty" }
  | {
      kind: "loaded";
      mode: ResultMode;
      snapshot: ResultSnapshot;
      hasEdits: boolean;
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
      return {
        kind: "loaded",
        mode: { kind: "live" },
        snapshot: action.snapshot,
        hasEdits: false,
      };
    }
    case "set-from-history": {
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
      return { ...state, snapshot: moved, hasEdits: true };
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
      if (state.kind !== "loaded") return { kind: "empty" };
      return { kind: "empty" };
    }
  }
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
  const [state, dispatch] = useReducer(reducer, { kind: "empty" } as State);

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

  return { view, setFromSolver, setFromHistory, moveMember, discardEdits, backToLive };
}
