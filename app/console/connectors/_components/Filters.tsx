"use client";

import { PROVIDERS } from "@/lib/connectors/catalog";
import { CONNECTOR_STATUSES } from "@/lib/connectors/schemas";

interface FiltersProps {
  provider: string;
  status: string;
  onProviderChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  disabled?: boolean;
}

// Provider + status filter controls for the installed-connectors list.
export function Filters({
  provider,
  status,
  onProviderChange,
  onStatusChange,
  disabled,
}: FiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
      >
        <option value="">All providers</option>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
      >
        <option value="">All statuses</option>
        {CONNECTOR_STATUSES.map((s) => (
          <option key={s} value={s} className="capitalize">
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
