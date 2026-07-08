"use client";

import { ERROR_LEVELS, type ErrorLevel } from "@/lib/observability/types";

// Filters for the unified log viewer: source (all/error/audit), level (errors
// only), and free-text search.

export interface LogFilterValue {
  source: "all" | "error" | "audit";
  level: ErrorLevel | "";
  q: string;
}

const SOURCES: { value: LogFilterValue["source"]; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "error", label: "Errors" },
  { value: "audit", label: "Audit" },
];

export function LogFilters({
  value,
  onChange,
}: {
  value: LogFilterValue;
  onChange: (next: LogFilterValue) => void;
}) {
  const levelDisabled = value.source === "audit";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={value.q}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
        placeholder="Search messages / actions…"
        className="w-64 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none"
      />
      <select
        value={value.source}
        onChange={(e) =>
          onChange({
            ...value,
            source: e.target.value as LogFilterValue["source"],
            // Clearing level avoids audit rows being silently hidden.
            level: e.target.value === "audit" ? "" : value.level,
          })
        }
        className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
      >
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        value={value.level}
        disabled={levelDisabled}
        onChange={(e) =>
          onChange({ ...value, level: e.target.value as ErrorLevel | "" })
        }
        className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
