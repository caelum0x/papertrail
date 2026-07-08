"use client";

import type { RequestStatus } from "@/lib/signatures/types";

const STATUS_OPTIONS: { value: "" | RequestStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Awaiting signatures" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

interface FiltersBarProps {
  status: "" | RequestStatus;
  entityType: string;
  onStatusChange: (value: "" | RequestStatus) => void;
  onEntityTypeChange: (value: string) => void;
}

// Status + entity-type filters for the requests list.
export function FiltersBar({
  status,
  entityType,
  onStatusChange,
  onEntityTypeChange,
}: FiltersBarProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as "" | RequestStatus)}
        className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/70"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={entityType}
        onChange={(e) => onEntityTypeChange(e.target.value.trim())}
        placeholder="Filter by entity type (e.g. claim)"
        className="w-64 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/70 placeholder:text-ink/30"
      />
    </div>
  );
}
