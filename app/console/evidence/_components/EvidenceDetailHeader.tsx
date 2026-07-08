import type { EvidenceItem } from "@/lib/evidence/types";
import { SourceTypeBadge } from "@/components/evidence/EvidenceBadges";

// Title row for the evidence detail page: title, source badge, external id, and
// a delete action.

interface EvidenceDetailHeaderProps {
  item: EvidenceItem;
  deleting: boolean;
  onDelete: () => void;
}

export function EvidenceDetailHeader({
  item,
  deleting,
  onDelete,
}: EvidenceDetailHeaderProps) {
  return (
    <div className="mt-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink/80">{item.title}</h1>
        <div className="mt-2 flex items-center gap-2">
          <SourceTypeBadge type={item.source_type} />
          {item.external_id ? (
            <span className="text-xs text-ink/40">{item.external_id}</span>
          ) : null}
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {deleting ? "Deleting..." : "Delete"}
      </button>
    </div>
  );
}
