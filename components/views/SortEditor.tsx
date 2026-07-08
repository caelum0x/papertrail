"use client";

import type { SortDirection, ViewSort } from "./api";

interface SortEditorProps {
  sort: ViewSort[];
  onChange: (sort: ViewSort[]) => void;
}

const DIRECTIONS: readonly { value: SortDirection; label: string }[] = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

// Field-group component for the ViewBuilder: an ordered list of sort clauses.
// Immutable updates throughout — handlers return new arrays.
export function SortEditor({ sort, onChange }: SortEditorProps) {
  const update = (index: number, patch: Partial<ViewSort>) => {
    onChange(sort.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const remove = (index: number) => {
    onChange(sort.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...sort, { field: "", direction: "asc" }]);
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-ink/70">Sort</legend>
      {sort.length === 0 ? (
        <p className="text-sm text-ink/40">No sort — uses the resource default.</p>
      ) : (
        <div className="space-y-2">
          {sort.map((clause, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink/40 w-4 text-right">{index + 1}.</span>
              <input
                aria-label="Sort field"
                value={clause.field}
                onChange={(e) => update(index, { field: e.target.value })}
                placeholder="field (e.g. created_at)"
                className="min-w-[10rem] flex-1 rounded border border-ink/15 px-2 py-1.5 text-sm"
              />
              <select
                aria-label="Sort direction"
                value={clause.direction}
                onChange={(e) =>
                  update(index, { direction: e.target.value as SortDirection })
                }
                className="rounded border border-ink/15 px-2 py-1.5 text-sm"
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
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
        + Add sort
      </button>
    </fieldset>
  );
}
