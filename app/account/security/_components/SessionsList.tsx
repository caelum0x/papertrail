"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserSession } from "@/lib/account/types";
import { Card } from "@/components/account/Card";
import { Pagination } from "@/components/account/Pagination";
import { LoadingRows, EmptyState, ErrorState } from "@/components/account/states";
import { fetchSessions, revokeSession } from "../../_components/api";
import { SessionRow } from "./SessionRow";

const PAGE_SIZE = 10;

// "Where you're signed in": the current user's active sessions, with the ability
// to revoke any session other than the current device. Reloads after a revoke so
// the list and pager stay consistent.
export function SessionsList() {
  const [items, setItems] = useState<UserSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchSessions(page, PAGE_SIZE);
    if (res.error) {
      setError(res.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const onRevoke = async (id: string) => {
    setRevokingId(id);
    const res = await revokeSession(id);
    setRevokingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    // If the last row on a page was revoked, step back a page.
    if (items.length === 1 && page > 1) {
      setPage((p) => p - 1);
    } else {
      load();
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card
      title="Active sessions"
      description="Devices and browsers currently signed in to your account."
    >
      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title="No active sessions found." />
      ) : (
        <>
          <ul className="-mx-5 divide-y divide-ink/10">
            {items.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                revoking={revokingId === s.id}
                onRevoke={onRevoke}
              />
            ))}
          </ul>
          <div className="-mx-5 -mb-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        </>
      )}
    </Card>
  );
}
