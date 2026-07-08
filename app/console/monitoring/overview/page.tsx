"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchMonitors } from "@/components/monitoring/api";
import type { Monitor } from "@/lib/monitoring/types";
import {
  SOURCE_TYPE_LABELS,
  FREQUENCY_LABELS,
} from "@/components/monitoring/labels";
import { StatTile } from "../_components/StatTile";
import { StateCard, ErrorCard } from "../_components/StateCard";
import { formatDateTime } from "../_components/format";

// Overview sub-page: an at-a-glance summary of the org's monitors, computed
// entirely from the existing /api/monitors list endpoint (no new API).
export default function MonitoringOverviewPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMonitors({ limit: 100 });
      setMonitors(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMonitors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = monitors.filter((m) => m.enabled).length;
  const disabled = monitors.length - enabled;
  const neverRun = monitors.filter((m) => !m.last_run_at).length;

  const bySource = monitors.reduce<Record<string, number>>((acc, m) => {
    for (const s of m.sources) acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const byFrequency = monitors.reduce<Record<string, number>>((acc, m) => {
    acc[m.frequency] = (acc[m.frequency] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <Link
        href="/console/monitoring"
        className="text-xs text-accent hover:underline"
      >
        ← All monitors
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">
        Monitoring overview
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        A summary of the safety-literature monitors configured for this org.
      </p>

      <div className="mt-6">
        {loading ? (
          <StateCard>Loading overview...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : monitors.length === 0 ? (
          <StateCard>
            No monitors yet.{" "}
            <Link
              href="/console/monitoring"
              className="text-accent hover:underline"
            >
              Create one
            </Link>{" "}
            to populate this overview.
          </StateCard>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile value={monitors.length} label="Total monitors" />
              <StatTile value={enabled} label="Enabled" emphasis="green" />
              <StatTile value={disabled} label="Disabled" />
              <StatTile value={neverRun} label="Never run" emphasis="amber" />
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-medium text-ink/70">By source</h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(bySource).map(([source, count]) => (
                    <div
                      key={source}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <span className="text-ink/70">
                        {SOURCE_TYPE_LABELS[
                          source as keyof typeof SOURCE_TYPE_LABELS
                        ] ?? source}
                      </span>
                      <span className="text-ink/50">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-medium text-ink/70">By frequency</h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(byFrequency).map(([freq, count]) => (
                    <div
                      key={freq}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <span className="text-ink/70">
                        {FREQUENCY_LABELS[
                          freq as keyof typeof FREQUENCY_LABELS
                        ] ?? freq}
                      </span>
                      <span className="text-ink/50">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium text-ink/70">
                Recently run monitors
              </h2>
              <ul className="mt-3 space-y-2">
                {[...monitors]
                  .sort(
                    (a, b) =>
                      new Date(b.last_run_at ?? 0).getTime() -
                      new Date(a.last_run_at ?? 0).getTime()
                  )
                  .slice(0, 5)
                  .map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <Link
                        href={`/console/monitoring/${m.id}`}
                        className="text-ink/80 hover:underline"
                      >
                        {m.name}
                      </Link>
                      <span className="text-xs text-ink/40">
                        {formatDateTime(m.last_run_at)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
