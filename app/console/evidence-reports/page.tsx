"use client";

// Saved Evidence Reports list. GETs the org-scoped, paginated
// /api/evidence-reports feed and links each row to a detail view. Read-only:
// creation happens in the Evidence Workbench. Handles loading, empty, and error
// (including 401/403) states inline.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import {
  apiGet,
  formatDateTime,
  type SavedEvidenceReportDto,
} from "./api";

const PAGE_LIMIT = 20;

function CertaintyPill({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="rounded-full border border-ink/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink/50">
      {value.replace(/_/g, " ")}
    </span>
  );
}

export default function SavedEvidenceReportsPage() {
  const [items, setItems] = useState<SavedEvidenceReportDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    const res = await apiGet<SavedEvidenceReportDto[]>(
      `/api/evidence-reports?${params}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load saved reports.");
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_LIMIT)),
    [total]
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Saved evidence reports"
        subtitle="Composite reports persisted from the Evidence Workbench — pooled estimate, GRADE certainty, publication bias, and verdict."
        action={
          <Link
            href="/console/workbench"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            New in workbench
          </Link>
        }
      />

      {loading ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading saved reports…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-sm font-medium text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-ink/60">No saved reports yet.</p>
          <Link
            href="/console/workbench"
            className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
          >
            Build one in the Evidence Workbench
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-ink/10 rounded-lg border border-ink/15 bg-white">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={`/console/evidence-reports/${r.id}`}
                className="block px-4 py-3 hover:bg-paper"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="line-clamp-2 text-sm font-medium text-ink/80">
                    {r.claim}
                  </p>
                  <CertaintyPill value={r.certainty} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/40">
                  <span>{formatDateTime(r.createdAt)}</span>
                  {r.verdict ? (
                    <span className="text-ink/60">{r.verdict}</span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && items.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-ink/50">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-ink/15 px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-md border border-ink/15 px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
