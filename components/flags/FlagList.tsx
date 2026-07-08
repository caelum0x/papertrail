"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeatureFlag } from "@/lib/flags/types";
import { fetchFlags } from "@/components/flags/api";
import { FlagRow } from "@/components/flags/FlagRow";
import { FlagFilters } from "@/components/flags/FlagFilters";
import { CreateFlagCard } from "@/components/flags/CreateFlagCard";
import { Pagination } from "@/components/flags/Pagination";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/flags/ui";

const LIMIT = 20;

// Stateful flag list: search + pagination + create. Composes the presentational
// row/filter/empty/pagination pieces and owns the data-fetch lifecycle.
export function FlagList() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchFlags({ q: debounced || undefined, page, limit: LIMIT });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load flags.");
      setLoading(false);
      return;
    }
    setFlags(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <FlagFilters query={query} onQuery={setQuery} />
        </div>
        <CreateFlagCard onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading flags…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : flags.length === 0 ? (
        <EmptyState
          title={debounced ? "No flags match your search." : "No feature flags yet."}
          hint={
            debounced
              ? "Try a different key or description."
              : "Create your first flag to gate a feature behind a toggle."
          }
        />
      ) : (
        <div className="rounded-lg border border-ink/10 bg-white">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-ink/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink/40">
            <span>Flag</span>
            <span className="w-24 text-right">Rollout</span>
            <span className="w-16 text-right">Rules</span>
            <span className="w-32 text-right">Status</span>
          </div>
          {flags.map((flag) => (
            <FlagRow key={flag.id} flag={flag} />
          ))}
          <Pagination
            page={page}
            limit={LIMIT}
            total={total}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  );
}
