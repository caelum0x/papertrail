"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConnectorSync } from "@/lib/connectors/types";
import { fetchSyncs } from "./api";
import { PAGE_SIZE, formatDateTime, formatNumber } from "./shared";
import { SyncStatusBadge } from "./StatusBadge";
import { TableStates } from "./StateBlock";
import { Pagination } from "./Pagination";

interface SyncPanelProps {
  connectorId: string;
  // Bumped by the parent after a "Sync now" so the history reloads.
  refreshKey: number;
}

// Sync-history tab: paginated, newest-first list of sync runs for this connector.
export function SyncPanel({ connectorId, refreshKey }: SyncPanelProps) {
  const [syncs, setSyncs] = useState<ConnectorSync[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchSyncs(connectorId, page, PAGE_SIZE);
    if (res.error) {
      setError(res.error);
      setSyncs([]);
      setTotal(0);
    } else {
      setSyncs(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [connectorId, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
        <TableStates
          loading={loading}
          error={error}
          items={syncs}
          onRetry={load}
          loadingLabel="Loading sync history…"
          emptyLabel="No syncs yet. Run a sync to see history here."
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Items</th>
                <th className="px-4 py-2 font-medium">Finished</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {syncs.map((s) => (
                <tr key={s.id} className="hover:bg-paper/60">
                  <td className="px-4 py-2 text-ink/60">
                    {formatDateTime(s.startedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <SyncStatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-2 text-right text-ink/80">
                    {formatNumber(s.items)}
                  </td>
                  <td className="px-4 py-2 text-ink/40">
                    {formatDateTime(s.finishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
