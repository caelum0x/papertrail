import { TYPE_FILTERS, type TypeFilter } from "./sourceBadge";

interface SourcesFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (value: TypeFilter) => void;
}

export function SourcesFilters({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
}: SourcesFiltersProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Filter by title or identifier…"
        className="flex-1 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/40 focus:border-accent focus:outline-none"
      />
      <div className="flex shrink-0 gap-1">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onTypeFilterChange(filter.value)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              typeFilter === filter.value
                ? "bg-accent text-white"
                : "border border-ink/10 text-ink/60 hover:text-accent"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
