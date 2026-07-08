import { DISCREPANCY_TYPES, LABELS, type RecentItem } from "./recentShared";
import { downloadCsv } from "./downloadCsv";

interface RecentFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  filtered: RecentItem[];
}

export function RecentFilters({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  filtered,
}: RecentFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter claims…"
        className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/40 focus:border-accent focus:outline-none"
      />
      <select
        value={typeFilter}
        onChange={(e) => onTypeFilterChange(e.target.value)}
        className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
      >
        <option value="all">All types</option>
        {DISCREPANCY_TYPES.map((type) => (
          <option key={type} value={type}>
            {LABELS[type]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => downloadCsv(filtered)}
        disabled={filtered.length === 0}
        className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-accent hover:bg-ink/5 disabled:cursor-not-allowed disabled:text-ink/30 disabled:hover:bg-white"
      >
        Export CSV
      </button>
    </div>
  );
}
