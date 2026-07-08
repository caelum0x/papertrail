"use client";

import { useCallback, useEffect, useState } from "react";
import type { RateLimitEventItem } from "@/lib/apiusage/types";
import { fetchRateLimits } from "../_components/api";
import {
  API_USAGE_TABS,
  ModuleHeader,
  ModuleTabs,
} from "../_components/ModuleHeader";
import { RateLimitTable } from "../_components/RateLimitTable";
import { Pagination } from "../_components/Pagination";
import { TableStates } from "../_components/StateBlock";
import { PAGE_SIZE } from "../_components/shared";

// RateLimitTable page: paginated log of throttled requests, with a route filter.
export default function ApiUsageRateLimitsPage() {
  const [route, setRoute] = useState("");
  const [items, setItems] = useState<RateLimitEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRateLimits(page, PAGE_SIZE, route.trim() || undefined);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page, route]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="API usage"
        description="Requests that were throttled by rate limiting, newest first."
      />
      <ModuleTabs tabs={API_USAGE_TABS} active="/console/api-usage/rate-limits" />

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-ink/15 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-ink/40">
          Route
          <input
            type="text"
            value={route}
            placeholder="/api/v1/…"
            onChange={(e) => {
              setPage(1);
              setRoute(e.target.value);
            }}
            className="w-56 rounded-md border border-ink/15 px-2 py-1.5 text-sm text-ink/80"
          />
        </label>
        {route ? (
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setRoute("");
            }}
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/15 bg-white">
        <TableStates
          loading={loading}
          error={error}
          items={items}
          onRetry={load}
          loadingLabel="Loading rate-limit events…"
          emptyLabel="No rate-limit events recorded."
        >
          <RateLimitTable items={items} />
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
