"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConnectorEvent } from "@/lib/connectors/types";
import { fetchEvents } from "./api";
import { PAGE_SIZE, formatDateTime } from "./shared";
import { DirectionBadge } from "./StatusBadge";
import { TableStates } from "./StateBlock";
import { Pagination } from "./Pagination";

interface EventsPanelProps {
  connectorId: string;
  // Bumped by the parent after connect/test so the log reloads.
  refreshKey: number;
}

const DIRECTIONS = ["", "inbound", "outbound"] as const;

// Events tab: paginated, newest-first event log with an optional direction
// filter. Payloads are shown as pretty JSON (already redacted server-side).
export function EventsPanel({ connectorId, refreshKey }: EventsPanelProps) {
  const [events, setEvents] = useState<ConnectorEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchEvents(
      connectorId,
      page,
      PAGE_SIZE,
      direction || undefined
    );
    if (res.error) {
      setError(res.error);
      setEvents([]);
      setTotal(0);
    } else {
      setEvents(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [connectorId, page, direction]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium text-ink/60">Direction</label>
        <select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(1);
          }}
          disabled={loading}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
        >
          {DIRECTIONS.map((d) => (
            <option key={d || "all"} value={d}>
              {d === "" ? "All" : d}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
        <TableStates
          loading={loading}
          error={error}
          items={events}
          onRetry={load}
          loadingLabel="Loading events…"
          emptyLabel="No events yet. Connect or test this connector to generate events."
        >
          <ul className="divide-y divide-ink/10">
            {events.map((ev) => (
              <li key={ev.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <DirectionBadge direction={ev.direction} />
                    <code className="text-sm text-ink/80">{ev.event}</code>
                  </div>
                  <span className="text-xs text-ink/40">
                    {formatDateTime(ev.createdAt)}
                  </span>
                </div>
                {Object.keys(ev.payload).length > 0 ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-ink/5 p-2 text-xs text-ink/60">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </TableStates>
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
