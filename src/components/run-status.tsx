"use client";

import type { SolverState } from "@/hooks/use-solver";

type Props = {
  state: SolverState;
  totalIters: number;
};

export function RunStatus({ state, totalIters }: Props) {
  if (state.status === "idle") {
    return <span className="text-xs text-zinc-500">idle</span>;
  }
  if (state.status === "running") {
    const done = state.progress
      ? state.progress.restart * (totalIters / Math.max(1, totalIters)) +
        state.progress.iteration
      : 0;
    const pct = Math.min(100, (done / Math.max(1, totalIters)) * 100);
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 h-1 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-[#7e57ff] transition-[width] duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-mono tabular-nums text-zinc-400">
          {state.progress
            ? `best ${state.progress.best.toFixed(4)}`
            : "starting…"}
        </span>
      </div>
    );
  }
  if (state.status === "done" && state.result) {
    const dur = state.durationMs ? `${(state.durationMs / 1000).toFixed(1)}s` : "";
    return (
      <span className="text-xs font-mono tabular-nums text-zinc-300">
        score {state.result.finalScore.total.toFixed(4)} · {dur}
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="text-xs text-rose-400 truncate" title={state.error ?? ""}>
        error: {state.error}
      </span>
    );
  }
  return null;
}
