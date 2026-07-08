import type { EvidenceItem } from "@/lib/evidence/types";
import { SOURCE_TYPE_LABELS } from "@/components/evidence/labels";

// Metadata description list for an evidence item: source type, URL, added date.

export function EvidenceMeta({ item }: { item: EvidenceItem }) {
  return (
    <dl className="mt-6 grid grid-cols-1 gap-4 bg-white border border-ink/15 rounded-lg p-5">
      <div>
        <dt className="text-xs text-ink/40">Source type</dt>
        <dd className="mt-0.5 text-sm text-ink/80">
          {SOURCE_TYPE_LABELS[item.source_type]}
        </dd>
      </div>
      {item.url ? (
        <div>
          <dt className="text-xs text-ink/40">URL</dt>
          <dd className="mt-0.5 text-sm">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline break-all"
            >
              {item.url}
            </a>
          </dd>
        </div>
      ) : null}
      <div>
        <dt className="text-xs text-ink/40">Added</dt>
        <dd className="mt-0.5 text-sm text-ink/60">
          {new Date(item.created_at).toLocaleString()}
        </dd>
      </div>
    </dl>
  );
}
