"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `Login failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 border border-zinc-800 rounded-lg p-6 bg-zinc-900/40"
      >
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            shuffle-lunch
          </div>
          <h1 className="text-lg font-medium text-zinc-100">Sign in</h1>
        </div>
        <label className="block">
          <span className="text-xs text-zinc-400 mb-1 block">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm font-mono"
          />
        </label>
        {error ? (
          <div className="text-xs text-rose-400">{error}</div>
        ) : null}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full text-xs bg-[#7e57ff] hover:bg-[#8e66ff] disabled:opacity-50 text-white rounded px-3 py-2 font-medium"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
