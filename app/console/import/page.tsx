"use client";

import { useCallback, useEffect, useState } from "react";
import type { ImportBatch } from "@/lib/import/types";
import { listBatches } from "@/components/import/api";
import { ModuleHeader } from "@/components/import/ModuleHeader";
import { StartImportCard } from "@/components/import/StartImportCard";
import { ImportHistoryTable } from "@/components/import/ImportHistoryTable";
import { Pagination } from "@/components/import/Pagination";

const PAGE_LIMIT = 20;

// Import module list view: composes the header, the start-import card, and the
// paginated history table.
export default function ImportHistoryPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await listBatches(p, PAGE_LIMIT);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load imports.");
      setLoading(false);
      return;
    }
    setBatches(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="space-y-6">
      <ModuleHeader />
      <StartImportCard />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink/80">Recent imports</h2>
        {loading ? (
          <p className="text-sm text-ink/40">Loading imports…</p>
        ) : error ? (
          <div className="rounded-lg border border-ink/10 bg-white p-5">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void load(page)}
              className="mt-2 text-sm text-accent"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <ImportHistoryTable batches={batches} />
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
