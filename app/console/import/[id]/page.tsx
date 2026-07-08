"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ImportBatch, ImportRow } from "@/lib/import/types";
import { getBatch, commitBatch } from "@/components/import/api";
import { BatchHeader } from "@/components/import/BatchHeader";
import { RowsTable } from "@/components/import/RowsTable";
import { Pagination } from "@/components/import/Pagination";

const PAGE_LIMIT = 50;

// Batch detail view: composes BatchHeader (with a commit action) and a paginated
// RowsTable of staged rows.
export default function ImportBatchPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      if (!id) return;
      setLoading(true);
      setError(null);
      const res = await getBatch(id, p, PAGE_LIMIT);
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to load batch.");
        setLoading(false);
        return;
      }
      setBatch(res.data.batch);
      setRows(res.data.rows);
      setTotal(res.meta?.total ?? res.data.rows.length);
      setLoading(false);
    },
    [id]
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const commit = useCallback(async () => {
    if (!id) return;
    setCommitting(true);
    setCommitError(null);
    const res = await commitBatch(id, {});
    setCommitting(false);
    if (!res.success || !res.data) {
      setCommitError(res.error ?? "Failed to commit batch.");
      return;
    }
    setBatch(res.data);
    void load(page);
  }, [id, load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  if (loading && !batch) {
    return <p className="text-sm text-ink/40">Loading batch…</p>;
  }

  if (error && !batch) {
    return (
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
    );
  }

  if (!batch) {
    return <p className="text-sm text-ink/60">Batch not found.</p>;
  }

  return (
    <div className="space-y-6">
      <BatchHeader batch={batch} committing={committing} onCommit={commit} />
      {commitError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {commitError}
        </p>
      ) : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink/80">Rows</h2>
        <RowsTable rows={rows} />
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </div>
    </div>
  );
}
