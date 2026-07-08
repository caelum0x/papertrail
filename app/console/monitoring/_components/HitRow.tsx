import type { MonitorHit, MonitorHitStatus } from "@/lib/monitoring/types";
import {
  SOURCE_TYPE_LABELS,
  HIT_STATUS_LABELS,
  HIT_STATUS_STYLES,
} from "@/components/monitoring/labels";
import { formatDateTimeStrict } from "./format";

const TRIAGE_ACTIONS: { status: MonitorHitStatus; label: string }[] = [
  { status: "relevant", label: "Mark relevant" },
  { status: "escalated", label: "Escalate" },
  { status: "dismissed", label: "Dismiss" },
];

interface HitRowProps {
  hit: MonitorHit;
  triaging: boolean;
  onTriage: (hitId: string, status: MonitorHitStatus) => void;
}

// A single surfaced source with its triage-status badge and triage actions.
export function HitRow({ hit, triaging, onTriage }: HitRowProps) {
  return (
    <li className="bg-white border border-ink/15 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/80">
            {hit.url ? (
              <a
                href={hit.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {hit.title ?? hit.external_id}
              </a>
            ) : (
              hit.title ?? hit.external_id
            )}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/40">
            <span>{SOURCE_TYPE_LABELS[hit.source_type]}</span>
            <span>·</span>
            <span>{hit.external_id}</span>
            <span>·</span>
            <span>{formatDateTimeStrict(hit.matched_at)}</span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${HIT_STATUS_STYLES[hit.status]}`}
        >
          {HIT_STATUS_LABELS[hit.status]}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {TRIAGE_ACTIONS.map((action) => (
          <button
            key={action.status}
            onClick={() => onTriage(hit.id, action.status)}
            disabled={triaging || hit.status === action.status}
            className="rounded-md border border-ink/15 px-2.5 py-1 text-xs font-medium text-ink/70 hover:border-accent/40 disabled:opacity-40"
          >
            {action.label}
          </button>
        ))}
      </div>
    </li>
  );
}
