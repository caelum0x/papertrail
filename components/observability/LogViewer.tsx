"use client";

import { useCallback, useEffect, useState } from "react";
import type { LogEntry } from "@/lib/observability/types";
import { fetchLogs } from "@/components/observability/api";
import {
  LogFilters,
  type LogFilterValue,
} from "@/components/observability/LogFilters";
import { Pagination } from "@/components/observability/Pagination";
import {
  EmptyState,
  ErrorState,
  LevelBadge,
  LoadingState,
  formatTime,
} from "@/components/observability/ui";

const LIMIT = 25;

function SourceTag({ source }: { source: LogEntry["source"] }) {
  const style =
    source === "audit"
      ? "bg-indigo-50 text-indigo-700 border-indigo-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${style}`}
    >
      {source}
    </span>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const hasContext = Object.keys(entry.context).length > 0;
  return (
    <li className="border-t border-ink/10 first:border-t-0">
      <button
        type="button"
        onClick={() => hasContext && setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${
          hasContext ? "hover:bg-paper" : "cursor-default"
        }`}
      >
        <SourceTag source={entry.source} />
        {entry.level && <LevelBadge level={entry.level} />}
        <span className="min-w-0 flex-1 truncate text-sm text-ink/80">
          {entry.message}
        </span>
        {entry.actor && (
          <span className="shrink-0 text-xs text-ink/40">{entry.actor}</span>
        )}
        <span className="shrink-0 text-xs text-ink/40">
          {formatTime(entry.createdAt)}
        </span>
      </button>
      {open && hasContext && (
        <pre className="mx-3 mb-3 overflow-x-auto rounded bg-paper p-3 text-xs text-ink/70">
          {JSON.stringify(entry.context, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function LogViewer() {
  const [filters, setFilters] = useState<LogFilterValue>({
    source: "all",
    level: "",
    q: "",
  });
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchLogs({
      source: filters.source,
      level: filters.level || undefined,
      q: filters.q || undefined,
      page,
      limit: LIMIT,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load logs.");
      setLoading(false);
      return;
    }
    setEntries(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filters.source, filters.level, filters.q]);

  return (
    <div className="rounded-lg border border-ink/10 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 p-4">
        <LogFilters value={filters} onChange={setFilters} />
        <button
          onClick={() => void load()}
          className="rounded border border-ink/10 px-2.5 py-1.5 text-xs text-ink/60 hover:bg-paper"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading logs…" />
      ) : error ? (
        <div className="p-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : entries.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No log entries"
            hint="Adjust the filters or wait for new activity."
          />
        </div>
      ) : (
        <>
          <ul>
            {entries.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ul>
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
