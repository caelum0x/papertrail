import Link from "next/link";
import type { EvidenceItem } from "@/lib/evidence/types";
import { SourceTypeBadge, TagBadge } from "@/components/evidence/EvidenceBadges";

// List of evidence cards. Each card links to the item detail page.

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <li className="bg-white border border-ink/15 rounded-lg p-4 hover:border-accent/40">
      <Link href={`/console/evidence/${item.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink/80 truncate">
              {item.title}
            </h3>
            {item.external_id ? (
              <p className="mt-0.5 text-xs text-ink/40">{item.external_id}</p>
            ) : null}
          </div>
          <SourceTypeBadge type={item.source_type} />
        </div>
        {item.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        ) : null}
      </Link>
    </li>
  );
}

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
