"use client";

import { ERROR_LEVELS, type ErrorLevel } from "@/lib/observability/types";

// Filter bar for the error table: level select + free-text search.

export interface ErrorFilterValue {
  level: ErrorLevel | "";
  q: string;
}

export function ErrorFilters({
  value,
  onChange,
}: {
  value: ErrorFilterValue;
  onChange: (next: ErrorFilterValue) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
        placeholder="Search messages…"
        className="w-56 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none"
      />
      <select
        value={value.level}
        onChange={(e) =>
          onChange({ ...value, level: e.target.value as ErrorLevel | "" })
        }
        className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      >
        <option value="">All levels</option>
        {ERROR_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl}
          </option>
        ))}
      </select>
    </div>
  );
}
