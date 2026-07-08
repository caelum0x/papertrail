import Link from "next/link";
import type { Monitor } from "@/lib/monitoring/types";
import {
  SOURCE_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/components/monitoring/labels";
import { formatDateTime } from "./format";

interface MonitorRowProps {
  monitor: Monitor;
  running: boolean;
  onRun: (id: string) => void;
}

// A single monitor list item with run-now and a link to its hits.
export function MonitorRow({ monitor, running, onRun }: MonitorRowProps) {
  return (
    <li className="bg-white border border-ink/15 rounded-lg p-4 hover:border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/console/monitoring/${monitor.id}`}
            className="text-sm font-medium text-ink/80 hover:underline"
          >
            {monitor.name}
          </Link>
          <p className="mt-0.5 text-xs text-ink/50 line-clamp-2">
            {monitor.query}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/40">
            <span>{FREQUENCY_LABELS[monitor.frequency]}</span>
            <span>·</span>
            <span>
              {monitor.sources.map((s) => SOURCE_TYPE_LABELS[s]).join(", ")}
            </span>
            <span>·</span>
            <span>Last run: {formatDateTime(monitor.last_run_at)}</span>
            {!monitor.enabled ? (
              <span className="rounded border border-ink/10 bg-ink/5 px-1.5 py-0.5 text-ink/50">
                Disabled
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => onRun(monitor.id)}
            disabled={running}
            className="rounded-md border border-ink/15 px-2.5 py-1.5 text-xs font-medium text-ink/70 hover:border-accent/40 disabled:opacity-50"
          >
            {running ? "Running..." : "Run now"}
          </button>
          <Link
            href={`/console/monitoring/${monitor.id}`}
            className="text-xs font-medium text-accent hover:underline"
          >
            Hits
          </Link>
        </div>
      </div>
    </li>
  );
}
