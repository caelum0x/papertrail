import type { MonitorHitStatus } from "@/lib/monitoring/types";
import { MONITOR_HIT_STATUSES } from "@/lib/monitoring/types";
import { HIT_STATUS_LABELS } from "@/components/monitoring/labels";

interface HitStatusFilterProps {
  value: MonitorHitStatus | "";
  onChange: (value: MonitorHitStatus | "") => void;
}

// Triage-status dropdown for the monitor hits view.
export function HitStatusFilter({ value, onChange }: HitStatusFilterProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MonitorHitStatus | "")}
        className="rounded border border-ink/15 px-2 py-2 text-sm focus:outline-none focus:border-accent"
        aria-label="Filter by triage status"
      >
        <option value="">All statuses</option>
        {MONITOR_HIT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {HIT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
