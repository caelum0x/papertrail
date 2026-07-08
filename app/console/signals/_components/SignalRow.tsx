import type { AeSignal, AeStatus } from "@/lib/monitoring/types";
import {
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  AE_STATUS_LABELS,
  AE_STATUS_STYLES,
  AE_STATUS_OPTIONS,
} from "@/components/monitoring/labels";
import { formatDate } from "./format";

interface SignalRowProps {
  signal: AeSignal;
  updating: boolean;
  onChangeStatus: (id: string, status: AeStatus) => void;
}

// A single AE-signal card with severity/status badges and an inline status set.
export function SignalRow({ signal, updating, onChangeStatus }: SignalRowProps) {
  return (
    <li className="bg-white border border-ink/15 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/80">
            {signal.drug} <span className="text-ink/40">·</span> {signal.event}
          </h3>
          {signal.notes ? (
            <p className="mt-1 text-xs text-ink/50 line-clamp-3">
              {signal.notes}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-ink/40">
            Raised {formatDate(signal.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[signal.severity]}`}
          >
            {SEVERITY_LABELS[signal.severity]}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-xs font-medium ${AE_STATUS_STYLES[signal.status]}`}
          >
            {AE_STATUS_LABELS[signal.status]}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-ink/50" htmlFor={`st-${signal.id}`}>
          Set status
        </label>
        <select
          id={`st-${signal.id}`}
          value={signal.status}
          disabled={updating}
          onChange={(e) => onChangeStatus(signal.id, e.target.value as AeStatus)}
          className="rounded border border-ink/15 px-2 py-1 text-xs focus:outline-none focus:border-accent disabled:opacity-50"
        >
          {AE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
