"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import { MBTI_TYPES, VIBE_TAGS } from "@cli/enrichment-schema";
import type { FlatMember } from "@cli/flat-member";

// `mode = 'edit'` updates an existing member; `mode = 'new'` creates one and
// the input `member.no` is ignored (server assigns the next id).
type Props = {
  mode: "edit" | "new";
  member: FlatMember;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
};

type Draft = {
  name: string;
  name_romaji: string;
  department: string;
  detailed_department: string;
  job_title: string;
  joined_year: string; // string in form, parsed on save
  age: string;
  hometown: string;
  hobbies: string;
  comment: string;
  surprising_fact: string;
  is_remote: boolean;
  is_unavailable: boolean;
  prev_count: string;
  birth_month_flag: boolean;
  gender: FlatMember["gender"];
  mbti: FlatMember["mbti"];
  vibe: FlatMember["vibe"];
  confidence: FlatMember["confidence"];
  ai_notes: string;
};

function memberToDraft(m: FlatMember): Draft {
  return {
    name: m.name,
    name_romaji: m.name_romaji ?? "",
    department: m.department,
    detailed_department: m.detailed_department ?? "",
    job_title: m.job_title ?? "",
    joined_year: m.joined_year !== null ? String(m.joined_year) : "",
    age: m.age !== null ? String(m.age) : "",
    hometown: m.hometown ?? "",
    hobbies: m.hobbies ?? "",
    comment: m.comment ?? "",
    surprising_fact: m.surprising_fact ?? "",
    is_remote: m.is_remote,
    is_unavailable: m.is_unavailable,
    prev_count: String(m.prev_count),
    birth_month_flag: m.birth_month_flag,
    gender: m.gender,
    mbti: m.mbti,
    vibe: m.vibe,
    confidence: m.confidence,
    ai_notes: m.ai_notes ?? "",
  };
}

