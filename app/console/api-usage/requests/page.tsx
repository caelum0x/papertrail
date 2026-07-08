"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiRequestLogItem } from "@/lib/apiusage/types";
import { fetchRequests } from "../_components/api";
import {
  API_USAGE_TABS,
  ModuleHeader,
  ModuleTabs,
} from "../_components/ModuleHeader";
import { Filters, type RequestFiltersValue } from "../_components/Filters";
import { RequestTable } from "../_components/RequestTable";
import { Pagination } from "../_components/Pagination";
import { TableStates } from "../_components/StateBlock";
import { PAGE_SIZE } from "../_components/shared";

const EMPTY_FILTERS: RequestFiltersValue = {
  route: "",
  method: "",
  status: "all",
};

// RequestLog page: Filters + Table + Row + Pagination over the paginated log.
export default function ApiUsageRequestsPage() {
  const [filters, setFilters] = useState<RequestFiltersValue>(EMPTY_FILTERS);
  const [items, setItems] = useState<ApiRequestLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRequests(page, PAGE_SIZE, {
      route: filters.route.trim() || undefined,
      method: filters.method || undefined,
      status: filters.status,
    });
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  // Changing filters resets to page 1 so the user isn't stranded past the end.
  const onFiltersChange = (next: RequestFiltersValue) => {
    setPage(1);
    setFilters(next);
  };

  const onReset = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="API usage"
        description="Every request served to your API keys, newest first."
      />
      <ModuleTabs tabs={API_USAGE_TABS} active="/console/api-usage/requests" />

      <div className="mt-4">
        <Filters value={filters} onChange={onFiltersChange} onReset={onReset} />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/15 bg-white">
        <TableStates
          loading={loading}
          error={error}
          items={items}
          onRetry={load}
          loadingLabel="Loading request log…"
          emptyLabel="No requests match these filters."
        >
          <RequestTable items={items} />
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
