"use client";

import {
  KIND_LABELS,
  TEMPLATE_KINDS,
  type CategoryStat,
  type TemplateKind,
} from "@/app/console/templates/api";

interface CategoryFilterProps {
  kind: TemplateKind | "all";
  category: string | "all";
  categories: CategoryStat[];
  onKindChange: (kind: TemplateKind | "all") => void;
  onCategoryChange: (category: string | "all") => void;
}

// Filter bar for the template grid: a kind selector (tabs) plus a category
// dropdown. Purely presentational — parent owns the filter state and refetches.
export function CategoryFilter({
  kind,
  category,
  categories,
  onKindChange,
  onCategoryChange,
}: CategoryFilterProps) {
  const kinds: Array<TemplateKind | "all"> = ["all", ...TEMPLATE_KINDS];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1">
        {kinds.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onKindChange(k)}
              className={`text-sm rounded px-3 py-1.5 border ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-ink/10 text-ink/60 hover:border-accent/50"
              }`}
            >
              {k === "all" ? "All" : KIND_LABELS[k]}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink/60">
        <span>Category</span>
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="border border-ink/15 rounded px-2 py-1.5 bg-white text-ink/80"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
