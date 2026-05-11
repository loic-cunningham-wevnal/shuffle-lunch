/// <reference lib="webworker" />
import { buildScoredGroups, type BuildScoredGroupsOptions } from "@cli/grouping";
import type { BuildScoredGroupsResult } from "@cli/grouping";

export type SolverRequest = {
  type: "run";
  // `locks` (the Map of memberNo → groupIndex/bench-sentinel) survives the
  // postMessage boundary unchanged — structured clone supports Map natively.
  payload: Omit<BuildScoredGroupsOptions, "onProgress">;
};

export type SolverProgress = {
  type: "progress";
  restart: number;
  iteration: number;
  best: number;
  current: number;
};

export type SolverDone = {
  type: "done";
  result: BuildScoredGroupsResult;
};

export type SolverError = {
  type: "error";
  message: string;
};

export type SolverResponse = SolverProgress | SolverDone | SolverError;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (e: MessageEvent<SolverRequest>) => {
  const msg = e.data;
  if (msg.type !== "run") return;

  let lastPostedAt = 0;
  try {
    const result = await buildScoredGroups({
      ...msg.payload,
      onProgress: (info) => {
        // Throttle progress posts to ~30 Hz to avoid drowning the main thread.
        const now = performance.now();
        if (now - lastPostedAt < 33) return;
        lastPostedAt = now;
        const progress: SolverProgress = { type: "progress", ...info };
        ctx.postMessage(progress);
      },
    });
    const done: SolverDone = { type: "done", result };
    ctx.postMessage(done);
  } catch (err) {
    const out: SolverError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(out);
  }
});
