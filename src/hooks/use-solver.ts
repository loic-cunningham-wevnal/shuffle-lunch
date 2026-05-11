"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BuildScoredGroupsOptions, BuildScoredGroupsResult } from "@cli/grouping";
import type {
  SolverRequest,
  SolverResponse,
} from "@/workers/solver.worker";

export type SolverState = {
  status: "idle" | "running" | "done" | "error";
  progress: { restart: number; iteration: number; best: number; current: number } | null;
  result: BuildScoredGroupsResult | null;
  error: string | null;
  durationMs: number | null;
};

const INITIAL: SolverState = {
  status: "idle",
  progress: null,
  result: null,
  error: null,
  durationMs: null,
};

export function useSolver() {
  const workerRef = useRef<Worker | null>(null);
  const startedAtRef = useRef<number>(0);
  const [state, setState] = useState<SolverState>(INITIAL);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = useCallback(
    (payload: Omit<BuildScoredGroupsOptions, "onProgress">) => {
      // Cancel any in-flight job by terminating and re-spawning.
      workerRef.current?.terminate();
      const worker = new Worker(
        new URL("../workers/solver.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      startedAtRef.current = performance.now();
      setState({
        status: "running",
        progress: null,
        result: null,
        error: null,
        durationMs: null,
      });

      worker.addEventListener("message", (e: MessageEvent<SolverResponse>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setState((s) => ({
            ...s,
            progress: {
              restart: msg.restart,
              iteration: msg.iteration,
              best: msg.best,
              current: msg.current,
            },
          }));
        } else if (msg.type === "done") {
          setState({
            status: "done",
            progress: null,
            result: msg.result,
            error: null,
            durationMs: performance.now() - startedAtRef.current,
          });
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        } else if (msg.type === "error") {
          setState({
            status: "error",
            progress: null,
            result: null,
            error: msg.message,
            durationMs: performance.now() - startedAtRef.current,
          });
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      });

      const req: SolverRequest = { type: "run", payload };
      worker.postMessage(req);
    },
    [],
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState((s) =>
      s.status === "running"
        ? { ...s, status: "idle", progress: null }
        : s,
    );
  }, []);

  return { state, run, cancel };
}
