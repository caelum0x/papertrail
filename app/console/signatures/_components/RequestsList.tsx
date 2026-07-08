"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestStatus, SignatureRequest } from "@/lib/signatures/types";
import { fetchRequests } from "@/components/signatures/api";
import { LoadingState, ErrorState, EmptyState } from "@/components/signatures/ui";
import { FiltersBar } from "./FiltersBar";
import { RequestsTable } from "./RequestsTable";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;

// Self-contained, filterable, paginated list of the org's signature requests.
// Owns its own data fetching and loading / empty / error states.
export function RequestsList() {
  const [status, setStatus] = useState<"" | RequestStatus>("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<SignatureRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRequests({
      status: status || undefined,
      entityType: entityType || undefined,
      page,
      limit: PAGE_SIZE,
    });
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.meta?.total ?? 0);
    }
    setLoading(false);
  }, [status, entityType, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <FiltersBar
        status={status}
        entityType={entityType}
        onStatusChange={(s) => {
          setStatus(s);
          setPage(1);
        }}
        onEntityTypeChange={(e) => {
          setEntityType(e);
          setPage(1);
        }}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-ink/10 bg-white">
        {loading ? (
          <LoadingState label="Loading signature requests…" />
        ) : error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={load} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No signature requests"
            hint="Create a request to start an ordered signing ceremony."
          />
        ) : (
          <RequestsTable items={items} />
        )}
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
