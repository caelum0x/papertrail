"use client";

import type { ReferenceDto } from "../api";

function ReferenceRow({
  reference,
  onDelete,
}: {
  reference: ReferenceDto;
  onDelete: (id: string) => void;
}) {
  const ref = reference;
  return (
    <tr className="border-b border-ink/10 last:border-0 align-top">
      <td className="px-4 py-2 text-ink/80">
        {ref.url ? (
          <a
            href={ref.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            {ref.title ?? "Untitled"}
          </a>
        ) : (
          ref.title ?? "Untitled"
        )}
        {ref.journal ? (
          <span className="block text-xs text-ink/40">{ref.journal}</span>
        ) : null}
      </td>
      <td className="px-4 py-2 text-ink/60">
        {ref.authors.length > 0 ? ref.authors.slice(0, 3).join(", ") : "—"}
        {ref.authors.length > 3 ? " et al." : ""}
      </td>
      <td className="px-4 py-2 text-ink/60">{ref.year ?? "—"}</td>
      <td className="px-4 py-2 text-xs text-ink/50">
        {ref.doi ? <span className="block">DOI: {ref.doi}</span> : null}
        {ref.pmid ? <span className="block">PMID: {ref.pmid}</span> : null}
        {ref.nctId ? <span className="block">{ref.nctId}</span> : null}
        {!ref.doi && !ref.pmid && !ref.nctId ? "—" : null}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={() => onDelete(ref.id)}
          className="text-xs text-red-600 hover:underline"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

interface ReferencesTableProps {
  references: ReferenceDto[];
  onDelete: (id: string) => void;
}

export function ReferencesTable({ references, onDelete }: ReferencesTableProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/50">
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Authors</th>
            <th className="px-4 py-2 font-medium">Year</th>
            <th className="px-4 py-2 font-medium">Identifiers</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {references.map((ref) => (
            <ReferenceRow key={ref.id} reference={ref} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
