"use client";

import { useRef, useState } from "react";
import { useSettings } from "@/lib/settings-store";

export function SettingsIO() {
  const exportJson = useSettings((s) => s.exportJson);
  const importJson = useSettings((s) => s.importJson);
  const reset = useSettings((s) => s.reset);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onExport = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shuffle-lunch-settings-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFeedback("Exported.");
    setTimeout(() => setFeedback(null), 2000);
  };

  const onImportClick = () => {
    fileInputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const result = importJson(raw);
      if (result.ok) {
        setFeedback("Imported.");
      } else {
        setFeedback(`Import failed: ${result.error}`);
      }
    } catch (err) {
      setFeedback(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          className="flex-1 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded px-2 py-1.5"
        >
          Export settings
        </button>
        <button
          type="button"
          onClick={onImportClick}
          className="flex-1 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded px-2 py-1.5"
        >
          Import settings
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          reset();
          setFeedback("Reset to defaults.");
          setTimeout(() => setFeedback(null), 2000);
        }}
        className="w-full text-xs text-zinc-500 hover:text-zinc-300"
      >
        Reset to defaults
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={onFile}
      />
      {feedback ? (
        <div className="text-[11px] text-zinc-400 leading-snug">{feedback}</div>
      ) : null}
    </div>
  );
}
