"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, type ClaimDto } from "@/components/claims/api";
import { ModuleHeader } from "./_components/ModuleHeader";
import { ClaimsFilters } from "./_components/ClaimsFilters";
import { ClaimsList } from "./_components/ClaimsList";
import { ListLoading, ListError, ListEmpty } from "./_components/ListStates";
import { ClaimsPagination } from "./_components/ClaimsPagination";

interface Meta {
  total: number;
  page: number;
  limit: number;
}

const PAGE_LIMIT = 20;

export default function ClaimsListPage() {
  const [claims, setClaims] = useState<ClaimDto[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: PAGE_LIMIT });
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce free-text search so we don't hit the API on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [status, debouncedQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
      if (status) params.set("status", status);
      if (debouncedQuery) params.set("q", debouncedQuery);

      const res = await apiFetch<ClaimDto[]>(`/api/claims?${params.toString()}`);
      setClaims(res.data ?? []);
      setMeta({
        total: res.meta?.total ?? 0,
        page: res.meta?.page ?? page,
        limit: res.meta?.limit ?? PAGE_LIMIT,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load claims.");
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, debouncedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  return (
    <div>
      <ModuleHeader
        title="Claims"
        subtitle="Efficacy claims tracked for provenance verification."
        action={
          <Link
            href="/console/claims/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            New claim
          </Link>
        }
      />

      <ClaimsFilters
        query={query}
        status={status}
        onQueryChange={setQuery}
        onStatusChange={setStatus}
      />

      <div className="mt-6 rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : claims.length === 0 ? (
          <ListEmpty />
        ) : (
          <ClaimsList claims={claims} />
        )}
      </div>

      {!loading && !error && claims.length > 0 ? (
        <ClaimsPagination
          total={meta.total}
          page={meta.page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      ) : null}
    </div>
  );
}
