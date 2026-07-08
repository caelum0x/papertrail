"use client";

import { useCallback, useEffect, useState } from "react";
import type { SsoConnection } from "@/lib/sso/types";
import { fetchConnections } from "@/components/sso/api";
import { ConnectionRow } from "@/components/sso/ConnectionRow";
import { EmptyState } from "@/components/sso/EmptyState";
import { Pagination } from "@/components/sso/Pagination";

// The org's SSO connections list. Client component: fetches connections for the
// active org and handles loading / error / empty states itself. Composes
// ConnectionRow + EmptyState + Pagination.

const PAGE_SIZE = 20;

export function SsoConnectionList() {
  const [items, setItems] = useState<SsoConnection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const { items: rows, total: t } = await fetchConnections({
        page: p,
        limit: PAGE_SIZE,
      });
      setItems(rows);
      setTotal(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  return (
    <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 flex items-center justify-between">
        <span className="text-sm font-medium text-ink/70">Connections</span>
        {total > 0 ? (
          <span className="text-xs text-ink/40">{total} total</span>
        ) : null}
      </div>

      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading connections…</div>
      ) : error ? (
        <div className="p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => load(page)}
            className="mt-2 text-xs text-ink/60 hover:text-accent"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="No SSO connections yet"
            message="Add a SAML or OIDC connection to let your team sign in with your identity provider."
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-ink/10">
            {items.map((c) => (
              <ConnectionRow key={c.id} connection={c} />
            ))}
          </ul>
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
