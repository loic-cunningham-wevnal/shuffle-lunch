"use client";

import { useState, type ReactNode } from "react";

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Section({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800/60 rounded-lg bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wider text-zinc-300 hover:text-zinc-100"
      >
        <span>{title}</span>
        <span className="text-zinc-500">{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="px-3 pb-3 pt-1 space-y-3">{children}</div> : null}
    </div>
  );
}
