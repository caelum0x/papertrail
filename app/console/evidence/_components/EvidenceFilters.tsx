import type { EvidenceSourceType } from "@/lib/evidence/types";
import { SOURCE_TYPE_OPTIONS } from "@/components/evidence/labels";

// Search + type + tag filter bar for the evidence library.

interface EvidenceFiltersProps {
  q: string;
  typeFilter: EvidenceSourceType | "";
  tagFilter: string;
  onQChange: (value: string) => void;
  onTypeChange: (value: EvidenceSourceType | "") => void;
  onTagChange: (value: string) => void;
}

export function EvidenceFilters({
  q,
  typeFilter,
  tagFilter,
  onQChange,
  onTypeChange,
  onTagChange,
}: EvidenceFiltersProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <input
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Search title, id, or notes..."
        className="flex-1 min-w-[200px] rounded border border-ink/15 px-3 py-2 text-sm focus:outline-none focus:border-accent"
      />
      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value as EvidenceSourceType | "")}
        className="rounded border border-ink/15 px-2 py-2 text-sm focus:outline-none focus:border-accent"
        aria-label="Filter by source type"
      >
        <option value="">All types</option>
        {SOURCE_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        value={tagFilter}
        onChange={(e) => onTagChange(e.target.value)}
        placeholder="Filter by tag"
        className="w-40 rounded border border-ink/15 px-3 py-2 text-sm focus:outline-none focus:border-accent"
      />
    </div>
  );
}
