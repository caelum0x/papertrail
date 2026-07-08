import Link from "next/link";
import {
  type ImportItem,
  STATUS_LABEL,
  STATUS_STYLE,
} from "./importTypes";

// Per-file progress table for the bulk import flow.

function ImportRow({ item }: { item: ImportItem }) {
  return (
    <tr className="border-b border-ink/10 last:border-0">
      <td className="px-5 py-3 text-ink/80 break-all">{item.file.name}</td>
      <td className="px-5 py-3">
        <span className={STATUS_STYLE[item.status]}>
          {STATUS_LABEL[item.status]}
        </span>
        {item.error ? (
          <span className="block text-xs text-red-600">{item.error}</span>
        ) : null}
      </td>
      <td className="px-5 py-3 text-ink/60">{item.pages ?? "—"}</td>
      <td className="px-5 py-3 text-ink/60">{item.chunks ?? "—"}</td>
      <td className="px-5 py-3">
        {item.documentId ? (
          <Link
            href={`/console/documents/${item.documentId}/pipeline`}
            className="text-accent hover:underline"
          >
            View pipeline
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

export function ImportTable({ items }: { items: ImportItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mt-6 bg-white border border-ink/15 rounded-lg px-5 py-10 text-center text-sm text-ink/40">
        No files selected yet. Choose one or more PDFs above.
      </div>
    );
  }

  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink/40 border-b border-ink/10">
            <th className="px-5 py-2 font-medium">File</th>
            <th className="px-5 py-2 font-medium">Status</th>
            <th className="px-5 py-2 font-medium">Pages</th>
            <th className="px-5 py-2 font-medium">Chunks</th>
            <th className="px-5 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <ImportRow key={`${it.file.name}-${i}`} item={it} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
