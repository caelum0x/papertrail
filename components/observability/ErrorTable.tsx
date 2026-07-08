"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ErrorEvent } from "@/lib/observability/types";
import { fetchErrors } from "@/components/observability/api";
import {
  ErrorFilters,
  type ErrorFilterValue,
} from "@/components/observability/ErrorFilters";
import { Pagination } from "@/components/observability/Pagination";
import {
  EmptyState,
  ErrorState,
  LevelBadge,
  LoadingState,
  formatTime,
} from "@/components/observability/ui";

const LIMIT = 20;

function ErrorRow({ event }: { event: ErrorEvent }) {
  const router = useRouter();
  return (
    <tr
      onClick={() =>
        router.push(`/console/admin/observability/errors/${event.id}`)
      }
      className="cursor-pointer border-t border-ink/10 hover:bg-paper"
    >
      <td className="px-3 py-2.5 align-top">
        <LevelBadge level={event.level} />
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="text-sm text-ink/80">{event.message}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs text-ink/40">
        {formatTime(event.createdAt)}
      </td>
    </tr>
  );
}

export function ErrorTable() {
  const [filters, setFilters] = useState<ErrorFilterValue>({ level: "", q: "" });
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchErrors({
      level: filters.level || undefined,
      q: filters.q || undefined,
      page,
      limit: LIMIT,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load errors.");
      setLoading(false);
      return;
    }
    setEvents(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [filters.level, filters.q]);

  return (
    <div className="rounded-lg border border-ink/10 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 p-4">
        <ErrorFilters value={filters} onChange={setFilters} />
        <button
          onClick={() => void load()}
          className="rounded border border-ink/10 px-2.5 py-1.5 text-xs text-ink/60 hover:bg-paper"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading errors…" />
      ) : error ? (
        <div className="p-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : events.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No matching errors"
            hint="Try clearing filters or widening the search."
          />
        </div>
      ) : (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink/40">
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <ErrorRow key={e.id} event={e} />
              ))}
            </tbody>
          </table>
          <div className="px-4">
            <Pagination
              page={page}
              limit={LIMIT}
              total={total}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
