"use client";

import type { ReportFilter } from "@/lib/reporting/types";

interface FilterEditorProps {
  filters: ReportFilter[];
  since: string;
  onFiltersChange: (filters: ReportFilter[]) => void;
  onSinceChange: (since: string) => void;
}

const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"];

// Editor for a report's filters. Manages the `since` date bound plus a list of
// field/operator/value clauses. Immutable updates only.
export function FilterEditor({
  filters,
  since,
  onFiltersChange,
  onSinceChange,
}: FilterEditorProps) {
  const addFilter = () => {
    onFiltersChange([...filters, { field: "", operator: "eq", value: "" }]);
  };

  const updateFilter = (index: number, patch: Partial<ReportFilter>) => {
    onFiltersChange(
      filters.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const removeFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink/80">Filters</h2>
        <button
          type="button"
          onClick={addFilter}
          className="rounded-md border border-ink/15 bg-white px-2.5 py-1 text-xs text-ink/70 hover:bg-paper"
        >
          Add filter
        </button>
      </div>

      <div className="mt-3">
        <label
          htmlFor="filter-since"
          className="block text-xs font-medium text-ink/50"
        >
          Only include records created on or after
        </label>
        <input
          id="filter-since"
          type="date"
          value={since}
          onChange={(e) => onSinceChange(e.target.value)}
          className="mt-1 rounded border border-ink/15 bg-white px-2 py-1 text-sm"
        />
      </div>

      {filters.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">No custom filters.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {filters.map((filter, index) => (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border border-ink/10 bg-paper p-2"
            >
              <input
                value={filter.field}
                onChange={(e) => updateFilter(index, { field: e.target.value })}
                placeholder="field"
                className="min-w-[6rem] flex-1 rounded border border-ink/15 bg-white px-2 py-1 text-sm"
                aria-label="Filter field"
              />
              <select
                value={filter.operator}
                onChange={(e) =>
                  updateFilter(index, { operator: e.target.value })
                }
                className="rounded border border-ink/15 bg-white px-2 py-1 text-sm"
                aria-label="Filter operator"
              >
                {OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <input
                value={filter.value}
                onChange={(e) => updateFilter(index, { value: e.target.value })}
                placeholder="value"
                className="min-w-[6rem] flex-1 rounded border border-ink/15 bg-white px-2 py-1 text-sm"
                aria-label="Filter value"
              />
              <button
                type="button"
                onClick={() => removeFilter(index)}
                className="text-xs text-red-700 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
