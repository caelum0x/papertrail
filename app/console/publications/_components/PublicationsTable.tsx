import Link from "next/link";
import type { PublicationWithCounts } from "@/app/api/publications/lib/types";
import { typeLabel, statusLabel, formatDate } from "./labels";

interface PublicationsTableProps {
  items: PublicationWithCounts[];
}

// Table of publications with per-row claim/verification counts and an open link.
export function PublicationsTable({ items }: PublicationsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Title</th>
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Claims</th>
          <th className="px-4 py-2 font-medium">Verified</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <PublicationRow key={p.id} publication={p} />
        ))}
      </tbody>
    </table>
  );
}

function PublicationRow({
  publication: p,
}: {
  publication: PublicationWithCounts;
}) {
  return (
    <tr className="border-b border-ink/10 last:border-0 hover:bg-paper">
      <td className="px-4 py-3 text-ink/80">
        <div className="font-medium">{p.title}</div>
        {p.targetJournal ? (
          <div className="text-xs text-ink/40 line-clamp-1">
            {p.targetJournal}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-ink/60">{typeLabel(p.type)}</td>
      <td className="px-4 py-3 text-ink/60">{statusLabel(p.status)}</td>
      <td className="px-4 py-3 text-ink/60">{p.claimCount}</td>
      <td className="px-4 py-3 text-ink/60">{p.verifiedCount}</td>
      <td className="px-4 py-3 text-ink/60">{formatDate(p.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/console/publications/${p.id}`}
          className="text-accent hover:underline"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}
