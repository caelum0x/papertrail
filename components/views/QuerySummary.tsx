import { operatorLabel, type ViewQuery } from "./api";

interface QuerySummaryProps {
  query: ViewQuery;
  className?: string;
}

// Compact, read-only rendering of a view's query: search term, filter chips, and
// sort chips. Shown in list rows and on the detail page so users can eyeball a
// view without opening it.
export function QuerySummary({ query, className }: QuerySummaryProps) {
  const hasSearch = Boolean(query.search && query.search.trim());
  const hasFilters = query.filters.length > 0;
  const hasSort = query.sort.length > 0;

  if (!hasSearch && !hasFilters && !hasSort) {
    return (
      <span className={`text-sm text-ink/40 ${className ?? ""}`}>
        No filters — matches everything.
      </span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {hasSearch ? (
        <span className="rounded bg-paper border border-ink/10 px-2 py-0.5 text-xs text-ink/60">
          search: “{query.search}”
        </span>
      ) : null}
      {query.filters.map((f, i) => (
        <span
          key={`f-${i}`}
          className="rounded bg-paper border border-ink/10 px-2 py-0.5 text-xs text-ink/60"
        >
          {f.field} {operatorLabel(f.operator)} {f.value || "—"}
        </span>
      ))}
      {query.sort.map((s, i) => (
        <span
          key={`s-${i}`}
          className="rounded border border-accent/30 px-2 py-0.5 text-xs text-accent"
        >
          ↕ {s.field} {s.direction}
        </span>
      ))}
    </div>
  );
}
