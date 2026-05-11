"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import type { FlatMember } from "@cli/flat-member";

const GENDER_OPTIONS = ["unknown", "male", "female"] as const;
const CONFIDENCE_OPTIONS = ["low", "medium", "high"] as const;
const VIBE_OPTIONS = [
  "analytical",
  "social",
  "quiet",
  "playful",
  "mentor",
  "creative",
] as const;
// Generated to match cli/enrichment-schema's MBTI_TYPES — kept in sync by
// hand because importing the const here would pull a server-only module.
const MBTI_OPTIONS = ["Unknown", ...buildMbtiOptions()];

function buildMbtiOptions(): string[] {
  const base = [
    "INTJ",
    "INTP",
    "ENTJ",
    "ENTP",
    "INFJ",
    "INFP",
    "ENFJ",
    "ENFP",
    "ISTJ",
    "ISFJ",
    "ESTJ",
    "ESFJ",
    "ISTP",
    "ISFP",
    "ESTP",
    "ESFP",
  ];
  const out: string[] = [];
  for (const t of base) {
    out.push(`${t}-A`);
    out.push(`${t}-T`);
  }
  return out;
}

export function MembersPanel() {
  const [search, setSearch] = useState("");
  const [editingNo, setEditingNo] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const listQuery = trpc.members.list.useQuery();

  const filtered = useMemo(() => {
    const members = listQuery.data?.members ?? [];
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.name_romaji?.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q),
    );
  }, [listQuery.data, search]);

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading members…
      </div>
    );
  }
  if (listQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full text-rose-400 text-sm text-center max-w-lg mx-auto">
        {listQuery.error.message}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Search by name, romaji, department…"
          className="bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-sm flex-1 max-w-md"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length} of {listQuery.data?.total ?? 0}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border border-zinc-800/60 rounded-lg bg-zinc-950/50">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900 z-10 border-b border-zinc-800">
            <tr className="text-left text-zinc-300 font-medium">
              <Th>#</Th>
              <Th>Name</Th>
              <Th>Department</Th>
              <Th>Gender</Th>
              <Th>MBTI</Th>
              <Th>Vibe</Th>
              <Th>Conf.</Th>
              <Th>Avail.</Th>
              <Th>Notes</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <MemberRow
                key={m.no}
                member={m}
                isEditing={editingNo === m.no}
                onStartEdit={() => setEditingNo(m.no)}
                onCancelEdit={() => setEditingNo(null)}
                onSaved={() => {
                  setEditingNo(null);
                  void utils.members.list.invalidate();
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-2 py-2 font-mono font-medium border-r border-zinc-800/60 last:border-r-0 whitespace-nowrap">
      {children}
    </th>
  );
}

