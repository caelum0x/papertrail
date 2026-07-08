"use client";

// Sidebar list of KB categories with counts. Highlights the active category and
// exposes an "All" reset. Presentational: state lives in the parent page.
import type { HelpCategoryDto } from "@/app/console/help/api";

export function CategoryList({
  categories,
  active,
  totalCount,
  onSelect,
}: {
  categories: HelpCategoryDto[];
  active: string | null;
  totalCount: number;
  onSelect: (category: string | null) => void;
}) {
  return (
    <nav aria-label="Help categories" className="space-y-1">
      <button
        onClick={() => onSelect(null)}
        className={`w-full flex items-center justify-between rounded px-3 py-2 text-sm ${
          active === null
            ? "bg-accent/10 text-accent"
            : "text-ink/60 hover:bg-paper"
        }`}
      >
        <span>All articles</span>
        <span className="text-xs text-ink/40">{totalCount}</span>
      </button>
      {categories.map((c) => (
        <button
          key={c.category}
          onClick={() => onSelect(c.category)}
          className={`w-full flex items-center justify-between rounded px-3 py-2 text-sm capitalize ${
            active === c.category
              ? "bg-accent/10 text-accent"
              : "text-ink/60 hover:bg-paper"
          }`}
        >
          <span>{c.category}</span>
          <span className="text-xs text-ink/40">{c.count}</span>
        </button>
      ))}
    </nav>
  );
}
