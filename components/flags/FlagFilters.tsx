"use client";

// Search box for the flag list. Debounced by the parent via onChange; this
// component is purely presentational and controlled.
export function FlagFilters({
  query,
  onQuery,
}: {
  query: string;
  onQuery: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search flags by key or description…"
          className="w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none"
        />
        {query && (
          <button
            onClick={() => onQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink/40 hover:text-ink"
            aria-label="Clear search"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
