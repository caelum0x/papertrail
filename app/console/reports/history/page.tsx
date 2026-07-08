"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchExportJobs } from "@/components/reports-exports/api";
import type { ExportJob } from "@/lib/reports-exports/types";
import { ModuleHeader } from "../_components/ModuleHeader";
import { ExportJobsTable } from "../_components/ExportJobsTable";
import { Pagination } from "../_components/Pagination";

const PAGE_SIZE = 20;

// Full, paginated export-job history — the main page only shows the 10 most
// recent. Built entirely on the existing /api/exports endpoint.
export default function ExportHistoryPage() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchExportJobs(page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setJobs([]);
      setTotal(0);
    } else {
      setJobs(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <Link href="/console/reports" className="text-sm text-accent hover:underline">
        ← Reports
      </Link>
      <div className="mt-2">
        <ModuleHeader
          title="Export history"
          description="Every export job run for this organization, most recent first."
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-ink/40">
            Loading export history…
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={load}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No exports run yet.
          </div>
        ) : (
          <ExportJobsTable jobs={jobs} />
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