function MemberRow({
  member,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
}: {
  member: FlatMember;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  if (!isEditing) {
    return (
      <tr className="even:bg-zinc-900/30 hover:bg-zinc-800/40">
        <Td mono>{member.no}</Td>
        <Td>
          <div className="text-zinc-100">{member.name}</div>
          {member.name_romaji ? (
            <div className="text-[10px] text-zinc-500">{member.name_romaji}</div>
          ) : null}
        </Td>
        <Td>
          <div className="text-zinc-200">{member.department}</div>
          {member.detailed_department ? (
            <div className="text-[10px] text-zinc-500">
              {member.detailed_department}
            </div>
          ) : null}
        </Td>
        <Td>{member.gender ?? "—"}</Td>
        <Td>{member.mbti ?? "—"}</Td>
        <Td>{member.vibe ?? "—"}</Td>
        <Td>{member.confidence ?? "—"}</Td>
        <Td>
          <FlagBadge label="remote" on={member.is_remote} />
          <FlagBadge label="ng" on={member.is_unavailable} />
        </Td>
        <Td>
          <span
            className="text-[10px] text-zinc-500 line-clamp-2"
            title={member.ai_notes ?? undefined}
          >
            {member.ai_notes ?? ""}
          </span>
        </Td>
        <Td>
          <button
            type="button"
            onClick={onStartEdit}
            className="text-[10px] text-zinc-400 hover:text-[#a98aff] underline-offset-2 hover:underline"
          >
            edit
          </button>
        </Td>
      </tr>
    );
  }
  return (
    <EditingRow
      member={member}
      onCancel={onCancelEdit}
      onSaved={onSaved}
    />
  );
}

function EditingRow({
  member,
  onCancel,
  onSaved,
}: {
  member: FlatMember;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    gender: member.gender,
    mbti: member.mbti,
    vibe: member.vibe,
    confidence: member.confidence,
    is_remote: member.is_remote,
    is_unavailable: member.is_unavailable,
    ai_notes: member.ai_notes,
  });
  const updateMutation = trpc.members.update.useMutation();

  const onSave = async () => {
    await updateMutation.mutateAsync({
      no: member.no,
      patch: {
        gender: draft.gender,
        mbti: draft.mbti,
        vibe: draft.vibe,
        confidence: draft.confidence,
        is_remote: draft.is_remote,
        is_unavailable: draft.is_unavailable,
        ai_notes: draft.ai_notes,
      },
    });
    onSaved();
  };

  return (
    <tr className="bg-zinc-900/60 border-y border-[#7e57ff]/30">
      <Td mono>{member.no}</Td>
      <Td>
        <div className="text-zinc-100">{member.name}</div>
        {member.name_romaji ? (
          <div className="text-[10px] text-zinc-500">{member.name_romaji}</div>
        ) : null}
      </Td>
      <Td>
        <div className="text-zinc-200">{member.department}</div>
        {member.detailed_department ? (
          <div className="text-[10px] text-zinc-500">
            {member.detailed_department}
          </div>
        ) : null}
      </Td>
      <Td>
        <CellSelect
          value={draft.gender ?? "unknown"}
          options={GENDER_OPTIONS}
          onChange={(v) =>
            setDraft({ ...draft, gender: v as FlatMember["gender"] })
          }
        />
      </Td>
      <Td>
        <CellSelect
          value={draft.mbti ?? "Unknown"}
          options={["Unknown", ...MBTI_OPTIONS.slice(1)]}
          onChange={(v) =>
            setDraft({ ...draft, mbti: v as FlatMember["mbti"] })
          }
        />
      </Td>
      <Td>
        <CellSelect
          value={draft.vibe ?? VIBE_OPTIONS[0]}
          options={VIBE_OPTIONS as unknown as readonly string[]}
          onChange={(v) =>
            setDraft({ ...draft, vibe: v as FlatMember["vibe"] })
          }
        />
      </Td>
      <Td>
        <CellSelect
          value={draft.confidence ?? "medium"}
          options={CONFIDENCE_OPTIONS}
          onChange={(v) =>
            setDraft({ ...draft, confidence: v as FlatMember["confidence"] })
          }
        />
      </Td>
      <Td>
        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.is_remote}
            onChange={(e) =>
              setDraft({ ...draft, is_remote: e.currentTarget.checked })
            }
            className="accent-[#7e57ff]"
          />
          remote
        </label>
        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.is_unavailable}
            onChange={(e) =>
              setDraft({
                ...draft,
                is_unavailable: e.currentTarget.checked,
              })
            }
            className="accent-[#7e57ff]"
          />
          ng
        </label>
      </Td>
      <Td>
        <textarea
          value={draft.ai_notes ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, ai_notes: e.currentTarget.value || null })
          }
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] resize-y min-h-[40px]"
        />
      </Td>
      <Td>
        <div className="flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={updateMutation.isPending}
            className="text-[10px] bg-[#7e57ff] hover:bg-[#8e66ff] disabled:opacity-50 text-white rounded px-2 py-1"
          >
            {updateMutation.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          {updateMutation.isError ? (
            <span className="text-[10px] text-rose-400" title={updateMutation.error.message}>
              save failed
            </span>
          ) : null}
        </div>
      </Td>
    </tr>
  );
}

function CellSelect({
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
      className="w-full bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] cursor-pointer focus:outline-none focus:border-[#7e57ff]"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function FlagBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-block text-[9px] uppercase tracking-wider mr-1 px-1 py-0.5 rounded border ${
        on
          ? "border-amber-700/60 bg-amber-950/30 text-amber-300"
          : "border-zinc-800 bg-transparent text-zinc-600"
      }`}
    >
      {label}
    </span>
  );
}

function Td({ children, mono }: { children?: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={`px-2 py-1.5 align-top border-r border-zinc-800/40 last:border-r-0 ${
        mono ? "font-mono tabular-nums text-zinc-300" : "text-zinc-200"
      }`}
    >
      {children}
    </td>
  );
}
