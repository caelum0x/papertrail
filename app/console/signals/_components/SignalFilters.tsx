import type { AeSeverity, AeStatus } from "@/lib/monitoring/types";
import { AE_SEVERITIES, AE_STATUSES } from "@/lib/monitoring/types";
import {
  SEVERITY_LABELS,
  AE_STATUS_LABELS,
} from "@/components/monitoring/labels";

interface SignalFiltersProps {
  statusFilter: AeStatus | "";
  severityFilter: AeSeverity | "";
  onStatusChange: (value: AeStatus | "") => void;
  onSeverityChange: (value: AeSeverity | "") => void;
}

// Status + severity filter bar for the AE-signal triage board.
export function SignalFilters({
  statusFilter,
  severityFilter,
  onStatusChange,
  onSeverityChange,
}: SignalFiltersProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value as AeStatus | "")}
        className="rounded border border-ink/15 px-2 py-2 text-sm focus:outline-none focus:border-accent"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {AE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {AE_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        value={severityFilter}
        onChange={(e) => onSeverityChange(e.target.value as AeSeverity | "")}
        className="rounded border border-ink/15 px-2 py-2 text-sm focus:outline-none focus:border-accent"
        aria-label="Filter by severity"
      >
        <option value="">All severities</option>
        {AE_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {SEVERITY_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
