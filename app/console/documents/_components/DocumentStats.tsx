import type { DocumentDetail } from "@/lib/documents/types";

// Three-up stat cards for a document: page count, storage key, and created date.

export function DocumentStats({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white border border-ink/15 rounded-lg p-4">
        <div className="text-xs text-ink/40">Pages</div>
        <div className="mt-1 text-lg font-semibold text-ink/80">
          {doc.page_count}
        </div>
      </div>
      <div className="bg-white border border-ink/15 rounded-lg p-4">
        <div className="text-xs text-ink/40">Storage key</div>
        <div className="mt-1 text-sm text-ink/70 break-all">
          {doc.storage_key ?? "—"}
        </div>
      </div>
      <div className="bg-white border border-ink/15 rounded-lg p-4">
        <div className="text-xs text-ink/40">Created</div>
        <div className="mt-1 text-sm text-ink/70">
          {new Date(doc.created_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
