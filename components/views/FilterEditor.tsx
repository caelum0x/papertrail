"use client";

import { FILTER_OPERATORS, type ViewFilter } from "./api";

interface FilterEditorProps {
  filters: ViewFilter[];
  onChange: (filters: ViewFilter[]) => void;
}

// Field-group component for the ViewBuilder: an editable list of filter clauses.
// Each row is field + operator + value. Uses immutable updates — every handler
// returns a new array rather than mutating the incoming one.
export function FilterEditor({ filters, onChange }: FilterEditorProps) {
  const update = (index: number, patch: Partial<ViewFilter>) => {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const remove = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([
      ...filters,
      { field: "", operator: FILTER_OPERATORS[0].value, value: "" },
    ]);
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink/70">Filters</legend>
      {filters.length === 0 ? (
        <p className="text-sm text-ink/40">
          No filters yet — this view will match every row.
        </p>
      ) : (
        <div className="space-y-2">
          {filters.map((filter, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Filter field"
                value={filter.field}
                onChange={(e) => update(index, { field: e.target.value })}
                placeholder="field (e.g. status)"
                className="min-w-[10rem] flex-1 rounded border border-ink/15 px-2 py-1.5 text-sm"
              />
              <select
                aria-label="Filter operator"
                value={filter.operator}
                onChange={(e) => update(index, { operator: e.target.value })}
                className="rounded border border-ink/15 px-2 py-1.5 text-sm"
              >
                {FILTER_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Filter value"
                value={filter.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="value"
                className="min-w-[8rem] flex-1 rounded border border-ink/15 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="text-sm text-accent hover:underline"
      >
        + Add filter
      </button>
    </fieldset>
  );
}
