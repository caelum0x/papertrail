"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Monitor, MonitorHit, MonitorHitStatus } from "@/lib/monitoring/types";
import {
  fetchMonitor,
  fetchHits,
  runMonitor,
  triageHit,
} from "@/components/monitoring/api";
import { HitRow } from "../_components/HitRow";
import { HitStatusFilter } from "../_components/HitStatusFilter";
import { Pagination } from "../_components/Pagination";
import { StateCard, ErrorCard } from "../_components/StateCard";

const PAGE_SIZE = 20;

export default function MonitorHitsPage() {
  const params = useParams<{ id: string }>();
  const monitorId = params?.id ?? "";

  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [items, setItems] = useState<MonitorHit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<MonitorHitStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [triagingId, setTriagingId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const load = useCallback(async () => {
    if (!monitorId) return;
    setLoading(true);
    setError(null);
    try {
      const [mon, hits] = await Promise.all([
        fetchMonitor(monitorId),
        fetchHits(monitorId, { status: statusFilter, page, limit: PAGE_SIZE }),
      ]);
      setMonitor(mon);
      setItems(hits.items);
      setTotal(hits.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [monitorId, statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const onRun = useCallback(async () => {
    if (!monitorId) return;
    setRunning(true);
    setRunNote(null);
    try {
      const result = await runMonitor(monitorId);
      setRunNote(
        `Checked ${result.considered} source${
          result.considered === 1 ? "" : "s"
        } — ${result.new_hits} new hit${result.new_hits === 1 ? "" : "s"}.`
      );
      await load();
    } catch (err) {
      setRunNote(err instanceof Error ? err.message : "Couldn't run the monitor.");
    } finally {
      setRunning(false);
    }
  }, [monitorId, load]);

  const onTriage = useCallback(
    async (hitId: string, status: MonitorHitStatus) => {
      setTriagingId(hitId);
      try {
        const updated = await triageHit(hitId, status);
        setItems((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't triage the hit.");
      } finally {
        setTriagingId(null);
      }
    },
    []
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/console/monitoring"
            className="text-xs text-accent hover:underline"
          >
            ← All monitors
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-ink/80 truncate">
            {monitor ? monitor.name : "Monitor hits"}
          </h1>
          {monitor ? (
            <p className="mt-1 text-sm text-ink/40 line-clamp-2">
              {monitor.query}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {monitorId ? (
            <Link
              href={`/console/monitoring/${monitorId}/activity`}
              className="text-xs font-medium text-accent hover:underline"
            >
              Activity
            </Link>
          ) : null}
          <button
            onClick={() => void onRun()}
            disabled={running || !monitorId}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Running..." : "Run now"}
          </button>
        </div>
      </div>

      {runNote ? <p className="mt-3 text-sm text-ink/60">{runNote}</p> : null}

      <HitStatusFilter value={statusFilter} onChange={setStatusFilter} />

      <div className="mt-4">
        {loading ? (
          <StateCard>Loading hits...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <StateCard>
            No hits yet. Run the monitor to surface matching sources.
          </StateCard>
        ) : (
          <ul className="space-y-3">
            {items.map((hit) => (
              <HitRow
                key={hit.id}
                hit={hit}
                triaging={triagingId === hit.id}
                onTriage={(hitId, status) => void onTriage(hitId, status)}
              />
            ))}
          </ul>
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          noun="hit"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
