import type { DocumentStatus } from "@/lib/documents/types";

// Small colored pill for a document's extraction status. Uses only the shared
// design tokens plus a couple of semantic status colors.

const STYLES: Record<DocumentStatus, string> = {
  pending: "bg-paper text-ink/50 border-ink/15",
  processing: "bg-paper text-ink/60 border-ink/20",
  extracted: "bg-white text-accent border-accent/40",
  failed: "bg-white text-red-600 border-red-300",
};

const LABELS: Record<DocumentStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  extracted: "Extracted",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
