import { CLAIM_STATUSES } from "@/lib/claims/schemas";

// Search + status filter bar for the claims list.

interface ClaimsFiltersProps {
  query: string;
  status: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}

export function ClaimsFilters({
  query,
  status,
  onQueryChange,
  onStatusChange,
}: ClaimsFiltersProps) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search claim text..."
        className="w-full sm:max-w-xs rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        aria-label="Search claims"
      />
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {CLAIM_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
