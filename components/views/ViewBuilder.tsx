"use client";

import { useState } from "react";
import {
  VIEW_RESOURCES,
  RESOURCE_LABELS,
  emptyQuery,
  type ViewFilter,
  type ViewQuery,
  type ViewResource,
  type ViewSort,
} from "./api";
import { FilterEditor } from "./FilterEditor";
import { SortEditor } from "./SortEditor";
import { QuerySummary } from "./QuerySummary";

export interface ViewBuilderValues {
  name: string;
  resource: ViewResource;
  query: ViewQuery;
  shared: boolean;
}

interface ViewBuilderProps {
  initial?: Partial<ViewBuilderValues>;
  saving: boolean;
  error: string | null;
  submitLabel?: string;
  onSubmit: (values: ViewBuilderValues) => void;
  onCancel?: () => void;
}

// The saved-view form/wizard. Composes name + resource + sharing controls with
// the FilterEditor and SortEditor field-group components and a live preview.
// All state is held immutably; child editors receive new arrays on change.
export function ViewBuilder({
  initial,
  saving,
  error,
  submitLabel = "Save view",
  onSubmit,
  onCancel,
}: ViewBuilderProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [resource, setResource] = useState<ViewResource>(
    initial?.resource ?? "claims"
  );
  const [shared, setShared] = useState(initial?.shared ?? false);
  const [search, setSearch] = useState(initial?.query?.search ?? "");
  const [filters, setFilters] = useState<ViewFilter[]>(
    initial?.query?.filters ?? []
  );
  const [sort, setSort] = useState<ViewSort[]>(initial?.query?.sort ?? []);
  const [localError, setLocalError] = useState<string | null>(null);

  const lockResource = initial?.resource !== undefined;

  const buildQuery = (): ViewQuery => ({
    search: search.trim() ? search.trim() : undefined,
    filters: filters.map((f) => ({
      field: f.field.trim(),
      operator: f.operator,
      value: f.value,
    })),
    sort: sort.map((s) => ({ field: s.field.trim(), direction: s.direction })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Give the view a name.");
      return;
    }
    if (filters.some((f) => !f.field.trim())) {
      setLocalError("Every filter needs a field.");
      return;
    }
    if (sort.some((s) => !s.field.trim())) {
      setLocalError("Every sort clause needs a field.");
      return;
    }
    onSubmit({ name: name.trim(), resource, query: buildQuery(), shared });
  };

  const preview = emptyQuery();
  preview.search = search;
  preview.filters = filters;
  preview.sort = sort;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-lg border border-ink/10 bg-white p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink/70">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Unverified high-impact claims"
            className="mt-1 w-full rounded border border-ink/15 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink/70">Resource</span>
          <select
            value={resource}
            disabled={lockResource}
            onChange={(e) => setResource(e.target.value as ViewResource)}
            className="mt-1 w-full rounded border border-ink/15 px-3 py-2 text-sm disabled:bg-paper disabled:text-ink/50"
          >
            {VIEW_RESOURCES.map((r) => (
              <option key={r} value={r}>
                {RESOURCE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-ink/70">Search term</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="optional free-text search"
          className="mt-1 w-full rounded border border-ink/15 px-3 py-2 text-sm"
        />
      </label>

      <FilterEditor filters={filters} onChange={setFilters} />
      <SortEditor sort={sort} onChange={setSort} />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
          className="h-4 w-4 rounded border-ink/30"
        />
        <span className="text-sm text-ink/70">
          Share with everyone in this organization
        </span>
      </label>

      <div className="rounded border border-ink/10 bg-paper p-3">
        <p className="text-xs uppercase tracking-wide text-ink/40">Preview</p>
        <div className="mt-2">
          <QuerySummary query={preview} />
        </div>
      </div>

      {(localError || error) && (
        <p className="text-sm text-red-600">{localError ?? error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:border-accent"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
