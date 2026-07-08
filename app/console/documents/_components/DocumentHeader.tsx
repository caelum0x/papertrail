import { StatusBadge } from "@/components/documents/StatusBadge";
import type { DocumentDetail } from "@/lib/documents/types";
import { formatBytes } from "./format";

// Title row for the document detail page: filename, status, type/size, and a
// delete action.

interface DocumentHeaderProps {
  doc: DocumentDetail;
  deleting: boolean;
  onDelete: () => void;
}

export function DocumentHeader({ doc, deleting, onDelete }: DocumentHeaderProps) {
  return (
    <div className="mt-3 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80 break-all">
          {doc.filename}
        </h1>
        <div className="mt-2 flex items-center gap-3">
          <StatusBadge status={doc.status} />
          <span className="text-xs text-ink/40">
            {doc.mime_type} · {formatBytes(doc.size_bytes)}
          </span>
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="shrink-0 rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
