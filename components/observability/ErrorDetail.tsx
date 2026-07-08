"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ErrorEvent } from "@/lib/observability/types";
import { fetchError } from "@/components/observability/api";
import {
  ErrorState,
  LevelBadge,
  LoadingState,
  formatTime,
} from "@/components/observability/ui";

// Full detail view for a single error event: header, metadata, and pretty-
// printed context payload.

function ContextPanel({ context }: { context: Record<string, unknown> }) {
  const isEmpty = Object.keys(context).length === 0;
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/70">Context</h2>
      {isEmpty ? (
        <p className="mt-2 text-sm text-ink/40">No context attached.</p>
      ) : (
        <pre className="mt-2 overflow-x-auto rounded bg-paper p-3 text-xs text-ink/70">
          {JSON.stringify(context, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ErrorDetail({ id }: { id: string }) {
  const [event, setEvent] = useState<ErrorEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchError(id);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load error event.");
      setLoading(false);
      return;
    }
    setEvent(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Link
        href="/console/admin/observability/errors"
        className="inline-flex items-center text-sm text-accent hover:underline"
      >
        ← Back to errors
      </Link>

      {loading ? (
        <LoadingState label="Loading error…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : event ? (
        <>
          <div className="rounded-lg border border-ink/10 bg-white p-5">
            <div className="flex items-center gap-3">
              <LevelBadge level={event.level} />
              <span className="text-xs text-ink/40">
                {formatTime(event.createdAt)}
              </span>
            </div>
            <p className="mt-3 text-base font-medium text-ink">{event.message}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink/10 pt-4 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink/40">
                  Event ID
                </dt>
                <dd className="truncate font-mono text-xs text-ink/70">
                  {event.id}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink/40">
                  Level
                </dt>
                <dd className="text-ink/70">{event.level}</dd>
              </div>
            </dl>
          </div>
          <ContextPanel context={event.context} />
        </>
      ) : null}
    </div>
  );
}
