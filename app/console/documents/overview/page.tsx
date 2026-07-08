"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/components/documents/api";
import { StatusBadge } from "@/components/documents/StatusBadge";
import type { DocumentStatus, DocumentSummary } from "@/lib/documents/types";
import { formatBytes } from "../_components/format";

// Library overview: aggregates a page of documents into status counts and total
// stored size. Uses the existing documents list endpoint only.
const OVERVIEW_LIMIT = 100;
const STATUSES: DocumentStatus[] = [
  "pending",
  "processing",
  "extracted",
  "failed",
];

export default function DocumentsOverviewPage() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<DocumentSummary[]>(
      `/api/documents?page=1&limit=${OVERVIEW_LIMIT}`
    );
    if (!res.ok) {
      setError(res.error ?? "Could not load documents.");
      setDocs([]);
      setTotal(0);
    } else {
      setDocs(res.data ?? []);
      setTotal(res.meta?.total ?? res.data?.length ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<DocumentStatus, number> = {
      pending: 0,
      processing: 0,
      extracted: 0,
      failed: 0,
    };
    for (const d of docs) base[d.status] += 1;
    return base;
  }, [docs]);

  const totalBytes = useMemo(
    () => docs.reduce((sum, d) => sum + d.size_bytes, 0),
    [docs]
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Library overview</h1>
          <p className="mt-1 text-sm text-ink/40">
            Extraction status breakdown across your document library.
          </p>
        </div>
        <Link
          href="/console/documents"
          className="text-sm border border-ink/15 rounded px-3 py-2 text-ink/70 hover:border-accent"
        >
          Back to library
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg px-5 py-10 text-center text-sm text-ink/40">
          Loading overview...
        </div>
      ) : error ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg px-5 py-10 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-ink/15 rounded-lg p-4">
              <div className="text-xs text-ink/40">Total documents</div>
              <div className="mt-1 text-lg font-semibold text-ink/80">
                {total}
              </div>
            </div>
            <div className="bg-white border border-ink/15 rounded-lg p-4">
              <div className="text-xs text-ink/40">Stored (sampled)</div>
              <div className="mt-1 text-lg font-semibold text-ink/80">
                {formatBytes(totalBytes)}
              </div>
            </div>
            <div className="bg-white border border-ink/15 rounded-lg p-4">
              <div className="text-xs text-ink/40">Sampled rows</div>
              <div className="mt-1 text-lg font-semibold text-ink/80">
                {docs.length}
              </div>
            </div>
          </div>

          <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
            <h2 className="text-sm font-medium text-ink/70">By status</h2>
            <ul className="mt-3 divide-y divide-ink/10">
              {STATUSES.map((s) => (
                <li
                  key={s}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <StatusBadge status={s} />
                  <span className="text-ink/70">{counts[s]}</span>
                </li>
              ))}
            </ul>
            {total > docs.length ? (
              <p className="mt-3 text-xs text-ink/35">
                Counts reflect the first {docs.length} of {total} documents.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
