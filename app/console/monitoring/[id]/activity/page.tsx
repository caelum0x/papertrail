"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Monitor, MonitorHit } from "@/lib/monitoring/types";
import { MONITOR_HIT_STATUSES } from "@/lib/monitoring/types";
import { fetchMonitor, fetchHits } from "@/components/monitoring/api";
import {
  SOURCE_TYPE_LABELS,
  HIT_STATUS_LABELS,
  HIT_STATUS_STYLES,
} from "@/components/monitoring/labels";
import { StatTile } from "../../_components/StatTile";
import { StateCard, ErrorCard } from "../../_components/StateCard";
import { formatDateTimeStrict } from "../../_components/format";

const RECENT_LIMIT = 50;

// Activity sub-page for a single monitor: triage-status breakdown plus a recent
// timeline of surfaced hits, computed from the existing hits list endpoint.
export default function MonitorActivityPage() {
  const params = useParams<{ id: string }>();
  const monitorId = params?.id ?? "";

  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [hits, setHits] = useState<MonitorHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!monitorId) return;
    setLoading(true);
    setError(null);
    try {
      const [mon, res] = await Promise.all([
        fetchMonitor(monitorId),
        fetchHits(monitorId, { page: 1, limit: RECENT_LIMIT }),
      ]);
      setMonitor(mon);
      setHits(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setHits([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [monitorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = MONITOR_HIT_STATUSES.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s] = hits.filter((h) => h.status === s).length;
      return acc;
    },
    {}
  );

  return (
    <div>
      <Link
        href={`/console/monitoring/${monitorId}`}
        className="text-xs text-accent hover:underline"
      >
        ← Back to hits
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80 truncate">
        {monitor ? `${monitor.name} — activity` : "Monitor activity"}
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Triage breakdown and the most recent {RECENT_LIMIT} surfaced sources.
      </p>

      <div className="mt-6">
        {loading ? (
          <StateCard>Loading activity...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile value={total} label="Total hits" />
              <StatTile
                value={counts.new ?? 0}
                label="New"
                emphasis="amber"
              />
              <StatTile
                value={counts.relevant ?? 0}
                label="Relevant"
                emphasis="green"
              />
              <StatTile
                value={counts.escalated ?? 0}
                label="Escalated"
                emphasis="red"
              />
            </div>

            {hits.length === 0 ? (
              <StateCard>
                No hits yet. Run the monitor to surface matching sources.
              </StateCard>
            ) : (
              <div>
                <h2 className="text-sm font-medium text-ink/70">
                  Recent activity
                </h2>
                <ul className="mt-3 divide-y divide-ink/10 rounded-lg border border-ink/15 bg-white">
                  {hits.map((hit) => (
                    <li
                      key={hit.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink/80">
                          {hit.title ?? hit.external_id}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink/40">
                          <span>{SOURCE_TYPE_LABELS[hit.source_type]}</span>
                          <span>·</span>
                          <span>{formatDateTimeStrict(hit.matched_at)}</span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${HIT_STATUS_STYLES[hit.status]}`}
                      >
                        {HIT_STATUS_LABELS[hit.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
