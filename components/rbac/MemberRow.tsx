"use client";

import type { TeamMemberDTO } from "./api";

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// A single row in the MembersTable.
export function MemberRow({
  member,
  onRemove,
  removing,
}: {
  member: TeamMemberDTO;
  onRemove: (member: TeamMemberDTO) => void;
  removing: boolean;
}) {
  return (
    <tr className="hover:bg-paper/60">
      <td className="px-4 py-3 text-ink/80">{member.userName || "—"}</td>
      <td className="px-4 py-3 text-ink/60">{member.userEmail}</td>
      <td className="px-4 py-3 text-ink/40">{formatDate(member.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onRemove(member)}
          disabled={removing}
          className="text-sm text-red-600 hover:underline disabled:opacity-40"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </td>
    </tr>
  );
}
