"use client";

import { type ReactNode } from "react";

type Props = {
  label: ReactNode;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
};

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: Props) {
  const display = format ? format(value) : String(value);
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-zinc-200">{label}</span>
        <span className="text-xs font-mono tabular-nums text-zinc-400">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="w-full accent-[#7e57ff] cursor-pointer h-1"
      />
      {hint ? (
        <div className="text-[10px] text-zinc-500 mt-1 leading-snug">{hint}</div>
      ) : null}
    </label>
  );
}
