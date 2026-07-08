"use client";

import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  type SearchType,
} from "@/components/search/types";

interface SearchControlsProps {
  q: string;
  typeFilter: SearchType | "";
  onQChange: (value: string) => void;
  onTypeChange: (value: SearchType | "") => void;
}

// Search input plus a type filter dropdown.
export function SearchControls({
  q,
  typeFilter,
  onQChange,
  onTypeChange,
}: SearchControlsProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <input
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Search your workspace..."
        className="flex-1 min-w-[240px] rounded border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        aria-label="Search"
        autoFocus
      />
      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value as SearchType | "")}
        className="rounded border border-ink/10 px-2 py-2 text-sm focus:border-accent focus:outline-none"
        aria-label="Filter by type"
      >
        <option value="">All types</option>
        {SEARCH_TYPES.map((t) => (
          <option key={t} value={t}>
            {SEARCH_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}
