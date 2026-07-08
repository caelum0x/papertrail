"use client";

import Link from "next/link";
import { EmptyState } from "./EmptyState";
import type { CategoryStat } from "@/app/console/templates/api";

interface CategoryManagerProps {
  categories: CategoryStat[];
}

// Read-only manager listing every category in use across the org's templates
// with counts, each linking to a filtered grid view. Categories are free-text on
// templates, so this is a derived view rather than a separate editable entity.
export function CategoryManager({ categories }: CategoryManagerProps) {
  if (categories.length === 0) {
    return (
      <EmptyState
        title="No categories yet"
        message="Categories appear here as you tag templates. Add a category when creating or editing a template."
        actionHref="/console/templates/new"
        actionLabel="New template"
      />
    );
  }

  return (
    <ul className="space-y-2">
      {categories.map((c) => (
        <li key={c.category}>
          <Link
            href={`/console/templates?category=${encodeURIComponent(c.category)}`}
            className="flex items-center justify-between bg-white border border-ink/10 rounded-lg p-4 hover:border-accent"
          >
            <span className="font-medium text-ink/80">{c.category}</span>
            <span className="text-xs rounded px-2 py-0.5 bg-accent/10 text-accent">
              {c.count} template{c.count === 1 ? "" : "s"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
