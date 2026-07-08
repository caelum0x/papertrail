import type { EvidenceSourceType } from "@/lib/evidence/types";
import { SOURCE_TYPE_LABELS } from "@/components/evidence/labels";

// Small, reusable presentational badges for source type and tags.

export function SourceTypeBadge({ type }: { type: EvidenceSourceType }) {
  return (
    <span className="inline-flex items-center rounded-full border border-ink/15 bg-paper px-2 py-0.5 text-xs text-ink/60">
      {SOURCE_TYPE_LABELS[type]}
    </span>
  );
}

interface TagBadgeProps {
  tag: string;
  onRemove?: (tag: string) => void;
}

export function TagBadge({ tag, onRemove }: TagBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
      {tag}
      {onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(tag)}
          className="text-accent/70 hover:text-accent"
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
