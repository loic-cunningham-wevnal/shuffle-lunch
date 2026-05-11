"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";

type Props = {
  onLoad: (id: string) => void;
  loadedId: string | null;
};

export function HistoryPanel({ onLoad, loadedId }: Props) {
  const utils = trpc.useUtils();
  const listQuery = trpc.history.list.useQuery();
  const deleteMutation = trpc.history.delete.useMutation({
    onSuccess: () => {
      void utils.history.list.invalidate();
    },
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading history…
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full text-rose-400 text-sm">
        {listQuery.error.message}
      </div>
    );
  }

  const entries = listQuery.data ?? [];
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm text-center max-w-md mx-auto">
        No saved history yet. Run the solver, click{" "}
        <span className="text-zinc-300">Save to history</span>, and your past
        runs will appear here for editing.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-3xl mx-auto">
      {entries.map((e) => {
        const isLoaded = loadedId === e.id;
        return (
          <div
            key={e.id}
            className={`flex items-center gap-3 px-4 py-3 border rounded-lg ${
              isLoaded
                ? "border-[#7e57ff]/60 bg-[#7e57ff]/5"
                : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-zinc-100 font-medium truncate">
                  {e.label || formatRunAt(e.runAt)}
                </span>
                {e.label ? (
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {formatRunAt(e.runAt)}
                  </span>
                ) : null}
                {e.updatedAt !== e.runAt ? (
                  <span className="text-[10px] text-zinc-500">
                    edited {relativeTime(e.updatedAt)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500 font-mono tabular-nums">
                <span>{e.groupCount} × {e.groupSize}</span>
                <span>{e.used} used</span>
                <span>score {e.totalScore.toFixed(4)}</span>
                {e.sizeBytes != null ? (
                  <span>{(e.sizeBytes / 1024).toFixed(1)} KB</span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onLoad(e.id)}
              className="text-xs px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded"
            >
              {isLoaded ? "Loaded" : "Open"}
            </button>
            {confirmDelete === e.id ? (
              <>
                <span className="text-[11px] text-zinc-400">delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.mutate({ id: e.id });
                    setConfirmDelete(null);
                  }}
                  className="text-xs px-2 py-1 bg-rose-900/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-200 rounded"
                >
                  yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="text-xs px-2 py-1 text-zinc-400 hover:text-zinc-200"
                >
                  no
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(e.id)}
                className="text-xs px-2 py-1 text-zinc-500 hover:text-rose-300"
                aria-label="delete"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatRunAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  } catch {
    return iso;
  }
}
