"use client";

import { useCallback, useEffect, useState } from "react";
import type { Experiment, ExperimentStatus } from "@/lib/flags/types";
import { fetchExperiments } from "@/components/flags/api";
import { ExperimentRow } from "@/components/flags/ExperimentRow";
import { ExperimentFilters } from "@/components/flags/ExperimentFilters";
import { CreateExperimentCard } from "@/components/flags/CreateExperimentCard";
import { Pagination } from "@/components/flags/Pagination";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/flags/ui";

const LIMIT = 20;

// Stateful experiment list: status filter + pagination + create + expandable
// variant panels. Composes the presentational row/filter/empty/pagination pieces.
export function ExperimentList() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ExperimentStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchExperiments({
      status: status === "all" ? undefined : status,
      page,
      limit: LIMIT,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load experiments.");
      setLoading(false);
      return;
    }
    setExperiments(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExperimentFilters status={status} onStatus={setStatus} />
        <CreateExperimentCard onCreated={load} />
      </div>

      {loading ? (
        <LoadingState label="Loading experiments…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : experiments.length === 0 ? (
        <EmptyState
          title={
            status === "all"
              ? "No experiments yet."
              : `No ${status} experiments.`
          }
          hint={
            status === "all"
              ? "Create an experiment to split traffic across variants."
              : "Try a different status filter."
          }
        />
      ) : (
        <div className="rounded-lg border border-ink/10 bg-white">
          {experiments.map((experiment) => (
            <ExperimentRow
              key={experiment.id}
              experiment={experiment}
              expanded={expandedId === experiment.id}
              onToggle={() =>
                setExpandedId((id) =>
                  id === experiment.id ? null : experiment.id
                )
              }
            />
          ))}
          <Pagination page={page} limit={LIMIT} total={total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
