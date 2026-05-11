"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import type { FlatMember } from "@cli/flat-member";
import { MemberEditDrawer } from "./member-edit-drawer";

export function MembersPanel() {
  const [search, setSearch] = useState("");
  const [editingNo, setEditingNo] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const listQuery = trpc.members.list.useQuery();

  const members = listQuery.data?.members ?? [];

  const filtered = useMemo(() => {
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.name_romaji?.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q) ||
        m.detailed_department?.toLowerCase().includes(q),
    );
  }, [members, search]);

  const editingMember = useMemo<FlatMember | null>(() => {
    if (editingNo === null) return null;
    return members.find((m) => m.no === editingNo) ?? null;
  }, [members, editingNo]);

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
              <Th>Job title</Th>
              <Th>Age</Th>
              <Th>Joined</Th>
              <Th>Hometown</Th>
              <Th>Gender</Th>
              <Th>MBTI</Th>
              <Th>Vibe</Th>
              <Th>Conf.</Th>
              <Th>Avail.</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <MemberRow
                key={m.no}
                member={m}
                isSelected={editingNo === m.no}
                onClick={() => setEditingNo(m.no)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editingMember ? (
        <MemberEditDrawer
          member={editingMember}
          onClose={() => setEditingNo(null)}
          onSaved={() => {
            void utils.members.list.invalidate();
          }}
        />
      ) : null}
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
  isSelected,
  onClick,
}: {
  member: FlatMember;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${
        isSelected
          ? "bg-[#7e57ff]/10 outline outline-1 outline-[#7e57ff]/40"
          : "even:bg-zinc-900/30 hover:bg-zinc-800/50"
      }`}
    >
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
          <div className="text-[10px] text-zinc-500 truncate max-w-[180px]">
            {member.detailed_department}
          </div>
        ) : null}
      </Td>
      <Td>
        <span className="text-zinc-300 truncate inline-block max-w-[140px]">
          {member.job_title ?? <Dim />}
        </span>
      </Td>
      <Td mono>{member.age ?? <Dim />}</Td>
      <Td mono>{member.joined_year ?? <Dim />}</Td>
      <Td>
        <span className="truncate inline-block max-w-[120px]">
          {member.hometown ?? <Dim />}
        </span>
      </Td>
      <Td>{member.gender ?? <Dim />}</Td>
      <Td mono>{member.mbti ?? <Dim />}</Td>
      <Td>{member.vibe ?? <Dim />}</Td>
      <Td>{member.confidence ?? <Dim />}</Td>
      <Td>
        <FlagBadge label="rem" on={member.is_remote} />
        <FlagBadge label="ng" on={member.is_unavailable} />
      </Td>
      <Td>
        <span
          className="text-[10px] text-zinc-500 group-hover:text-[#a98aff]"
          aria-hidden
        >
          ›
        </span>
      </Td>
    </tr>
  );
}

function Dim() {
  return <span className="text-zinc-700">—</span>;
}

function FlagBadge({ label, on }: { label: string; on: boolean }) {
  if (!on) return null;
  return (
    <span className="inline-block text-[9px] uppercase tracking-wider mr-1 px-1 py-0.5 rounded border border-amber-700/60 bg-amber-950/30 text-amber-300">
      {label}
    </span>
  );
}

function Td({
  children,
  mono,
}: {
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-2 py-1.5 align-top border-r border-zinc-800/40 last:border-r-0 whitespace-nowrap ${
        mono ? "font-mono tabular-nums text-zinc-300" : "text-zinc-200"
      }`}
    >
      {children}
    </td>
  );
}
