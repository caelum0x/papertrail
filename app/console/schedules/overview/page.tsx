"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Schedule } from "@/lib/jobs/types";
import { fetchSchedules, formatTime } from "../_components/client";
import {
  TableCard,
  TableLoading,
  TableError,
} from "../../jobs/_components/TableStates";

const OVERVIEW_LIMIT = 200;

// Schedule overview sub-page: enabled/disabled counts, a job-type breakdown,
// and the soonest upcoming runs — all from the existing /api/schedules list.
export default function SchedulesOverviewPage() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchSchedules({ page: 1, limit: OVERVIEW_LIMIT });
    if (result.error) {
      setError(result.error);
      setItems([]);
    } else {
      setItems(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const enabled = items.filter((s) => s.enabled).length;
  const disabled = items.length - enabled;

  const byType = items.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] ?? 0) + 1;
    return acc;
  }, {});

  const upcoming = items
    .filter((s) => s.enabled && s.nextRunAt)
    .sort(
      (a, b) =>
        new Date(a.nextRunAt as string).getTime() -
        new Date(b.nextRunAt as string).getTime()
    )
    .slice(0, 5);

  return (
    <div>
      <Link
        href="/console/schedules"
        className="text-sm text-accent hover:underline"
      >
        ← Back to schedules
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">
        Schedule overview
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Enablement mix, job-type breakdown, and the next scheduled runs.
      </p>

      <div className="mt-6">
        {loading ? (
          <TableCard>
            <TableLoading>Loading overview…</TableLoading>
          </TableCard>
        ) : error ? (
          <TableCard>
            <TableError message={error} onRetry={load} />
          </TableCard>
        ) : items.length === 0 ? (
          <TableCard>
            <TableLoading>
              No schedules yet. Create one to populate this overview.
            </TableLoading>
          </TableCard>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-3 gap-4">
              <Tile value={items.length} label="Schedules" />
              <Tile value={enabled} label="Enabled" className="text-green-700" />
              <Tile value={disabled} label="Disabled" />
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-medium text-ink/70">By job type</h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(byType).map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-ink/70">
                        {type}
                      </span>
                      <span className="text-ink/50">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-medium text-ink/70">Next runs</h2>
                <div className="mt-3 space-y-2">
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-ink/40">
                      No upcoming runs scheduled.
                    </p>
                  ) : (
                    upcoming.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                      >
                        <Link
                          href={`/console/schedules/${s.id}`}
                          className="text-ink/80 hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-xs text-ink/40">
                          {formatTime(s.nextRunAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  value,
  label,
  className = "text-ink/80",
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className={`text-2xl font-semibold ${className}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink/40">
        {label}
      </div>
    </div>
  );
}