function nullable(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function nullableInt(s: string): number | null {
  const t = s.trim();
  if (t.length === 0) return null;
  const n = Number(t);
  if (!Number.isInteger(n)) return NaN as unknown as number;
  return n;
}

export function MemberEditDrawer({
  mode,
  member,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => memberToDraft(member));
  const [error, setError] = useState<string | null>(null);
  const updateMutation = trpc.members.update.useMutation();
  const createMutation = trpc.members.create.useMutation();
  const deleteMutation = trpc.members.delete.useMutation();

  // If the underlying member changes (e.g. parent invalidates and refetches),
  // reset the form. We compare by .no to avoid resetting on every reference
  // change of the same member.
  const initial = useMemo(() => memberToDraft(member), [member]);
  useEffect(() => {
    setDraft(initial);
    setError(null);
  }, [member.no, initial]);

  const dirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(initial);
  }, [draft, initial]);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSave = async () => {
    setError(null);
    // Validate ints first.
    const parsedJoinedYear = nullableInt(draft.joined_year);
    const parsedAge = nullableInt(draft.age);
    const parsedPrev = Number(draft.prev_count.trim() || "0");
    if (Number.isNaN(parsedJoinedYear)) {
      setError("Joined year must be a whole number or empty.");
      return;
    }
    if (Number.isNaN(parsedAge)) {
      setError("Age must be a whole number or empty.");
      return;
    }
    if (!Number.isInteger(parsedPrev) || parsedPrev < 0) {
      setError("Previous count must be a non-negative integer.");
      return;
    }
    if (draft.name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    if (draft.department.trim().length === 0) {
      setError("Department is required.");
      return;
    }

    const fields = {
      name: draft.name.trim(),
      name_romaji: nullable(draft.name_romaji),
      department: draft.department.trim(),
      detailed_department: nullable(draft.detailed_department),
      job_title: nullable(draft.job_title),
      joined_year: parsedJoinedYear,
      age: parsedAge,
      hometown: nullable(draft.hometown),
      hobbies: nullable(draft.hobbies),
      comment: nullable(draft.comment),
      surprising_fact: nullable(draft.surprising_fact),
      is_remote: draft.is_remote,
      is_unavailable: draft.is_unavailable,
      prev_count: parsedPrev,
      birth_month_flag: draft.birth_month_flag,
      gender: draft.gender,
      mbti: draft.mbti,
      vibe: draft.vibe,
      confidence: draft.confidence,
      ai_notes: nullable(draft.ai_notes),
    };

    try {
      if (mode === "new") {
        await createMutation.mutateAsync(fields);
      } else {
        await updateMutation.mutateAsync({ no: member.no, patch: fields });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const onDelete = async () => {
    setError(null);
    if (
      !window.confirm(
        `Delete ${member.name}? This removes them from the master list.`,
      )
    ) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({ no: member.no });
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const isNew = mode === "new";
  const saving = createMutation.isPending || updateMutation.isPending;
  const deleting = deleteMutation.isPending;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-in fade-in"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full max-w-[520px] z-50 bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl animate-in slide-in-from-right"
        role="dialog"
        aria-label={`Edit ${member.name}`}
      >
        <header className="px-5 py-3 border-b border-zinc-800 flex items-start justify-between gap-3 sticky top-0 bg-zinc-950 z-10">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {isNew ? "New member" : `Member · #${member.no}`}
            </div>
            <h2 className="text-base font-medium text-zinc-100 truncate">
              {draft.name || (isNew ? "(unnamed)" : member.name)}
            </h2>
            {!isNew && member.name_romaji ? (
              <div className="text-xs text-zinc-500 font-mono truncate">
                {member.name_romaji}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <FormSection title="Identity">
            <Field label="Name" required>
              <TextInput
                value={draft.name}
                onChange={(v) => setDraft({ ...draft, name: v })}
              />
            </Field>
            <Field label="Romaji">
              <TextInput
                value={draft.name_romaji}
                onChange={(v) => setDraft({ ...draft, name_romaji: v })}
                placeholder="Latin transliteration"
              />
            </Field>
          </FormSection>

          <FormSection title="Organization">
            <Field label="Department" required>
              <TextInput
                value={draft.department}
                onChange={(v) => setDraft({ ...draft, department: v })}
              />
            </Field>
            <Field label="Sub-department / team">
              <TextInput
                value={draft.detailed_department}
                onChange={(v) =>
                  setDraft({ ...draft, detailed_department: v })
                }
              />
            </Field>
            <Field label="Job title">
              <TextInput
                value={draft.job_title}
                onChange={(v) => setDraft({ ...draft, job_title: v })}
              />
            </Field>
            <Field label="Joined year">
              <TextInput
                value={draft.joined_year}
                onChange={(v) => setDraft({ ...draft, joined_year: v })}
                placeholder="e.g. 2024"
                inputMode="numeric"
              />
            </Field>
          </FormSection>

          <FormSection title="Personal">
            <Field label="Age">
              <TextInput
                value={draft.age}
                onChange={(v) => setDraft({ ...draft, age: v })}
                placeholder="years"
                inputMode="numeric"
              />
            </Field>
            <Field label="Hometown">
              <TextInput
                value={draft.hometown}
                onChange={(v) => setDraft({ ...draft, hometown: v })}
              />
            </Field>
            <Field label="Hobbies">
              <TextArea
                value={draft.hobbies}
                onChange={(v) => setDraft({ ...draft, hobbies: v })}
                rows={2}
              />
            </Field>
            <Field label="Comment">
              <TextArea
                value={draft.comment}
                onChange={(v) => setDraft({ ...draft, comment: v })}
                rows={2}
              />
            </Field>
            <Field label="Surprising fact">
              <TextArea
                value={draft.surprising_fact}
                onChange={(v) => setDraft({ ...draft, surprising_fact: v })}
                rows={2}
              />
            </Field>
          </FormSection>

          <FormSection title="Availability">
            <ToggleField
              label="Remote / distant"
              description="Excluded from in-person groups by default"
              value={draft.is_remote}
              onChange={(v) => setDraft({ ...draft, is_remote: v })}
            />
            <ToggleField
              label="NG / unavailable"
              description="Excluded from groups by default"
              value={draft.is_unavailable}
              onChange={(v) => setDraft({ ...draft, is_unavailable: v })}
            />
            <ToggleField
              label="Birthday this month"
              value={draft.birth_month_flag}
              onChange={(v) => setDraft({ ...draft, birth_month_flag: v })}
            />
            <Field label="Previous count">
              <TextInput
                value={draft.prev_count}
                onChange={(v) => setDraft({ ...draft, prev_count: v })}
                placeholder="0"
                inputMode="numeric"
              />
            </Field>
          </FormSection>

          <FormSection title="AI enrichment">
            <Field label="Gender">
              <Select
                value={genderToOption(draft.gender)}
                options={["—", "unknown", "male", "female"]}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    gender:
                      v === "—"
                        ? null
                        : (v as Exclude<FlatMember["gender"], null>),
                  })
                }
              />
            </Field>
            <Field label="MBTI">
              <Select
                value={draft.mbti ?? "—"}
                options={["—", ...MBTI_TYPES]}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    mbti: v === "—" ? null : (v as FlatMember["mbti"]),
                  })
                }
              />
            </Field>
            <Field label="Vibe">
              <Select
                value={draft.vibe ?? "—"}
                options={["—", ...VIBE_TAGS]}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    vibe: v === "—" ? null : (v as FlatMember["vibe"]),
                  })
                }
              />
            </Field>
            <Field label="Confidence">
              <Select
                value={draft.confidence ?? "—"}
                options={["—", "low", "medium", "high"]}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    confidence:
                      v === "—"
                        ? null
                        : (v as Exclude<FlatMember["confidence"], null>),
                  })
                }
              />
            </Field>
            <Field label="AI notes">
              <TextArea
                value={draft.ai_notes}
                onChange={(v) => setDraft({ ...draft, ai_notes: v })}
                rows={4}
              />
            </Field>
          </FormSection>
        </div>

        <footer className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between gap-3 bg-zinc-950 sticky bottom-0">
          <div className="text-[11px] text-zinc-500 min-h-[1em] flex items-center gap-2 flex-1">
            {!isNew ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving || deleting}
                className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline underline-offset-2 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            ) : null}
            <span className={!isNew ? "ml-2" : ""}>
              {error ? (
                <span className="text-rose-400">{error}</span>
              ) : isNew ? (
                "Fill in the required fields and click Create."
              ) : dirty ? (
                "Unsaved changes"
              ) : (
                "All saved."
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-400 hover:text-zinc-100 px-3 py-1.5 border border-zinc-800 hover:border-zinc-700 rounded"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={(!isNew && !dirty) || saving || deleting}
            className="text-xs bg-[#7e57ff] hover:bg-[#8e66ff] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-3 py-1.5 font-medium"
          >
            {saving
              ? isNew
                ? "Creating…"
                : "Saving…"
              : isNew
                ? "Create member"
                : "Save changes"}
          </button>
        </footer>
      </aside>
    </>
  );
}

function genderToOption(g: FlatMember["gender"]): string {
  return g ?? "—";
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium border-b border-zinc-800/60 pb-1">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] text-zinc-400 mb-1 flex items-center gap-1">
        <span>{label}</span>
        {required ? <span className="text-rose-400">*</span> : null}
      </div>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric";
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-[#7e57ff] focus:outline-none rounded px-2.5 py-1.5 text-sm transition-colors"
    />
  );
}

function TextArea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      rows={rows}
      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-[#7e57ff] focus:outline-none rounded px-2.5 py-1.5 text-sm leading-relaxed resize-y transition-colors"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-[#7e57ff] focus:outline-none rounded px-2.5 py-1.5 text-sm cursor-pointer transition-colors"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function ToggleField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="mt-0.5 accent-[#7e57ff] cursor-pointer"
      />
      <div className="flex-1">
        <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
          {label}
        </div>
        {description ? (
          <div className="text-[11px] text-zinc-500">{description}</div>
        ) : null}
      </div>
    </label>
  );
}
