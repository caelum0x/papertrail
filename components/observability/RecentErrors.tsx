"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ErrorEvent } from "@/lib/observability/types";
import { fetchErrors } from "@/components/observability/api";
import {
  EmptyState,
  ErrorState,
  LevelBadge,
  LoadingState,
  relativeTime,
} from "@/components/observability/ui";

// Compact "most recent errors" list for the overview page. Links each row and
// the header through to the full errors view.

export function RecentErrors({ limit = 6 }: { limit?: number }) {
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchErrors({ page: 1, limit });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load errors.");
      setLoading(false);
      return;
    }
    setEvents(res.data);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">Recent errors</h2>
        <Link
          href="/console/admin/observability/errors"
          className="text-xs font-medium text-accent hover:underline"
        >
          View all
        </Link>
      </div>

      {loading ? (
        <LoadingState label="Loading errors…" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : events.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No errors recorded" hint="A quiet system is a healthy system." />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-ink/10">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/console/admin/observability/errors/${e.id}`}
                className="flex items-center gap-3 py-2.5 hover:bg-paper -mx-2 px-2 rounded"
              >
                <LevelBadge level={e.level} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink/80">
                  {e.message}
                </span>
                <span className="shrink-0 text-xs text-ink/40">
                  {relativeTime(e.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
