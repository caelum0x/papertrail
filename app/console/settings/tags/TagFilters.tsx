"use client";

// Search filter for the flat tag table. Controlled by the parent TagManager.

interface TagFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export default function TagFilters({ search, onSearchChange }: TagFiltersProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Filter tags by name…"
        className="w-full rounded border border-ink/15 px-2 py-1.5 text-sm outline-none focus:border-accent sm:w-64"
      />
      {search ? (
        <button
          type="button"
          onClick={() => onSearchChange("")}
          className="text-xs text-ink/40 hover:text-ink/80"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
