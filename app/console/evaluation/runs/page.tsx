"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ApiResponse } from "@/lib/api/response";
import { orgHeaders, type EvalRun } from "../lib";
import { ModuleHeader } from "../_components/ModuleHeader";
import { RecentRunsTable } from "../_components/RecentRunsTable";
import { Pagination } from "../_components/Pagination";

const PAGE_SIZE = 20;

// All eval runs across every set, paginated. Read-only view over the existing
// /api/eval-runs endpoint.
export default function EvalRunsPage() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    try {
      const res = await fetch(`/api/eval-runs?${params.toString()}`, {
        headers: { ...orgHeaders() },
        cache: "no-store",
      });
      const body: ApiResponse<EvalRun[]> = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Failed to load runs.");
        setRuns([]);
        setTotal(0);
      } else {
        setRuns(body.data ?? []);
        setTotal(body.meta?.total ?? 0);
      }
    } catch {
      setError("Network error loading runs.");
      setRuns([]);
      setTotal(0);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Evaluation runs"
        subtitle="Every eval run across all sets, newest first."
        action={
          <Link
            href="/console/evaluation"
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:text-ink/90"
          >
            Eval sets
          </Link>
        }
      />

      {loading ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading runs…
        </div>
      ) : error ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          No runs yet. Run an eval set to see it here.
        </div>
      ) : (
        <RecentRunsTable runs={runs} />
      )}

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
