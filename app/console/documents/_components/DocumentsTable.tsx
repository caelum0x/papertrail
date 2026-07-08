import Link from "next/link";
import { StatusBadge } from "@/components/documents/StatusBadge";
import type { DocumentSummary } from "@/lib/documents/types";
import { formatBytes, formatDate } from "./format";

// Table of documents in the library. Each filename links to the document detail.

function DocumentRow({ doc }: { doc: DocumentSummary }) {
  return (
    <tr className="border-b border-ink/10 last:border-0 hover:bg-paper">
      <td className="px-5 py-3">
        <Link
          href={`/console/documents/${doc.id}`}
          className="text-accent hover:underline"
        >
          {doc.filename}
        </Link>
      </td>
      <td className="px-5 py-3">
        <StatusBadge status={doc.status} />
      </td>
      <td className="px-5 py-3 text-ink/60">{formatBytes(doc.size_bytes)}</td>
      <td className="px-5 py-3 text-ink/60">{formatDate(doc.created_at)}</td>
    </tr>
  );
}

export function DocumentsTable({ docs }: { docs: DocumentSummary[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-ink/40 border-b border-ink/10">
          <th className="px-5 py-2 font-medium">Filename</th>
          <th className="px-5 py-2 font-medium">Status</th>
          <th className="px-5 py-2 font-medium">Size</th>
          <th className="px-5 py-2 font-medium">Uploaded</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} />
        ))}
      </tbody>
    </table>
  );
}
