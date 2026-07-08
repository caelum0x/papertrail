"use client";

import { STATUS_OPTIONS } from "./format";

interface FiltersBarProps {
  scope: "mine" | "all";
  status: string;
  onScopeChange: (scope: "mine" | "all") => void;
  onStatusChange: (status: string) => void;
}

// Scope toggle (all / assigned to me) + status dropdown for the reviews queue.
export function FiltersBar({
  scope,
  status,
  onScopeChange,
  onStatusChange,
}: FiltersBarProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-ink/15 bg-white p-0.5">
        {(["all", "mine"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onScopeChange(s)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              scope === s
                ? "bg-paper text-accent font-medium"
                : "text-ink/60 hover:text-ink/80"
            }`}
          >
            {s === "all" ? "All reviews" : "Assigned to me"}
          </button>
        ))}
      </div>

      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
        aria-label="Filter by status"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
