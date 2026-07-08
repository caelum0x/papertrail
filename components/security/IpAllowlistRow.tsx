"use client";

import type { IpAllowlistEntry } from "@/lib/security/types";

// One row in the IP allowlist table: the CIDR range, an optional note, when it
// was added, and a delete action. Deletion is delegated to the parent; `busy`
// disables the button while a request is in flight.

interface IpAllowlistRowProps {
  entry: IpAllowlistEntry;
  busy?: boolean;
  onDelete: (id: string) => void;
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function IpAllowlistRow({ entry, busy, onDelete }: IpAllowlistRowProps) {
  return (
    <tr>
      <td className="px-4 py-3 font-mono text-ink/70">{entry.cidr}</td>
      <td className="px-4 py-3 text-ink/60">{entry.note ?? "—"}</td>
      <td className="px-4 py-3 text-ink/40">{formatDate(entry.created_at)}</td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => onDelete(entry.id)}
          disabled={busy}
          className="text-sm text-red-600 hover:underline disabled:opacity-50"
        >
          {busy ? "Removing…" : "Remove"}
        </button>
      </td>
    </tr>
  );
}
